#!/usr/bin/env bash
# Basis — one-shot privileged installer.
#
# Usage:
#   # from a checkout (recommended while the repo is private):
#   sudo bash scripts/install.sh
#
# This is the ONE elevated step for a Basis deployment. It bundles
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
#   5. NVIDIA driver — auto-installed when a supported GPU is present. Never
#      reboots; reports when one is required. Opt out with --no-gpu.
#   6. Ollama — always installed. It is what actually runs the models, so a
#      CPU-only box needs it just as much as a GPU one; --no-gpu skips the
#      driver work above, not this.
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
ENABLE_GPU=1
NEEDS_REBOOT=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) INSTALL_USER="$2"; shift 2 ;;
    --data-dir) INSTALL_DATA_DIR="$2"; shift 2 ;;
    --systemd) ENABLE_SYSTEMD=1; shift ;;
    --no-gpu) ENABLE_GPU=0; shift ;;
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
info() { echo "${C_BLUE}i${C_RESET}  $*"; }
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

# ─── GPU driver ───────────────────────────────────────────────────────────
#
# Auto-installs when a supported GPU is present. Rationale for doing this at
# install time rather than from the web UI: the driver swap needs a reboot of
# the very box that serves the UI, and during a first install a reboot is
# expected and cheap. Opt out with --no-gpu.
#
# Every early return below is about driver work only. Ollama is installed by
# step_ollama regardless — it used to live at the bottom of this function,
# where all three of these returns skipped straight past it and left a
# CPU-only box (the common self-hosted case) with no inference runtime at all
# under a message claiming AI features would work.
step_gpu() {
  if [[ $ENABLE_GPU -eq 0 ]]; then
    info "Skipping NVIDIA driver setup (--no-gpu)."
    return
  fi

  # lspci sees the card even with no driver installed — that is how we tell
  # "no GPU" apart from "GPU, no driver".
  local card
  card="$(lspci 2>/dev/null | grep -iE 'vga|3d controller' | grep -i nvidia || true)"
  if [[ -z "$card" ]]; then
    info "No NVIDIA GPU detected — nothing to install here. Models will run on"
    info "the CPU: workable for the smaller ones, minutes per scan rather than"
    info "seconds."
    return
  fi

  ok "NVIDIA GPU detected: ${card#*: }"

  # Test nvidia-smi's exit status, not merely its presence. dpkg unpacks the
  # binary the moment the driver package installs, but the kernel module only
  # loads after a reboot — so `command -v` succeeds during the pre-reboot
  # window and would report a non-functional driver as active, swallowing the
  # reboot reminder on any re-run before that reboot happens.
  if nvidia-smi >/dev/null 2>&1; then
    ok "Proprietary driver already active."
  elif command -v nvidia-smi >/dev/null 2>&1; then
    warn "Driver is installed but not loaded yet — the reboot is still pending."
    NEEDS_REBOOT=1
  elif ! command -v ubuntu-drivers >/dev/null 2>&1; then
    warn "A GPU is present but this is not an Ubuntu system."
    warn "Install the NVIDIA driver with your distribution's tooling, then re-run."
    return
  else
    warn "GPU is present but has no working driver (likely nouveau)."
    warn "Installing the recommended NVIDIA driver — this downloads ~600MB."
    if [[ $DRY_RUN -eq 0 ]]; then
      ubuntu-drivers install || {
        warn "Driver install failed. AI features will run on CPU until it is resolved."
        return
      }
    fi
    NEEDS_REBOOT=1
  fi
}

# ─── Ollama ───────────────────────────────────────────────────────────────
#
# Unconditional, and deliberately not part of step_gpu: Ollama is the thing
# that actually runs the models, and a box with no GPU is exactly the case
# where having it preinstalled matters most. --no-gpu opts out of the driver
# work, not out of inference.
step_ollama() {
  log "Ollama"
  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama already installed."
  else
    info "Installing Ollama..."
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "    (dry-run) curl -fsSL https://ollama.com/install.sh | sh"
    else
      curl -fsSL https://ollama.com/install.sh | sh || {
        warn "Ollama install failed. Install it later from Settings → AI models."
        return
      }
    fi
  fi

  ok "Pick your models in the app under Settings → AI models."
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
Description=Basis backend
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
  log "Basis installer"
  log "Target user:    $INSTALL_USER"
  log "Data directory: $INSTALL_DATA_DIR"
  [[ $ENABLE_SYSTEMD -eq 1 ]] && log "systemd unit:   enabled" || log "systemd unit:   skipped (pass --systemd to opt in)"
  [[ $ENABLE_GPU -eq 1 ]] && log "NVIDIA driver:  enabled" || log "NVIDIA driver:  skipped (--no-gpu)"
  log "Ollama:         always installed"
  [[ $DRY_RUN -eq 1 ]] && warn "DRY RUN — no changes will be made"
  echo

  step_tailscale_operator
  step_data_dir
  step_gpu
  step_ollama
  step_systemd_unit

  echo
  ok "Done. The web UI will no longer prompt for sudo."
  echo "    Next step: open the app and complete first-run setup."

  if [[ $NEEDS_REBOOT -eq 1 ]]; then
    echo
    warn "A reboot is required for the GPU driver to take effect."
    warn "Run: sudo reboot"
    if command -v ollama >/dev/null 2>&1; then
      warn "Ollama re-probes for the GPU each time it starts, and the reboot"
      warn "restarts its systemd service — no extra steps needed afterward."
    fi
  fi
}

main "$@"
