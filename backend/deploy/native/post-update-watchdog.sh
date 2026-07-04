#!/usr/bin/env bash
#
# Post-update health watchdog with automatic code rollback.
#
# The self-updater (installer-commands.ts, "update-self") invokes this DETACHED
# via setsid, AFTER it has staged the new version and swapped the
# /opt/basis/current symlink. This script restarts the service, waits for it to
# pass a health check, and — if the new version never becomes healthy — reverts
# the symlink to the previous version and restarts again.
#
# Before this existed, a new version that passed the pre-swap smoke test but
# crash-looped at runtime (e.g. a migration that interacts badly with real data)
# was left crash-looping under systemd Restart=always, with recovery entirely
# manual. This makes the common failure self-healing.
#
# It rolls back CODE only. The DB pre-update snapshot is NOT auto-restored:
# forward migrations are usually additive, so the old code runs fine against the
# new schema, and auto-restoring would silently discard anything written since
# the update. If the migration was destructive, the log points the operator at
# the snapshot.
#
# Args:
#   $1  previous symlink target (e.g. "versions/0.1.13-alpha"); empty if unknown
#   $2  new version string (for logging)
#
# Env overrides (used by the test harness; production uses the defaults):
#   BASIS_SYSTEMCTL       command used to drive systemd     (default: "sudo systemctl")
#   BASIS_CURRENT_LINK    path of the "current" symlink      (default: /opt/basis/current)
#   BASIS_HEALTH_URL      health endpoint to poll            (default: http://127.0.0.1:$PORT/api/v1/health/live)
#   BASIS_HEALTH_RETRIES  poll attempts                      (default: 30)
#   BASIS_HEALTH_INTERVAL seconds between polls              (default: 2)
#   BASIS_RESTART_DELAY   seconds to wait before restarting  (default: 3)
set -u

PREV_TARGET="${1:-}"
NEW_VERSION="${2:-unknown}"

SYSTEMCTL="${BASIS_SYSTEMCTL:-sudo systemctl}"
CURRENT_LINK="${BASIS_CURRENT_LINK:-/opt/basis/current}"
HEALTH_URL="${BASIS_HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/v1/health/live}"
RETRIES="${BASIS_HEALTH_RETRIES:-30}"
INTERVAL="${BASIS_HEALTH_INTERVAL:-2}"
DELAY="${BASIS_RESTART_DELAY:-3}"

log() {
  logger -t basis-update "$*" 2>/dev/null || true
  echo "basis-update: $*"
}

restart_service() {
  # reset-failed clears any latched start-limit from an earlier aborted attempt.
  # The parser sidecar is best-effort; the core units are not.
  $SYSTEMCTL reset-failed basis basis-worker 2>/dev/null || true
  $SYSTEMCTL restart basis-ingredient-parser 2>/dev/null || true
  $SYSTEMCTL restart basis basis-worker
}

healthy() {
  local i
  for ((i = 0; i < RETRIES; i++)); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$INTERVAL"
  done
  return 1
}

sleep "$DELAY"
log "restarting into $NEW_VERSION"
restart_service

if healthy; then
  log "$NEW_VERSION is healthy"
  exit 0
fi

log "$NEW_VERSION did not become healthy within $((RETRIES * INTERVAL))s"

if [ -z "$PREV_TARGET" ]; then
  log "no previous version recorded — cannot auto-roll back; manual intervention required"
  exit 1
fi

log "rolling back to $PREV_TARGET"
ln -sfn "$PREV_TARGET" "$CURRENT_LINK.rollback" && mv -T "$CURRENT_LINK.rollback" "$CURRENT_LINK"
restart_service

if healthy; then
  log "rolled back to $PREV_TARGET. NOTE: the DB pre-update snapshot was NOT restored — restore it manually if the failed migration is incompatible with this version."
  exit 1
fi

log "rollback restart also unhealthy — manual intervention required"
exit 1
