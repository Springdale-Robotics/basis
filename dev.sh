#!/bin/bash
# HomeManager Development Helper
# Usage: ./dev.sh [command]

set -e

# Load nvm and use Node 20 if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if command -v nvm &> /dev/null; then
  nvm use 20 &> /dev/null || true
fi

# Directories
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

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

# Ensure we're in the right place
cd "$ROOT_DIR"

# Helper: load backend .env into current shell
load_backend_env() {
  if [ -f "$BACKEND_DIR/.env" ]; then
    set -a
    source "$BACKEND_DIR/.env"
    set +a
  fi
}

# Helper: setup backend env
setup_backend_env() {
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${BLUE}Creating backend .env...${NC}"
    cat > "$BACKEND_DIR/.env" << EOF
DATABASE_URL=postgres://homemanager:devpassword@localhost:5432/homemanager
REDIS_URL=redis://localhost:6379
SESSION_SECRET=dev-session-secret-at-least-32-characters-long
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
PORT=3000
NODE_ENV=development
CORS_ORIGINS=http://localhost:5173
LOG_LEVEL=debug
STORAGE_PATH=./storage
EOF
  fi
}

# Helper: install deps
install_deps() {
  if [ ! -d "$BACKEND_DIR/node_modules" ]; then
    echo -e "${BLUE}Installing backend dependencies...${NC}"
    (cd "$BACKEND_DIR" && npm install)
  fi
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo -e "${BLUE}Installing frontend dependencies...${NC}"
    (cd "$FRONTEND_DIR" && npm install)
  fi
}

# Helper: start infrastructure (postgres + redis)
start_infra() {
  echo -e "${BLUE}Starting PostgreSQL and Redis...${NC}"
  (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml up -d postgres redis)
  sleep 3
}

# Helper: run migrations
run_migrations() {
  echo -e "${BLUE}Running database migrations...${NC}"
  load_backend_env
  (cd "$BACKEND_DIR" && npx drizzle-kit push --force 2>/dev/null || npm run db:migrate)
}

case "${1:-help}" in
  start)
    # Start everything based on second argument
    case "${2:-all}" in
      all|"")
        # Full stack: infra + backend + frontend
        start_infra
        setup_backend_env
        install_deps
        run_migrations

        echo ""
        echo -e "${GREEN}Starting HomeManager...${NC}"
        echo -e "  Backend:  ${BLUE}http://localhost:3000${NC}"
        echo -e "  Frontend: ${BLUE}http://localhost:5173${NC}"
        echo ""
        echo "Press Ctrl+C to stop"
        echo ""

        # Start both processes
        (cd "$FRONTEND_DIR" && npm run dev) &
        FRONTEND_PID=$!
        trap "kill $FRONTEND_PID 2>/dev/null; exit" INT TERM
        load_backend_env
        (cd "$BACKEND_DIR" && npm run dev)
        ;;

      backend)
        # Backend only
        start_infra
        setup_backend_env
        if [ ! -d "$BACKEND_DIR/node_modules" ]; then
          (cd "$BACKEND_DIR" && npm install)
        fi
        run_migrations

        echo ""
        echo -e "${GREEN}Starting backend...${NC}"
        echo -e "  Backend: ${BLUE}http://localhost:3000${NC}"
        echo ""
        load_backend_env
        (cd "$BACKEND_DIR" && npm run dev)
        ;;

      frontend)
        # Frontend only (assumes backend is running)
        if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
          (cd "$FRONTEND_DIR" && npm install)
        fi

        echo ""
        echo -e "${GREEN}Starting frontend...${NC}"
        echo -e "  Frontend: ${BLUE}http://localhost:5173${NC}"
        echo ""
        (cd "$FRONTEND_DIR" && npm run dev)
        ;;

      docker)
        # Everything in Docker
        echo -e "${BLUE}Starting all services in Docker...${NC}"

        if [ ! -f "$BACKEND_DIR/.env" ]; then
          cat > "$BACKEND_DIR/.env" << EOF
DB_PASSWORD=devpassword
SESSION_SECRET=dev-session-secret-at-least-32-characters-long
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
PORT=3000
CORS_ORIGINS=http://localhost:5173
AUTO_MIGRATE=true
EOF
        fi

        (cd "$BACKEND_DIR" && $COMPOSE up -d)
        echo ""
        echo -e "${GREEN}Running at http://localhost:3000${NC}"
        ;;

      *)
        echo -e "${RED}Unknown target: $2${NC}"
        echo "Use: start, start backend, start frontend, or start docker"
        exit 1
        ;;
    esac
    ;;

  stop)
    echo -e "${BLUE}Stopping services...${NC}"
    (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml down 2>/dev/null || true)
    (cd "$BACKEND_DIR" && $COMPOSE down 2>/dev/null || true)
    # Kill any running node processes for this project
    pkill -f "homemanager.*npm" 2>/dev/null || true
    echo -e "${GREEN}Stopped.${NC}"
    ;;

  restart)
    $0 stop
    sleep 1
    $0 start ${2:-all}
    ;;

  rebuild)
    echo -e "${BLUE}Rebuilding backend container...${NC}"
    (cd "$BACKEND_DIR" && $COMPOSE up -d --build --no-deps backend)
    echo -e "${GREEN}Done.${NC}"
    ;;

  logs)
    (cd "$BACKEND_DIR" && $COMPOSE logs -f ${2:-backend})
    ;;

  db)
    case "${2:-shell}" in
      shell|"")
        echo -e "${BLUE}Connecting to PostgreSQL...${NC}"
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml exec postgres psql -U homemanager)
        ;;
      migrate)
        load_backend_env
        (cd "$BACKEND_DIR" && npm run db:migrate)
        ;;
      push)
        load_backend_env
        (cd "$BACKEND_DIR" && npx drizzle-kit push --force)
        ;;
      seed)
        load_backend_env
        (cd "$BACKEND_DIR" && npm run db:seed)
        ;;
      studio)
        load_backend_env
        (cd "$BACKEND_DIR" && npm run db:studio)
        ;;
      reset)
        echo -e "${YELLOW}This will delete ALL data. Are you sure? [y/N]${NC}"
        read -r response
        if [[ "$response" =~ ^([yY])$ ]]; then
          (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml down -v)
          echo -e "${GREEN}Database reset.${NC}"
        fi
        ;;
      *)
        echo "Usage: ./dev.sh db [shell|migrate|push|seed|studio|reset]"
        ;;
    esac
    ;;

  redis)
    (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml exec redis redis-cli)
    ;;

  test)
    case "${2:-all}" in
      all|"")
        load_backend_env
        (cd "$BACKEND_DIR" && npm test)
        (cd "$FRONTEND_DIR" && npm test)
        ;;
      backend)
        load_backend_env
        (cd "$BACKEND_DIR" && npm test)
        ;;
      frontend)
        (cd "$FRONTEND_DIR" && npm test)
        ;;
    esac
    ;;

  install)
    echo -e "${BLUE}Installing all dependencies...${NC}"
    (cd "$BACKEND_DIR" && npm install)
    (cd "$FRONTEND_DIR" && npm install)
    echo -e "${GREEN}Done.${NC}"
    ;;

  clean)
    echo -e "${YELLOW}This will remove all containers, volumes, and node_modules. Are you sure? [y/N]${NC}"
    read -r response
    if [[ "$response" =~ ^([yY])$ ]]; then
      (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml down -v 2>/dev/null || true)
      (cd "$BACKEND_DIR" && $COMPOSE down -v 2>/dev/null || true)
      rm -rf "$BACKEND_DIR/node_modules" "$BACKEND_DIR/dist" "$BACKEND_DIR/storage" "$BACKEND_DIR/.env"
      rm -rf "$FRONTEND_DIR/node_modules" "$FRONTEND_DIR/dist"
      echo -e "${GREEN}Cleaned.${NC}"
    fi
    ;;

  help|*)
    echo -e "${BLUE}HomeManager Development Helper${NC}"
    echo ""
    echo "Usage: ./dev.sh <command> [target]"
    echo ""
    echo -e "${YELLOW}Start/Stop:${NC}"
    echo -e "  ${GREEN}start${NC}                Start everything (backend + frontend)"
    echo -e "  ${GREEN}start backend${NC}        Start backend only"
    echo -e "  ${GREEN}start frontend${NC}       Start frontend only (backend must be running)"
    echo -e "  ${GREEN}start docker${NC}         Start all services in Docker"
    echo -e "  ${GREEN}stop${NC}                 Stop all services"
    echo -e "  ${GREEN}restart${NC}              Restart all services"
    echo -e "  ${GREEN}rebuild${NC}              Rebuild backend Docker image (keeps data)"
    echo ""
    echo -e "${YELLOW}Database:${NC}"
    echo -e "  ${GREEN}db${NC}                   Open PostgreSQL shell"
    echo -e "  ${GREEN}db migrate${NC}           Run migrations"
    echo -e "  ${GREEN}db push${NC}              Push schema changes (dev)"
    echo -e "  ${GREEN}db seed${NC}              Insert demo data"
    echo -e "  ${GREEN}db studio${NC}            Open Drizzle Studio (visual DB browser)"
    echo -e "  ${GREEN}db reset${NC}             Delete all data (confirms first)"
    echo ""
    echo -e "${YELLOW}Other:${NC}"
    echo -e "  ${GREEN}logs [service]${NC}       Tail logs (default: backend)"
    echo -e "  ${GREEN}redis${NC}                Open Redis CLI"
    echo -e "  ${GREEN}test${NC}                 Run all tests"
    echo -e "  ${GREEN}test backend${NC}         Run backend tests"
    echo -e "  ${GREEN}test frontend${NC}        Run frontend tests"
    echo -e "  ${GREEN}install${NC}              Install all npm dependencies"
    echo -e "  ${GREEN}clean${NC}                Remove everything (confirms first)"
    echo -e "  ${GREEN}help${NC}                 Show this help"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  ./dev.sh start             # Start full stack"
    echo "  ./dev.sh start backend     # Backend only (for frontend work in another terminal)"
    echo "  ./dev.sh db seed           # Add demo data"
    echo "  ./dev.sh logs postgres     # View database logs"
    echo ""
    ;;
esac
