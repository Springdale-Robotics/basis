#!/usr/bin/env bash
#
# Basis native installer (no Docker).
#
# Installs Node 20, PostgreSQL, Redis, then deploys Basis under /opt/basis with
# a systemd unit. Designed for Ubuntu/Debian. macOS support is partial — see
# the macOS section at the bottom.
#
# Usage:
#   sudo bash install.sh --source /path/to/basis-source
#
# The --source path is a local Basis checkout (or extracted release tarball).
# Once the repo is public we'll switch to downloading a release tarball from
# GitHub automatically.

set -eo pipefail

# ─── helpers ──────────────────────────────────────────────────────────────
RED='\033[1;31m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; BLUE='\033[1;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; exit 1; }

usage() {
  cat <<EOF
Usage: sudo bash install.sh --source /path/to/basis-source

Options:
  --source DIR    Path to a Basis source checkout or extracted tarball.
  --port PORT     Backend port (default 3000).
  --skip-deps     Don't apt-install Node/Postgres/Redis (use existing).
  -h, --help      Show this message.
EOF
  exit 0
}

# ─── args ─────────────────────────────────────────────────────────────────
SOURCE_DIR=""
PORT=3000
SKIP_DEPS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)    SOURCE_DIR="$2"; shift 2 ;;
    --port)      PORT="$2"; shift 2 ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    -h|--help)   usage ;;
    *)           err "Unknown argument: $1 (try --help)" ;;
  esac
done

[ "$EUID" -eq 0 ] || err "Run as root: sudo bash $0 ..."
[ -n "$SOURCE_DIR" ] || err "Pass --source /path/to/basis-source"
[ -d "$SOURCE_DIR/backend" ] && [ -d "$SOURCE_DIR/frontend" ] \
  || err "$SOURCE_DIR doesn't look like a Basis source tree (missing backend/ or frontend/)"
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"  # absolute path

# ─── OS detect ────────────────────────────────────────────────────────────
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
elif [[ "$OSTYPE" == darwin* ]]; then
  OS_ID="macos"
else
  err "Can't detect OS (no /etc/os-release)"
fi

case "$OS_ID" in
  ubuntu|debian|raspbian) PKG=apt ;;
  macos)
    warn "macOS support: this script handles the app layout but not the"
    warn "Node/Postgres/Redis install — install them via Homebrew first:"
    warn "    brew install node@20 postgresql@16 redis"
    warn "Then re-run with --skip-deps."
    [ "$SKIP_DEPS" -eq 1 ] || err "Run with --skip-deps on macOS."
    PKG=brew
    ;;
  *) err "Unsupported OS: $OS_ID. Supported: Ubuntu, Debian, macOS." ;;
esac

# ─── install system deps ──────────────────────────────────────────────────
if [ "$SKIP_DEPS" -eq 0 ] && [ "$PKG" = apt ]; then
  log "Updating apt and installing base packages"
  apt-get update -qq
  apt-get install -y -qq \
    curl ca-certificates gnupg build-essential git ffmpeg rsync ufw openssl

  if ! command -v node >/dev/null || [ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
    log "Installing Node 20 from NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  fi
  ok "Node $(node -v)"

  if ! command -v psql >/dev/null; then
    log "Installing PostgreSQL"
    apt-get install -y -qq postgresql postgresql-contrib
    systemctl enable --now postgresql
  fi
  ok "PostgreSQL $(psql --version | awk '{print $3}')"

  if ! command -v redis-cli >/dev/null; then
    log "Installing Redis"
    apt-get install -y -qq redis-server
    systemctl enable --now redis-server
  fi
  ok "Redis $(redis-cli --version | awk '{print $2}')"
else
  log "Skipping system dependency install (--skip-deps)"
fi

# ─── create basis system user ─────────────────────────────────────────────
if ! id basis >/dev/null 2>&1; then
  log "Creating system user 'basis'"
  # --system gives no shell login by default; we override to /bin/bash so the
  # in-UI terminal works. --home /opt/basis matches our install layout.
  if [ "$OS_ID" = macos ]; then
    err "macOS user creation isn't automated. Create a 'basis' user manually."
  fi
  useradd --system --create-home --home-dir /opt/basis --shell /bin/bash basis
  # Sudo group is 'sudo' on Debian/Ubuntu, 'wheel' on RHEL.
  if getent group sudo >/dev/null; then
    usermod -aG sudo basis
  elif getent group wheel >/dev/null; then
    usermod -aG wheel basis
  fi
  ok "Created 'basis' user"
fi

# Prompt for password if unset
if ! passwd -S basis 2>/dev/null | awk '{print $2}' | grep -qE '^P'; then
  warn "The 'basis' user has no password yet."
  warn "You'll be prompted to set one. This password is used when you sudo"
  warn "from the in-UI terminal for maintenance tasks."
  echo
  passwd basis
fi

# ─── lay out /opt/basis ───────────────────────────────────────────────────
log "Creating directory layout"
install -d -o basis -g basis /opt/basis/versions
install -d -o basis -g basis /opt/basis/data
install -d -o basis -g basis /opt/basis/data/storage
install -d -o basis -g basis /opt/basis/data/backups
install -d -o basis -g basis /opt/basis/bin

# Each install lives at versions/YYYYMMDD-HHMMSS. /opt/basis/current is a
# symlink to the active version, swapped atomically on update.
VERSION_TAG="$(date +%Y%m%d-%H%M%S)"
INSTALL_PATH="/opt/basis/versions/$VERSION_TAG"
log "Deploying source to $INSTALL_PATH"
install -d -o basis -g basis "$INSTALL_PATH"

# rsync the source, skipping dev-only directories. .env stays at /opt/basis/.env
# (not inside the version dir) so updates don't overwrite it.
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'frontend/dist' \
  --exclude 'backend/dist' \
  --exclude 'backend/bin' \
  --exclude 'backend/storage' \
  --chown=basis:basis \
  "$SOURCE_DIR/" "$INSTALL_PATH/"

# ─── build ────────────────────────────────────────────────────────────────
log "Building backend (npm ci + tsc) — first run takes ~5min"
sudo -u basis -H bash -c "cd '$INSTALL_PATH/backend' && npm ci --no-audit --no-fund && npm run build"

log "Building frontend (npm ci + vite build)"
sudo -u basis -H bash -c "cd '$INSTALL_PATH/frontend' && npm ci --no-audit --no-fund && npm run build"

# Swap current → this version
ln -sfn "versions/$VERSION_TAG" /opt/basis/current

# ─── database ─────────────────────────────────────────────────────────────
if [ ! -f /opt/basis/.env ]; then
  log "First install — generating secrets and database"
  DB_PASSWORD="$(openssl rand -base64 33 | tr -d '/+=' | head -c 32)"
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"

  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'basis') THEN
    CREATE USER basis WITH PASSWORD '$DB_PASSWORD';
  ELSE
    -- Role already exists (e.g. .env was deleted but the DB user wasn't).
    -- Sync its password to the freshly generated one so the new .env matches.
    ALTER USER basis WITH PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE basis OWNER basis' WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'basis'
)\gexec
GRANT ALL PRIVILEGES ON DATABASE basis TO basis;
SQL

  cat > /opt/basis/.env <<EOF
# Basis — generated by install.sh on $(date -u +%FT%TZ)
DATABASE_URL=postgres://basis:$DB_PASSWORD@localhost:5432/basis
REDIS_URL=redis://localhost:6379
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
NODE_ENV=production
PORT=$PORT
HOST=0.0.0.0
# This install runs a dedicated worker process (basis-worker.service), so the
# API process must not also run the BullMQ workers — otherwise jobs run twice.
WORKERS_IN_PROCESS=false
STORAGE_PATH=/opt/basis/data/storage
FRONTEND_DIST=/opt/basis/current/frontend/dist
# CORS_ORIGINS is empty by default — the backend serves the SPA itself, so
# same-origin requests don't need CORS. Add origins here if you want to allow
# the dev frontend or another origin to hit this API.
CORS_ORIGINS=
EOF
  chown basis:basis /opt/basis/.env
  chmod 600 /opt/basis/.env
  ok "Generated /opt/basis/.env"
else
  log "Existing /opt/basis/.env detected — keeping it"
fi

# ─── migrations ───────────────────────────────────────────────────────────
log "Running database migrations"
sudo -u basis -H bash -c "cd '$INSTALL_PATH/backend' && set -a && . /opt/basis/.env && set +a && npm run db:migrate"

# ─── systemd ──────────────────────────────────────────────────────────────
if [ "$OS_ID" != macos ]; then
  log "Installing systemd units"
  cp "$INSTALL_PATH/backend/deploy/native/basis.service"        /etc/systemd/system/
  cp "$INSTALL_PATH/backend/deploy/native/basis-worker.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable basis.service basis-worker.service >/dev/null

  # Let the service account restart its own units without a password, so the
  # in-UI "Update" flow can hand off to the new version unattended (its restart
  # is detached with stdin from /dev/null, so an interactive sudo prompt would
  # hang forever and the new code would never start). Deliberately narrow — only
  # these exact systemctl invocations, nothing else; apt/tailscale/etc. still
  # require the password.
  SYSTEMCTL="$(command -v systemctl)"
  cat > /etc/sudoers.d/basis <<SUDOERS
basis ALL=(root) NOPASSWD: $SYSTEMCTL restart basis basis-worker, $SYSTEMCTL restart basis, $SYSTEMCTL restart basis-worker
SUDOERS
  chmod 440 /etc/sudoers.d/basis
  visudo -cf /etc/sudoers.d/basis >/dev/null 2>&1 \
    || { rm -f /etc/sudoers.d/basis; err "Generated sudoers file failed validation"; }
  ok "Installed /etc/sudoers.d/basis (passwordless restart of basis units only)"

  log "Starting Basis"
  systemctl restart basis.service
  systemctl restart basis-worker.service
  sleep 3
  systemctl is-active --quiet basis.service \
    || err "basis.service failed to start. Check: journalctl -u basis -n 50"
  systemctl is-active --quiet basis-worker.service \
    || err "basis-worker.service failed to start. Check: journalctl -u basis-worker -n 50"

  # Firewall — best-effort; only ufw is well-known on Debian/Ubuntu.
  if command -v ufw >/dev/null && ufw status | head -1 | grep -q active; then
    ufw allow "$PORT"/tcp >/dev/null
  fi
fi

# ─── done ─────────────────────────────────────────────────────────────────
LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LOCAL_IP" ] && LOCAL_IP="localhost"

cat <<EOF

  ${GREEN}✓ Basis is installed${NC}

  Open your browser to finish setup:
    ${BLUE}http://localhost:$PORT${NC}
    ${BLUE}http://$LOCAL_IP:$PORT${NC}  (LAN)

  Manage the service:
    sudo systemctl status basis
    sudo journalctl -u basis -f
    sudo systemctl restart basis

  App lives at /opt/basis. Logs go to the systemd journal.

EOF
