#!/usr/bin/env bash
# Home Manager — one-shot privileged installer.
#
# Usage:
#   curl -fsSL homemanager.app/install.sh | sudo bash
#   # or, from a checkout:
#   sudo bash scripts/install.sh
#
# This is the ONE elevated step for a Home Manager deployment. It bundles
# every operation that needs root into a single sudo session so the rest of
# the app (including the web-based Remote Access settings) never has to prompt
# for credentials. Re-running is safe — every operation is idempotent.
#
# What it does:
#   1. Sanity checks (running as root, OS detected, target user resolved).
#   2. Tailscale operator grant — lets the backend (running as the target user)
#      call `tailscale serve` without sudo. Skipped if Tailscale isn't
#      installed or already authorised.
#   3. (Optional) systemd unit installation — for production deployments that
#      want auto-start. Disabled by default; pass --systemd to opt in.
#   4. Permissions on the data directory.
#
# What it does NOT do:
#   - Install Docker, Node, or other base dependencies — see the project's
#     installation guide for those prerequisites.
#   - Create the database, push schema, seed data — that lives in the app's
#     own first-run setup wizard (./dev.sh init runs that for development).
#   - Generate or rotate any secrets.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────

INSTALL_USER="${INSTALL_USER:-${SUDO_USER:-${USER:-root}}}"
INSTALL_DATA_DIR="${INSTALL_DATA_DIR:-/var/lib/homemanager}"
ENABLE_SYSTEMD=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) INSTALL_USER="$2"; shift 2 ;;
    --data-dir) INSTALL_DATA_DIR="$2"; shift 2 ;;
    --systemd) ENABLE_SYSTEMD=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,/^# *$/p' "$0" | sed 's/^# *//'
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────

C_RESET=$'\e[0m'; C_BLUE=$'\e[34m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'
log()  { echo "${C_BLUE}::${C_RESET} $*"; }
ok()   { echo "${C_GREEN}✓${C_RESET}  $*"; }
warn() { echo "${C_YELLOW}!${C_RESET}  $*"; }
err()  { echo "${C_RED}✗${C_RESET}  $*" >&2; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "    (dry-run) $*"
  else
    "$@"
  fi
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "This installer must run as root. Re-run with sudo:"
    err "    sudo bash $0 $*"
    exit 1
  fi
}

ensure_user_exists() {
  if ! id -u "$INSTALL_USER" >/dev/null 2>&1; then
    err "Target user '$INSTALL_USER' does not exist. Pass --user <name> or set INSTALL_USER."
    exit 1
  fi
}

# ─── Steps ────────────────────────────────────────────────────────────────

step_tailscale_operator() {
  log "Tailscale operator grant"
  if ! command -v tailscale >/dev/null 2>&1; then
    warn "tailscale CLI not found — skipping operator grant. Install Tailscale later and re-run."
    return 0
  fi
  # Detect current operator. `tailscale serve status` is the wrong probe — it
  # reads config and succeeds without perms. `tailscale set --operator` itself
  # is idempotent, so we run it unconditionally; rely on `tailscale serve
  # --help` working as a "tailscale is reachable" smoke test instead.
  if ! tailscale serve --help >/dev/null 2>&1; then
    warn "tailscale CLI present but daemon not responding — skipping operator grant"
    return 0
  fi
  log "Granting Tailscale operator to '$INSTALL_USER' (idempotent — overwrites prior value)"
  run tailscale set --operator="$INSTALL_USER"
  ok "Tailscale operator granted to $INSTALL_USER"
}

step_data_dir() {
  log "Data directory at $INSTALL_DATA_DIR"
  if [[ ! -d $INSTALL_DATA_DIR ]]; then
    run mkdir -p "$INSTALL_DATA_DIR"
  fi
  run chown -R "$INSTALL_USER:$INSTALL_USER" "$INSTALL_DATA_DIR"
  run chmod 700 "$INSTALL_DATA_DIR"
  ok "Data directory owned by $INSTALL_USER"
}

step_systemd_unit() {
  [[ $ENABLE_SYSTEMD -eq 1 ]] || return 0
  log "Installing systemd unit"
  local unit_path=/etc/systemd/system/homemanager.service
  local project_dir
  project_dir=$(cd "$(dirname "$0")/.." && pwd)
  local unit
  unit=$(cat <<EOF
[Unit]
Description=Home Manager backend
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$INSTALL_USER
WorkingDirectory=$project_dir
ExecStart=/usr/bin/env bash $project_dir/dev.sh start backend
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
)
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "    (dry-run) write $unit_path:"
    echo "$unit" | sed 's/^/      /'
  else
    echo "$unit" > "$unit_path"
    chmod 644 "$unit_path"
    systemctl daemon-reload
    systemctl enable homemanager.service
  fi
  ok "systemd unit installed at $unit_path (use 'systemctl start homemanager' to launch)"
}

# ─── Main ─────────────────────────────────────────────────────────────────

main() {
  require_root
  ensure_user_exists
  log "Home Manager installer"
  log "Target user:    $INSTALL_USER"
  log "Data directory: $INSTALL_DATA_DIR"
  [[ $ENABLE_SYSTEMD -eq 1 ]] && log "systemd unit:   enabled" || log "systemd unit:   skipped (pass --systemd to opt in)"
  [[ $DRY_RUN -eq 1 ]] && warn "DRY RUN — no changes will be made"
  echo

  step_tailscale_operator
  step_data_dir
  step_systemd_unit

  echo
  ok "Done. The web UI will no longer prompt for sudo."
  echo "    Next step: open the app and complete first-run setup."
}

main "$@"
