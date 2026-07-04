#!/usr/bin/env bash
#
# Basis Remote nightly database backup.
#
# Runs as the basis-cloud user via basis-cloud-backup.service (triggered by
# basis-cloud-backup.timer; provision.sh installs this script to
# /usr/local/bin/basis-cloud-backup). Dumps the basis_cloud database with
# pg_dump -Fc into /var/backups/basis-cloud/ and keeps the newest 14 dumps.
#
# THIS DATABASE IS THE BUSINESS (accounts, subscriptions, tunnel tokens).
# Backups land on the same disk as the database, so a single disk failure
# loses both — configure the off-host hook. Mirroring the main app's
# convention (backend/src/modules/system/system-backup.service.ts), set
# BACKUP_REMOTE_CMD in /opt/basis-cloud/.env and the finished dump's path is
# exposed via environment (never string-interpolated into a shell), e.g.:
#
#   BACKUP_REMOTE_CMD=rclone copy "$BASIS_BACKUP_FILE" remote:basis-cloud-backups/
#
# Restore: see cloud/README.md ("Backup & restore").
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/basis-cloud}"
ENV_FILE="${ENV_FILE:-/opt/basis-cloud/.env}"
KEEP="${KEEP:-14}"

log() { echo "basis-cloud-backup: $*"; }

[ -f "$ENV_FILE" ] || { log "missing $ENV_FILE — has provision.sh run?"; exit 1; }
[ -d "$BACKUP_DIR" ] || { log "missing $BACKUP_DIR — has provision.sh run?"; exit 1; }

# Load DATABASE_URL (and optional BACKUP_REMOTE_CMD) from the app env.
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/basis-cloud-$STAMP.dump"

log "dumping to $FILE"
pg_dump -Fc --dbname="$DATABASE_URL" --file="$FILE"
chmod 600 "$FILE"
log "dump complete ($(du -h "$FILE" | cut -f1))"

# Rotate: keep the newest $KEEP dumps.
ls -1t "$BACKUP_DIR"/basis-cloud-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  log "rotating out $old"
  rm -f "$old"
done

# Optional off-host copy. The path goes via environment, not interpolation,
# so filenames can never land unquoted in a shell.
if [ -n "${BACKUP_REMOTE_CMD:-}" ]; then
  log "running BACKUP_REMOTE_CMD"
  BASIS_BACKUP_FILE="$FILE" BASIS_BACKUP_DIR="$BACKUP_DIR" bash -c "$BACKUP_REMOTE_CMD"
  log "off-host copy done"
else
  log "BACKUP_REMOTE_CMD not set — backup remains on this host only"
fi
