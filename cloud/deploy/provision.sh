#!/usr/bin/env bash
#
# Basis Remote (cloud) provisioner.
#
# Turns a fresh Ubuntu 24.04 VPS into the home-basis.com control plane +
# relay: Node 20, PostgreSQL, Caddy (with the Cloudflare DNS plugin for
# wildcard TLS), a pinned+checksummed frps binary, system users, generated
# secrets, systemd units, nightly backups, and a firewall.
#
# Idempotent where sensible: safe to re-run to refresh units, templates, or
# packages. The generated /opt/basis-cloud/.env is created ONCE and never
# overwritten.
#
# This provisions the box but does NOT deploy application code. Deploy the
# first version afterwards:
#   sudo bash update.sh --version cloud-vX.Y.Z
#
# Usage:
#   sudo bash provision.sh [--cloudflare-token TOKEN]

set -euo pipefail

# ─── helpers ──────────────────────────────────────────────────────────────
RED='\033[1;31m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; BLUE='\033[1;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; exit 1; }

usage() {
  cat <<EOF
Usage: sudo bash provision.sh [options]

Options:
  --cloudflare-token TOKEN   Cloudflare API token for ACME DNS-01 (scope:
                             Zone -> DNS -> Edit, home-basis.com zone only).
                             Prompted for interactively if omitted and not
                             already configured in /etc/caddy/env.
  -h, --help                 Show this message.
EOF
  exit 0
}

# ─── constants ────────────────────────────────────────────────────────────
DOMAIN="home-basis.com"
APP_ROOT="/opt/basis-cloud"
ENV_FILE="$APP_ROOT/.env"
# frp release pin. Keep in sync with the box-side installer pin in
# backend/src/modules/install/installer-commands.ts (FRP_VERSION) and with
# cloud/dev.sh — server and clients should track the same release.
FRP_VERSION="0.61.1"
# Directory this script (and its sibling templates/units) lives in.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── args ─────────────────────────────────────────────────────────────────
CLOUDFLARE_API_TOKEN_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloudflare-token) CLOUDFLARE_API_TOKEN_ARG="${2:-}"; shift 2 ;;
    -h|--help)          usage ;;
    *)                  err "Unknown argument: $1 (try --help)" ;;
  esac
done

[ "$EUID" -eq 0 ] || err "Run as root: sudo bash $0 ..."
for f in frps.toml Caddyfile basis-cloud.service frps.service \
         basis-cloud-backup.service basis-cloud-backup.timer backup.sh \
         basis-comp sudoers-basis-cloud; do
  [ -f "$DEPLOY_DIR/$f" ] || err "Missing $DEPLOY_DIR/$f — run from a full cloud/deploy/ directory"
done

if [ -f /etc/os-release ]; then
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || warn "Tested on Ubuntu 24.04; detected '${ID:-unknown}'. Proceeding anyway."
else
  err "Can't detect OS (no /etc/os-release)"
fi

# ─── system packages ──────────────────────────────────────────────────────
log "Updating apt and installing base packages"
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg git rsync ufw openssl \
  debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
  log "Installing Node 20 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v)"

if ! command -v psql >/dev/null; then
  log "Installing PostgreSQL"
  apt-get install -y -qq postgresql postgresql-contrib
fi
systemctl enable --now postgresql
ok "PostgreSQL $(psql --version | awk '{print $3}')"

# ─── Caddy (official repo) + Cloudflare DNS plugin ────────────────────────
if ! command -v caddy >/dev/null; then
  log "Installing Caddy from the official repository"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
if ! caddy list-modules 2>/dev/null | grep -q '^dns.providers.cloudflare$'; then
  log "Adding the Cloudflare DNS plugin to Caddy (needed for wildcard DNS-01 certs)"
  caddy add-package github.com/caddy-dns/cloudflare
fi
ok "Caddy $(caddy version | awk '{print $1}') with dns.providers.cloudflare"

# ─── frps (pinned, checksum-verified) ─────────────────────────────────────
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64|arm64) ;;
  *) err "Unsupported architecture for frp: $ARCH (need amd64 or arm64)" ;;
esac

if [ -x /usr/local/bin/frps ] && [ "$(/usr/local/bin/frps --version 2>/dev/null)" = "$FRP_VERSION" ]; then
  ok "frps $FRP_VERSION already installed"
else
  log "Installing frps $FRP_VERSION (linux_$ARCH)"
  FRP_NAME="frp_${FRP_VERSION}_linux_${ARCH}"
  FRP_BASE="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}"
  FRP_TMP="$(mktemp -d)"
  curl -fsSL -o "$FRP_TMP/$FRP_NAME.tar.gz" "$FRP_BASE/$FRP_NAME.tar.gz"
  curl -fsSL -o "$FRP_TMP/checksums.txt" "$FRP_BASE/frp_sha256_checksums.txt"
  # Verify against the release's published checksums — refuse to install an
  # unverified binary (it terminates customer traffic).
  (cd "$FRP_TMP" && grep " $FRP_NAME.tar.gz\$" checksums.txt | sha256sum -c -) \
    || err "frp tarball checksum verification FAILED — refusing to install"
  tar -xzf "$FRP_TMP/$FRP_NAME.tar.gz" -C "$FRP_TMP"
  install -m 755 "$FRP_TMP/$FRP_NAME/frps" /usr/local/bin/frps
  rm -rf "$FRP_TMP"
  ok "frps $(/usr/local/bin/frps --version) installed to /usr/local/bin/frps"
fi

# ─── system users ─────────────────────────────────────────────────────────
if ! id basis-cloud >/dev/null 2>&1; then
  log "Creating system user 'basis-cloud'"
  useradd --system --home-dir "$APP_ROOT" --no-create-home --shell /usr/sbin/nologin basis-cloud
fi
if ! id frps >/dev/null 2>&1; then
  log "Creating system user 'frps'"
  useradd --system --no-create-home --shell /usr/sbin/nologin frps
fi
ok "Service users present (basis-cloud, frps)"

# ─── directory layout ─────────────────────────────────────────────────────
log "Creating directory layout"
# 751, not 750: Caddy serves the OAuth relay's static files straight out of
# the release directory ($APP_ROOT/current/relay), and it runs as the `caddy`
# user. Without the o+x on these two parents it cannot traverse to them and
# file_server answers 403 for every relay asset — with the site block matching
# and looking healthy, which makes it a confusing failure.
#
# Traverse only, deliberately: there is no o+r, so other users still cannot
# LIST these directories, and $ENV_FILE stays 0600 (chmod below) so the
# Stripe and SMTP secrets remain unreadable. Everything under versions/ is
# already world-readable application code.
install -d -o basis-cloud -g basis-cloud -m 751 "$APP_ROOT"
install -d -o basis-cloud -g basis-cloud -m 751 "$APP_ROOT/versions"
install -d -o root -g frps -m 750 /etc/frp
install -d -o basis-cloud -g basis-cloud -m 750 /var/backups/basis-cloud

# ─── database + .env (first run only) ─────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  log "First run — generating secrets and database"
  DB_PASSWORD="$(openssl rand -base64 33 | tr -d '/+=' | head -c 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  FRP_PLUGIN_SECRET="$(openssl rand -hex 32)"
  FRPS_ADMIN_PASSWORD="$(openssl rand -hex 16)"

  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'basis_cloud') THEN
    CREATE USER basis_cloud WITH PASSWORD '$DB_PASSWORD';
  ELSE
    -- Role already exists (e.g. .env was deleted but the DB user wasn't).
    -- Sync its password to the freshly generated one so the new .env matches.
    ALTER USER basis_cloud WITH PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE basis_cloud OWNER basis_cloud' WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'basis_cloud'
)\gexec
GRANT ALL PRIVILEGES ON DATABASE basis_cloud TO basis_cloud;
SQL

  cat > "$ENV_FILE" <<EOF
# Basis Remote (cloud) — generated by provision.sh on $(date -u +%FT%TZ)
# This file is created once and never overwritten by re-provisioning.
DATABASE_URL=postgres://basis_cloud:$DB_PASSWORD@localhost:5432/basis_cloud
SESSION_SECRET=$SESSION_SECRET
# Shared secret embedded in the frps httpPlugin callback path. Rendered into
# /etc/frp/frps.toml by provision.sh — if you rotate it here, re-run
# provision.sh (or re-render the template) and restart frps + basis-cloud.
FRP_PLUGIN_SECRET=$FRP_PLUGIN_SECRET
FRPS_ADMIN_USER=admin
FRPS_ADMIN_PASSWORD=$FRPS_ADMIN_PASSWORD
FRPS_ADMIN_URL=http://127.0.0.1:7500
APP_ORIGIN=https://$DOMAIN
RELAY_SERVER_ADDR=$DOMAIN
RELAY_SERVER_PORT=7000
HOST=127.0.0.1
PORT=4000
NODE_ENV=production
FRONTEND_DIST=$APP_ROOT/current/frontend/dist
# ── Stripe — REQUIRED before the service can take payments ──────────────
# Create the two annual prices + webhook endpoint in the Stripe dashboard
# (see cloud/README.md), then replace these placeholders and
# 'sudo systemctl restart basis-cloud'.
STRIPE_SECRET_KEY=CHANGEME
STRIPE_WEBHOOK_SECRET=CHANGEME
STRIPE_PRICE_BASIC_ANNUAL=CHANGEME
STRIPE_PRICE_STREAMING_ANNUAL=CHANGEME
# ── Plan limits ──────────────────────────────────────────────────────────
CAP_BASIC_GB=250
CAP_STREAMING_GB=2048
THROTTLE_BASIC_MBPS=4
# ── Backups ──────────────────────────────────────────────────────────────
# Off-host copy hook for nightly dumps (STRONGLY recommended — this DB is
# the business). The dump path is exposed as \$BASIS_BACKUP_FILE, e.g.:
#   BACKUP_REMOTE_CMD=rclone copy "\$BASIS_BACKUP_FILE" remote:basis-cloud-backups/
#BACKUP_REMOTE_CMD=
EOF
  chown basis-cloud:basis-cloud "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "Generated $ENV_FILE"
else
  log "Existing $ENV_FILE detected — keeping it"
  # Re-runs still need the secrets to (re-)render templates below.
  FRP_PLUGIN_SECRET="$(grep -E '^FRP_PLUGIN_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  FRPS_ADMIN_PASSWORD="$(grep -E '^FRPS_ADMIN_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  [ -n "$FRP_PLUGIN_SECRET" ] && [ -n "$FRPS_ADMIN_PASSWORD" ] \
    || err "Couldn't read FRP_PLUGIN_SECRET/FRPS_ADMIN_PASSWORD from $ENV_FILE"
fi

# ─── render frps.toml + Caddyfile ─────────────────────────────────────────
log "Rendering /etc/frp/frps.toml"
sed -e "s|__FRP_PLUGIN_SECRET__|$FRP_PLUGIN_SECRET|g" \
    -e "s|__FRPS_ADMIN_PASSWORD__|$FRPS_ADMIN_PASSWORD|g" \
    "$DEPLOY_DIR/frps.toml" > /etc/frp/frps.toml
chown root:frps /etc/frp/frps.toml
chmod 640 /etc/frp/frps.toml

log "Installing /etc/caddy/Caddyfile"
install -m 644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile

# ─── Cloudflare API token for Caddy DNS-01 ────────────────────────────────
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_ARG"
if [ -z "$CLOUDFLARE_API_TOKEN" ] && [ ! -f /etc/caddy/env ]; then
  warn "Caddy needs a Cloudflare API token (Zone -> DNS -> Edit, $DOMAIN zone only)"
  warn "to issue the wildcard certificate via ACME DNS-01."
  read -r -s -p "Cloudflare API token: " CLOUDFLARE_API_TOKEN
  echo
  [ -n "$CLOUDFLARE_API_TOKEN" ] || err "No token provided (re-run with --cloudflare-token TOKEN)"
fi
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
  cat > /etc/caddy/env <<EOF
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN
EOF
  chown root:root /etc/caddy/env
  chmod 600 /etc/caddy/env
  ok "Wrote /etc/caddy/env"
else
  log "Keeping existing /etc/caddy/env"
fi
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/basis-cloud.conf <<EOF
# Installed by Basis Remote provision.sh — exposes CLOUDFLARE_API_TOKEN to
# the Cloudflare DNS plugin referenced from /etc/caddy/Caddyfile.
[Service]
EnvironmentFile=/etc/caddy/env
EOF

# ─── systemd units + sudoers + backup ─────────────────────────────────────
log "Installing systemd units"
cp "$DEPLOY_DIR/basis-cloud.service"        /etc/systemd/system/
cp "$DEPLOY_DIR/frps.service"               /etc/systemd/system/
cp "$DEPLOY_DIR/basis-cloud-backup.service" /etc/systemd/system/
cp "$DEPLOY_DIR/basis-cloud-backup.timer"   /etc/systemd/system/
install -m 755 "$DEPLOY_DIR/backup.sh" /usr/local/bin/basis-cloud-backup
install -m 755 "$DEPLOY_DIR/basis-comp" /usr/local/bin/basis-comp
systemctl daemon-reload

log "Installing /etc/sudoers.d/basis-cloud"
cp "$DEPLOY_DIR/sudoers-basis-cloud" /etc/sudoers.d/basis-cloud
chmod 440 /etc/sudoers.d/basis-cloud
visudo -cf /etc/sudoers.d/basis-cloud >/dev/null 2>&1 \
  || { rm -f /etc/sudoers.d/basis-cloud; err "Generated sudoers file failed validation"; }

# ─── firewall ─────────────────────────────────────────────────────────────
log "Configuring ufw (allow 22, 80, 443, 7000)"
ufw allow 22/tcp   >/dev/null   # SSH
ufw allow 80/tcp   >/dev/null   # ACME HTTP + redirects
ufw allow 443/tcp  >/dev/null   # Caddy TLS
ufw allow 7000/tcp >/dev/null   # frps control connections from customer boxes
ufw --force enable >/dev/null
ok "ufw active: $(ufw status | head -1)"

# ─── start everything ─────────────────────────────────────────────────────
log "Enabling and starting services"
systemctl enable postgresql caddy frps basis-cloud basis-cloud-backup.timer >/dev/null
systemctl restart caddy
systemctl restart frps
systemctl start basis-cloud-backup.timer

if [ -e "$APP_ROOT/current" ]; then
  systemctl reset-failed basis-cloud 2>/dev/null || true
  systemctl restart basis-cloud
  sleep 3
  systemctl is-active --quiet basis-cloud \
    || err "basis-cloud failed to start. Check: journalctl -u basis-cloud -n 50"
  ok "basis-cloud running"
else
  warn "No application version deployed yet — basis-cloud is enabled but not started."
fi
systemctl is-active --quiet frps || err "frps failed to start. Check: journalctl -u frps -n 50"
systemctl is-active --quiet caddy || warn "caddy not active — check: journalctl -u caddy -n 50"

# ─── done ─────────────────────────────────────────────────────────────────
PUBLIC_IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"

cat <<EOF

  ${GREEN}✓ Basis Remote box provisioned${NC}

  ${YELLOW}Still to do:${NC}

  1. Deploy the application (first time):
       ${BLUE}sudo bash $DEPLOY_DIR/update.sh --version cloud-vX.Y.Z${NC}

  2. ${RED}Stripe keys are placeholders${NC} — the service cannot take payments
     until you edit ${BLUE}$ENV_FILE${NC} and replace every CHANGEME
     (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, both STRIPE_PRICE_* ids),
     then: ${BLUE}sudo systemctl restart basis-cloud${NC}
     Dashboard setup steps are in cloud/README.md.

  3. DNS (Cloudflare, ${RED}DNS only / grey cloud${NC} — orange-cloud proxying
     breaks the relay and violates CF ToS for streamed media):
       A  $DOMAIN      -> ${PUBLIC_IP:-<this box>}
       A  *.$DOMAIN    -> ${PUBLIC_IP:-<this box>}
     Then watch the wildcard cert get issued: journalctl -u caddy -f

  4. Offsite backups: set BACKUP_REMOTE_CMD in $ENV_FILE (see comments there).

  Manage:
    sudo systemctl status basis-cloud frps caddy
    sudo journalctl -u basis-cloud -f

EOF
