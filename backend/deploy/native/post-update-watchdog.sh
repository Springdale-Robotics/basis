#!/usr/bin/env bash
#
# Post-update health watchdog with automatic code rollback.
#
# The self-updater (installer-commands.ts, "update-self") runs this AFTER it has
# staged the new version and swapped the /opt/basis/current symlink. It restarts
# the services, waits for a health check, and — if the new version never becomes
# healthy — reverts the symlink to the previous version and restarts again.
#
# It must run in its OWN cgroup, which is why basis-post-update.service exists:
# restarting basis.service kills everything in basis.service's cgroup, and the
# updater previously launched this with `setsid` from inside it. setsid gives a
# new session, not a new cgroup, so systemd killed the watchdog and its in-flight
# `systemctl restart` — basis-worker was never restarted and the health check and
# rollback never ran (basis-bugs#9). Args therefore arrive via EnvironmentFile
# rather than argv; $1/$2 remain supported for direct invocation and tests.
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
# Args (env preferred, argv supported):
#   BASIS_PREV_TARGET / $1  previous symlink target (e.g. "versions/0.1.13-alpha")
#   BASIS_NEW_VERSION / $2  new version string (for logging)
#
# Env overrides (used by the test harness; production uses the defaults):
#   BASIS_SYSTEMCTL       command used to drive systemd     (default: "sudo systemctl")
#   BASIS_CURRENT_LINK    path of the "current" symlink      (default: /opt/basis/current)
#   BASIS_HEALTH_URL      health endpoint to poll            (default: http://127.0.0.1:$PORT/api/v1/health/live)
#   BASIS_HEALTH_RETRIES  poll attempts                      (default: 30)
#   BASIS_HEALTH_INTERVAL seconds between polls              (default: 2)
#   BASIS_RESTART_DELAY   seconds to wait before restarting  (default: 3)
set -u

PREV_TARGET="${1:-${BASIS_PREV_TARGET:-}}"
NEW_VERSION="${2:-${BASIS_NEW_VERSION:-unknown}}"

# Under the systemd unit we are already root; sudo would be both unnecessary and
# unavailable-by-policy. Keep sudo for direct invocation as the basis user.
if [ "$(id -u)" -eq 0 ]; then
  SYSTEMCTL="${BASIS_SYSTEMCTL:-systemctl}"
else
  SYSTEMCTL="${BASIS_SYSTEMCTL:-sudo systemctl}"
fi
CURRENT_LINK="${BASIS_CURRENT_LINK:-/opt/basis/current}"
HEALTH_URL="${BASIS_HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/v1/health/live}"
RETRIES="${BASIS_HEALTH_RETRIES:-30}"
INTERVAL="${BASIS_HEALTH_INTERVAL:-2}"
DELAY="${BASIS_RESTART_DELAY:-3}"

# PREV_TARGET reaches us from a file written by the unprivileged basis user and
# is fed to `ln -sfn` as root. Anything that isn't a versions/ path we produced
# is refused — a corrupt or hostile value becomes a logged no-op rather than an
# arbitrary root-owned symlink.
validate_prev_target() {
  case "$PREV_TARGET" in
    '') ;;
    versions/*) case "$PREV_TARGET" in *..*) return 1 ;; esac ;;
    *) return 1 ;;
  esac
  return 0
}

log() {
  logger -t basis-update "$*" 2>/dev/null || true
  echo "basis-update: $*"
}

restart_service() {
  # reset-failed clears any latched start-limit from an earlier aborted attempt.
  # The parser sidecar is best-effort; the core units are not.
  $SYSTEMCTL reset-failed basis basis-worker 2>/dev/null || true
  $SYSTEMCTL restart basis-ingredient-parser 2>/dev/null || true
  # Worker first, basis last. Order is load-bearing on the legacy path where
  # this runs inside basis.service's cgroup: restarting basis kills the caller,
  # so anything queued after it never happens. Harmless here, protective there.
  $SYSTEMCTL restart basis-worker
  $SYSTEMCTL restart basis
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

if ! validate_prev_target; then
  log "refusing suspicious rollback target '$PREV_TARGET' — continuing without rollback"
  PREV_TARGET=""
fi

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
