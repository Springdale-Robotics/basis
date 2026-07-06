#!/usr/bin/env bash
#
# Basis Remote (cloud) updater with automatic rollback.
#
# Stages a release under /opt/basis-cloud/versions/<version>, installs
# production deps, runs migrations, smoke-tests, atomically swaps the
# /opt/basis-cloud/current symlink, restarts basis-cloud, then polls /health.
# If the new version never becomes healthy, the symlink is reverted to the
# previous version and the service restarted (mirrors the box-side
# backend/deploy/native/post-update-watchdog.sh approach). Rollback is CODE
# only — migrations are not reverted; forward migrations are usually additive
# so the old code runs fine against the new schema. If a migration was
# destructive, restore last night's dump from /var/backups/basis-cloud/.
#
# Usage:
#   sudo bash update.sh --version cloud-v0.2.0    # download a GitHub release
#   sudo bash update.sh --source /path/to/staged  # deploy a local build
#
# --source expects the release layout (what cloud-release.yml stages):
#   <dir>/VERSION  <dir>/server/{dist,package.json,package-lock.json,drizzle}/
#   <dir>/frontend/dist/  <dir>/deploy/

set -euo pipefail

# ─── helpers ──────────────────────────────────────────────────────────────
RED='\033[1;31m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; BLUE='\033[1;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; exit 1; }

usage() {
  cat <<EOF
Usage: sudo bash update.sh (--version cloud-vX.Y.Z | --source DIR)

Options:
  --version TAG   Release tag to download from GitHub
                  (github.com/$REPO), e.g. cloud-v0.2.0.
  --source DIR    Path to a locally staged release tree (see header).
  -h, --help      Show this message.
EOF
  exit 0
}

# ─── config ───────────────────────────────────────────────────────────────
REPO="${REPO:-Springdale-Robotics/basis}"
APP_ROOT="/opt/basis-cloud"
ENV_FILE="$APP_ROOT/.env"
CURRENT_LINK="$APP_ROOT/current"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
KEEP_VERSIONS=3

# ─── args ─────────────────────────────────────────────────────────────────
VERSION_ARG=""
SOURCE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION_ARG="${2:-}"; shift 2 ;;
    --source)  SOURCE_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *)         err "Unknown argument: $1 (try --help)" ;;
  esac
done

[ "$EUID" -eq 0 ] || err "Run as root: sudo bash $0 ..."
[ -f "$ENV_FILE" ] || err "Missing $ENV_FILE — run provision.sh first"
{ [ -n "$VERSION_ARG" ] || [ -n "$SOURCE_DIR" ]; } || err "Pass --version cloud-vX.Y.Z or --source DIR"
{ [ -z "$VERSION_ARG" ] || [ -z "$SOURCE_DIR" ]; } || err "--version and --source are mutually exclusive"

TMP_DIR=""
cleanup() { if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi; }
trap cleanup EXIT

# ─── resolve source ───────────────────────────────────────────────────────
if [ -n "$VERSION_ARG" ]; then
  # Accept "cloud-v0.2.0" or bare "0.2.0".
  TAG="$VERSION_ARG"
  [[ "$TAG" == cloud-v* ]] || TAG="cloud-v$TAG"
  VERSION="${TAG#cloud-v}"
  TARBALL="basis-cloud-$VERSION.tar.gz"
  BASE_URL="https://github.com/$REPO/releases/download/$TAG"

  TMP_DIR="$(mktemp -d)"
  log "Downloading $TARBALL from $TAG"
  curl -fL --retry 3 -o "$TMP_DIR/$TARBALL" "$BASE_URL/$TARBALL" \
    || err "Download failed: $BASE_URL/$TARBALL"
  curl -fL --retry 3 -o "$TMP_DIR/$TARBALL.sha256" "$BASE_URL/$TARBALL.sha256" \
    || err "Checksum download failed — refusing to install an unverified tarball"

  log "Verifying checksum"
  (cd "$TMP_DIR" && sha256sum -c "$TARBALL.sha256") \
    || err "Checksum verification FAILED — refusing to install"
  ok "Checksum verified"

  tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"
  SRC="$TMP_DIR/basis-cloud-$VERSION"
  [ -d "$SRC" ] || err "Tarball didn't contain basis-cloud-$VERSION/"
else
  [ -d "$SOURCE_DIR" ] || err "--source $SOURCE_DIR is not a directory"
  SRC="$(cd "$SOURCE_DIR" && pwd)"
  if [ -f "$SRC/VERSION" ]; then
    VERSION="$(head -1 "$SRC/VERSION" | tr -d '[:space:]')"
  else
    VERSION="local-$(date +%Y%m%d-%H%M%S)"
    warn "No VERSION file in --source; using $VERSION"
  fi
fi

[ -d "$SRC/server/dist" ]    || err "$SRC/server/dist missing — not a built release"
[ -f "$SRC/server/package-lock.json" ] || err "$SRC/server/package-lock.json missing"
[ -d "$SRC/frontend/dist" ]  || err "$SRC/frontend/dist missing"

# ─── stage version ────────────────────────────────────────────────────────
VERSION_DIR="$APP_ROOT/versions/$VERSION"
if [ -d "$VERSION_DIR" ]; then
  warn "Version $VERSION already staged — replacing it"
  rm -rf "$VERSION_DIR"
fi
log "Staging $VERSION at $VERSION_DIR"
install -d -o basis-cloud -g basis-cloud "$VERSION_DIR"
rsync -a --chown=basis-cloud:basis-cloud "$SRC/" "$VERSION_DIR/"

# The build is a tsc emit, not a bundle — runtime deps must be installed on
# the host from the shipped lockfile.
log "Installing production dependencies (npm ci --omit=dev)"
sudo -u basis-cloud -H bash -c \
  "cd '$VERSION_DIR/server' && npm ci --omit=dev --no-audit --no-fund"

# Cheap pre-flight: the entrypoint at least parses before we touch the DB or
# the live symlink.
log "Smoke-testing the build (node --check)"
sudo -u basis-cloud -H bash -c "cd '$VERSION_DIR/server' && node --check dist/index.js" \
  || err "dist/index.js failed to parse — aborting before migrations/swap"

# ─── migrations ───────────────────────────────────────────────────────────
# migrate.js needs only DATABASE_URL. Extract it rather than bash-sourcing the
# whole env file: it's systemd-format, and values like
# EMAIL_FROM="Basis Remote <noreply@…>" (spaces + shell metacharacters) make
# `. .env` a syntax error. A postgres URL has no shell-special chars, so
# passing it explicitly is safe. (migrate.js also imports dotenv/config, a
# harmless no-op here since there's no .env in the server dir.)
log "Running database migrations"
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$DB_URL" ] || err "No DATABASE_URL in $ENV_FILE"
sudo -u basis-cloud -H DATABASE_URL="$DB_URL" bash -c \
  "cd '$VERSION_DIR/server' && node dist/migrate.js" \
  || err "Migrations failed — the current symlink was NOT swapped; the running version is untouched"

# ─── atomic swap + restart ────────────────────────────────────────────────
PREV_TARGET="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
log "Swapping $CURRENT_LINK -> versions/$VERSION (was: ${PREV_TARGET:-none})"
ln -sfn "versions/$VERSION" "$CURRENT_LINK.new"
mv -T "$CURRENT_LINK.new" "$CURRENT_LINK"

log "Restarting basis-cloud"
systemctl reset-failed basis-cloud 2>/dev/null || true
systemctl restart basis-cloud

# ─── health poll + auto-rollback ──────────────────────────────────────────
healthy() {
  local i
  for ((i = 0; i < HEALTH_RETRIES; i++)); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

if healthy; then
  ok "$VERSION is live and healthy"

  # Keep the newest $KEEP_VERSIONS versions (never the live one) so rollback
  # targets stay available without filling the disk.
  CURRENT_BASE="$(basename "$(readlink "$CURRENT_LINK")")"
  ls -1t "$APP_ROOT/versions" | tail -n +"$((KEEP_VERSIONS + 1))" | while read -r v; do
    if [ "$v" != "$CURRENT_BASE" ]; then
      log "Pruning old version $v"
      rm -rf "$APP_ROOT/versions/${v:?}"
    fi
  done
  exit 0
fi

warn "$VERSION did not become healthy within $((HEALTH_RETRIES * HEALTH_INTERVAL))s"

if [ -z "$PREV_TARGET" ]; then
  err "No previous version to roll back to — manual intervention required: journalctl -u basis-cloud -n 100"
fi

warn "Rolling back to $PREV_TARGET"
ln -sfn "$PREV_TARGET" "$CURRENT_LINK.rollback"
mv -T "$CURRENT_LINK.rollback" "$CURRENT_LINK"
systemctl reset-failed basis-cloud 2>/dev/null || true
systemctl restart basis-cloud

if healthy; then
  warn "Rolled back to $PREV_TARGET and it is healthy again."
  warn "NOTE: migrations from $VERSION were NOT reverted. If they were"
  warn "destructive, restore a dump from /var/backups/basis-cloud/."
  warn "Diagnose the failed version: journalctl -u basis-cloud -n 100"
  exit 1
fi

err "Rollback restart also unhealthy — manual intervention required: journalctl -u basis-cloud -n 100"
