#!/usr/bin/env bash
# Basis Remote (cloud) Development Helper
# Usage: ./dev.sh [command]
#
# Local stack: Postgres in Docker on :5433 (the main app owns :5432), the
# control plane on :4000, the dashboard/marketing frontend on :5174, and an
# optional local frps whose vhost router serves *.lvh.me (lvh.me resolves to
# 127.0.0.1) — giving real subdomain routing end-to-end without a VPS.

set -euo pipefail

# Load nvm and use Node 20 if available (mirrors the top-level dev.sh)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if command -v nvm &> /dev/null; then
  nvm use 20 &> /dev/null || true
fi

# Directories
CLOUD_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$CLOUD_DIR/server"
FRONTEND_DIR="$CLOUD_DIR/frontend"
FRP_DIR="$CLOUD_DIR/.frp"
COMPOSE_FILE="$SERVER_DIR/docker-compose.dev.yml"

# frp release pin — keep in sync with cloud/deploy/provision.sh and the
# box-side installer pin (backend/src/modules/install/installer-commands.ts).
FRP_VERSION="0.61.1"

# The dev plugin secret is shared between the generated server .env and the
# generated frps.dev.toml — not a real secret, dev only.
DEV_PLUGIN_SECRET="dev-plugin-secret-0123456789abcdef"

# Docker compose command
COMPOSE="docker compose"
if ! docker compose version &> /dev/null 2>&1; then
  COMPOSE="docker-compose"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

cd "$CLOUD_DIR"

# ─── helpers ────────────────────────────────────────────────────────────────

# Load server .env into the current shell
load_server_env() {
  if [ -f "$SERVER_DIR/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$SERVER_DIR/.env"
    set +a
  fi
}

# Write cloud/server/.env with dev defaults if it doesn't exist yet. Stripe
# values come from cloud/server/.env.local when present (put your real
# sk_test_/whsec_/price_ test-mode values there — both files are gitignored),
# otherwise placeholders are used and billing flows will fail politely.
setup_server_env() {
  if [ -f "$SERVER_DIR/.env" ]; then
    return 0
  fi
  if [ -f "$SERVER_DIR/.env.local" ]; then
    echo -e "${BLUE}Generating server/.env (Stripe values from .env.local)...${NC}"
    set -a
    # shellcheck source=/dev/null
    source "$SERVER_DIR/.env.local"
    set +a
  else
    echo -e "${BLUE}Generating server/.env (Stripe placeholders — see 'stripe' command)...${NC}"
  fi
  # Credentials must match cloud/server/docker-compose.dev.yml (postgres on
  # host port 5433 so the main app's dev postgres keeps :5432).
  cat > "$SERVER_DIR/.env" << EOF
DATABASE_URL=postgres://basis_cloud:devpassword@localhost:5433/basis_cloud
SESSION_SECRET=dev-session-secret-at-least-32-characters-long
FRP_PLUGIN_SECRET=$DEV_PLUGIN_SECRET
FRPS_ADMIN_USER=admin
FRPS_ADMIN_PASSWORD=admin
FRPS_ADMIN_URL=http://127.0.0.1:7500
APP_ORIGIN=http://localhost:5174
RELAY_SERVER_ADDR=127.0.0.1
RELAY_SERVER_PORT=7000
HOST=127.0.0.1
PORT=4000
NODE_ENV=development
CAP_BASIC_GB=250
CAP_STREAMING_GB=2048
THROTTLE_BASIC_MBPS=4
# Stripe test mode — real test keys live in server/.env.local (gitignored);
# regenerate this file after editing .env.local: rm server/.env && ./dev.sh start
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-sk_test_CHANGEME}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-whsec_CHANGEME}
STRIPE_PRICE_BASIC_ANNUAL=${STRIPE_PRICE_BASIC_ANNUAL:-price_CHANGEME_basic}
STRIPE_PRICE_STREAMING_ANNUAL=${STRIPE_PRICE_STREAMING_ANNUAL:-price_CHANGEME_streaming}
EOF
}

install_deps() {
  if [ ! -d "$SERVER_DIR/node_modules" ]; then
    echo -e "${BLUE}Installing server dependencies...${NC}"
    (cd "$SERVER_DIR" && npm install)
  fi
  if [ -d "$FRONTEND_DIR" ] && [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo -e "${BLUE}Installing frontend dependencies...${NC}"
    (cd "$FRONTEND_DIR" && npm install)
  fi
}

start_postgres() {
  echo -e "${BLUE}Starting PostgreSQL (:5433)...${NC}"
  $COMPOSE -f "$COMPOSE_FILE" up -d
  sleep 3
}

# Download the pinned frp release into cloud/.frp/ (gitignored), verifying
# against the release's published checksums. Installs both frps and frpc.
ensure_frp() {
  if [ -x "$FRP_DIR/frps" ] && [ -x "$FRP_DIR/frpc" ] \
     && [ "$("$FRP_DIR/frps" --version 2>/dev/null)" = "$FRP_VERSION" ]; then
    return 0
  fi

  local platform arch name base
  case "$(uname -s)" in
    Linux)  platform=linux ;;
    Darwin) platform=darwin ;;
    *) echo -e "${RED}Unsupported OS for frp: $(uname -s)${NC}"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64)        arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo -e "${RED}Unsupported architecture for frp: $(uname -m)${NC}"; exit 1 ;;
  esac

  name="frp_${FRP_VERSION}_${platform}_${arch}"
  base="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}"
  mkdir -p "$FRP_DIR"

  echo -e "${BLUE}Downloading frp $FRP_VERSION ($platform/$arch)...${NC}"
  curl -fsSL -o "$FRP_DIR/$name.tar.gz" "$base/$name.tar.gz"
  curl -fsSL -o "$FRP_DIR/checksums.txt" "$base/frp_sha256_checksums.txt"
  echo -e "${BLUE}Verifying checksum...${NC}"
  if ! (cd "$FRP_DIR" && grep " $name.tar.gz\$" checksums.txt | sha256sum -c -); then
    rm -f "$FRP_DIR/$name.tar.gz"
    echo -e "${RED}frp tarball checksum verification FAILED — refusing to use it${NC}"
    exit 1
  fi
  tar -xzf "$FRP_DIR/$name.tar.gz" -C "$FRP_DIR" --strip-components=1 "$name/frps" "$name/frpc"
  rm -f "$FRP_DIR/$name.tar.gz" "$FRP_DIR/checksums.txt"
  echo -e "${GREEN}frp $FRP_VERSION ready in cloud/.frp/${NC}"
}

# Generate the local frps config. subDomainHost lvh.me → *.lvh.me resolves to
# 127.0.0.1, so `curl http://smith.lvh.me:8080/` exercises real vhost routing.
write_frps_dev_toml() {
  cat > "$FRP_DIR/frps.dev.toml" << EOF
# Generated by cloud/dev.sh — do not edit (regenerated on every 'frps' run).
bindPort = 7000
vhostHTTPPort = 8080
subDomainHost = "lvh.me"
log.to = "console"

webServer.addr = "127.0.0.1"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "admin"

[[httpPlugins]]
name = "basis-control"
addr = "http://127.0.0.1:4000"
path = "/frp-plugin/$DEV_PLUGIN_SECRET/handler"
ops = ["Login", "NewProxy", "Ping", "CloseProxy"]
EOF
}

case "${1:-help}" in
  start)
    start_postgres
    setup_server_env
    install_deps

    load_server_env
    if (cd "$SERVER_DIR" && npm run --if-present db:migrate); then :; else
      echo -e "${YELLOW}Migrations failed — is postgres up? (./dev.sh db)${NC}"
    fi

    echo ""
    echo -e "${GREEN}Starting Basis Remote (cloud)...${NC}"
    echo -e "  Control plane: ${BLUE}http://localhost:4000${NC}"
    echo -e "  Frontend:      ${BLUE}http://localhost:5174${NC}"
    echo ""
    echo -e "Run ${GREEN}./dev.sh frps${NC} in another terminal for the local relay,"
    echo -e "and ${GREEN}./dev.sh stripe${NC} for webhook forwarding."
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""

    (cd "$FRONTEND_DIR" && npm run dev) &
    FRONTEND_PID=$!
    trap "kill $FRONTEND_PID 2>/dev/null; exit" INT TERM
    (cd "$SERVER_DIR" && npm run dev)
    ;;

  frps)
    ensure_frp
    write_frps_dev_toml
    echo -e "${GREEN}Starting local frps...${NC}"
    echo -e "  Control port:  ${BLUE}127.0.0.1:7000${NC} (frpc connections)"
    echo -e "  HTTP vhost:    ${BLUE}http://<subdomain>.lvh.me:8080${NC}"
    echo -e "  Admin API:     ${BLUE}http://127.0.0.1:7500${NC} (admin/admin)"
    echo -e "  Plugin →       ${BLUE}http://127.0.0.1:4000${NC} (start the server first)"
    echo ""
    exec "$FRP_DIR/frps" -c "$FRP_DIR/frps.dev.toml"
    ;;

  frpc-demo)
    # Hand-rolled e2e client, standing in for a customer box:
    #   ./dev.sh frpc-demo --token <tunnelToken> --tenant <tenantId> \
    #                      --subdomain smith --local-port 3000
    # Then: curl http://smith.lvh.me:8080/
    TOKEN=""; TENANT=""; SUBDOMAIN=""; LOCAL_PORT=3000
    shift
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --token)      TOKEN="${2:-}"; shift 2 ;;
        --tenant)     TENANT="${2:-}"; shift 2 ;;
        --subdomain)  SUBDOMAIN="${2:-}"; shift 2 ;;
        --local-port) LOCAL_PORT="${2:-}"; shift 2 ;;
        *) echo -e "${RED}Unknown argument: $1${NC}"; exit 1 ;;
      esac
    done
    if [ -z "$TOKEN" ] || [ -z "$TENANT" ] || [ -z "$SUBDOMAIN" ]; then
      echo "Usage: ./dev.sh frpc-demo --token X --tenant Y --subdomain Z [--local-port N]"
      echo "(get tenant/token from a claim against the local control plane)"
      exit 1
    fi
    ensure_frp
    cat > "$FRP_DIR/frpc.demo.toml" << EOF
# Generated by cloud/dev.sh frpc-demo — mirrors what the box-side supervisor
# writes to run/frpc.toml.
serverAddr = "127.0.0.1"
serverPort = 7000
user = "$TENANT"
metadatas.token = "$TOKEN"

[[proxies]]
name = "web"
type = "http"
subdomain = "$SUBDOMAIN"
localIP = "127.0.0.1"
localPort = $LOCAL_PORT
EOF
    echo -e "${GREEN}Starting demo frpc${NC} → ${BLUE}http://$SUBDOMAIN.lvh.me:8080${NC} (proxies 127.0.0.1:$LOCAL_PORT)"
    exec "$FRP_DIR/frpc" -c "$FRP_DIR/frpc.demo.toml"
    ;;

  stripe)
    if ! command -v stripe &> /dev/null; then
      echo -e "${RED}Stripe CLI not installed.${NC} See https://docs.stripe.com/stripe-cli"
      exit 1
    fi
    echo -e "${YELLOW}Paste the whsec_... printed below into cloud/server/.env.local as${NC}"
    echo -e "${YELLOW}STRIPE_WEBHOOK_SECRET=whsec_..., then: rm server/.env && ./dev.sh start${NC}"
    echo ""
    exec stripe listen --forward-to localhost:4000/api/stripe/webhook
    ;;

  db)
    echo -e "${BLUE}Connecting to PostgreSQL (:5433)...${NC}"
    # User/db must match cloud/server/docker-compose.dev.yml.
    $COMPOSE -f "$COMPOSE_FILE" exec postgres psql -U basis_cloud basis_cloud
    ;;

  stop)
    echo -e "${BLUE}Stopping cloud services...${NC}"
    $COMPOSE -f "$COMPOSE_FILE" down 2>/dev/null || true
    pkill -f "$SERVER_DIR" 2>/dev/null || true
    pkill -f "$FRONTEND_DIR" 2>/dev/null || true
    pkill -f "$FRP_DIR/frps" 2>/dev/null || true
    pkill -f "$FRP_DIR/frpc" 2>/dev/null || true
    echo -e "${GREEN}Stopped.${NC}"
    ;;

  help|*)
    echo -e "${BLUE}Basis Remote (cloud) Development Helper${NC}"
    echo ""
    echo "Usage: ./dev.sh <command>"
    echo ""
    echo -e "  ${GREEN}start${NC}        Postgres (:5433) + control plane (:4000) + frontend (:5174)"
    echo -e "  ${GREEN}frps${NC}         Run a local relay (foreground) — tunnels at *.lvh.me:8080"
    echo -e "  ${GREEN}frpc-demo${NC}    Run a demo tunnel client (see frpc-demo --help output)"
    echo -e "  ${GREEN}stripe${NC}       Forward Stripe test webhooks to the local server"
    echo -e "  ${GREEN}db${NC}           Open a psql shell on the dev database"
    echo -e "  ${GREEN}stop${NC}         Stop containers and dev processes"
    echo -e "  ${GREEN}help${NC}         Show this help"
    echo ""
    echo -e "${YELLOW}Typical e2e session (three terminals):${NC}"
    echo "  ./dev.sh start"
    echo "  ./dev.sh frps"
    echo "  ./dev.sh frpc-demo --token <t> --tenant <id> --subdomain smith --local-port 3000"
    echo "  curl http://smith.lvh.me:8080/        # through the tunnel"
    echo ""
    ;;
esac
