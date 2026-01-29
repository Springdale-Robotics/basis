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
# Image parsing (VLM-LLM two-stage pipeline)
IMAGE_PARSE_PROVIDER=auto
VLM_LLM_SERVICE_URL=http://localhost:8000
OLLAMA_HOST=http://localhost:11434
OLLAMA_VLM_MODEL=llava:7b
OLLAMA_LLM_MODEL=qwen2.5:7b
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

# Helper: check for ffmpeg (required for video thumbnails)
check_ffmpeg() {
  if ! command -v ffmpeg &> /dev/null; then
    echo -e "${YELLOW}ffmpeg is not installed. Video thumbnails will not work.${NC}"

    # Check if brew is available (macOS)
    if command -v brew &> /dev/null; then
      echo -e "${BLUE}Would you like to install ffmpeg via Homebrew? [Y/n]${NC}"
      read -r response
      if [[ ! "$response" =~ ^([nN])$ ]]; then
        echo -e "${BLUE}Installing ffmpeg...${NC}"
        brew install ffmpeg
        echo -e "${GREEN}ffmpeg installed.${NC}"
      fi
    # Check if apt is available (Debian/Ubuntu)
    elif command -v apt-get &> /dev/null; then
      echo -e "${BLUE}Would you like to install ffmpeg via apt? [Y/n]${NC}"
      read -r response
      if [[ ! "$response" =~ ^([nN])$ ]]; then
        echo -e "${BLUE}Installing ffmpeg...${NC}"
        sudo apt-get update && sudo apt-get install -y ffmpeg
        echo -e "${GREEN}ffmpeg installed.${NC}"
      fi
    else
      echo -e "${YELLOW}Please install ffmpeg manually for video thumbnail support.${NC}"
    fi
  fi
}

# Helper: kill existing dev processes to avoid port conflicts
cleanup_processes() {
  # Kill any existing tsx/node processes for backend
  pkill -f "tsx.*src/index" 2>/dev/null || true
  pkill -f "node.*backend.*dev" 2>/dev/null || true
  # Kill any existing vite processes for frontend
  pkill -f "vite.*5173" 2>/dev/null || true
  # Kill anything on our dev ports
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  sleep 1
}

# Helper: clean up unused Docker resources
cleanup_docker() {
  echo -e "${BLUE}Cleaning up unused Docker resources...${NC}"
  # Remove stopped containers
  docker container prune -f 2>/dev/null || true
  # Remove dangling images
  docker image prune -f 2>/dev/null || true
  # Remove build cache
  docker builder prune -f 2>/dev/null || true
}

# Helper: start infrastructure (postgres + redis + ollama)
start_infra() {
  echo -e "${BLUE}Starting PostgreSQL, Redis, and Ollama...${NC}"
  (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml up -d postgres redis ollama)
  sleep 3
}

# Helper: start VLM-LLM service (uses Ollama for both VLM and LLM)
start_vlm_llm() {
  echo -e "${BLUE}Starting VLM-LLM service...${NC}"
  (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml up -d vlm-llm)
}

# Helper: check VLM-LLM service health
check_vlm_llm_health() {
  if docker ps --format '{{.Names}}' | grep -q 'homemanager-vlm-llm-dev'; then
    echo -e "${BLUE}Waiting for VLM-LLM service...${NC}"
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
      if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}VLM-LLM service ready!${NC}"
        return 0
      fi
      attempt=$((attempt + 1))
      sleep 2
    done
    echo -e "${YELLOW}VLM-LLM service not responding, will use Ollama fallback.${NC}"
  fi
}

# Helper: check and pull Ollama models for VLM-LLM pipeline
check_ollama_models() {
  if command -v docker &> /dev/null; then
    # Check if Ollama container is running
    if docker ps --format '{{.Names}}' | grep -q 'homemanager-ollama-dev'; then
      echo -e "${BLUE}Checking AI models for VLM-LLM pipeline...${NC}"

      # Pull VLM model (llava:7b) for GPU image understanding
      if ! docker exec homemanager-ollama-dev ollama list 2>/dev/null | grep -q 'llava:7b'; then
        echo -e "${YELLOW}Downloading VLM model (llava:7b) - this may take a few minutes...${NC}"
        docker exec homemanager-ollama-dev ollama pull llava:7b
        echo -e "${GREEN}VLM model ready!${NC}"
      fi

      # Pull CPU fallback VLM model (moondream) for systems without GPU
      if ! docker exec homemanager-ollama-dev ollama list 2>/dev/null | grep -q 'moondream'; then
        echo -e "${YELLOW}Downloading CPU fallback model (moondream)...${NC}"
        docker exec homemanager-ollama-dev ollama pull moondream
        echo -e "${GREEN}CPU fallback model ready!${NC}"
      fi

      # Pull LLM model (qwen2.5:7b) for text structuring
      if ! docker exec homemanager-ollama-dev ollama list 2>/dev/null | grep -q 'qwen2.5:7b'; then
        echo -e "${YELLOW}Downloading LLM model (qwen2.5:7b) - this may take a few minutes...${NC}"
        docker exec homemanager-ollama-dev ollama pull qwen2.5:7b
        echo -e "${GREEN}LLM model ready!${NC}"
      fi

      echo -e "${GREEN}AI models ready!${NC}"
    fi
  fi
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
        cleanup_processes
        start_infra
        setup_backend_env
        install_deps
        check_ffmpeg
        start_vlm_llm
        check_ollama_models
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
        cleanup_processes
        start_infra
        setup_backend_env
        if [ ! -d "$BACKEND_DIR/node_modules" ]; then
          (cd "$BACKEND_DIR" && npm install)
        fi
        check_ffmpeg
        start_vlm_llm
        check_ollama_models
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
        # Only kill frontend port, not backend
        lsof -ti:5173 | xargs kill -9 2>/dev/null || true
        sleep 1
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
    pkill -f "tsx watch" 2>/dev/null || true
    pkill -f "vite.*homemanager" 2>/dev/null || true
    # Kill processes on dev ports
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
    lsof -ti:5174 | xargs kill -9 2>/dev/null || true
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    cleanup_docker
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
    # Use dev compose file for dev services, production for backend
    if [ -n "$2" ]; then
      (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml logs -f "$2")
    else
      echo "Usage: ./dev.sh logs <service>"
      echo "Available services: postgres, redis, ollama, vlm-llm, pgadmin, redis-commander"
    fi
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

  vlm-llm)
    # VLM-LLM service management
    case "${2:-help}" in
      start)
        echo -e "${BLUE}Starting VLM-LLM service...${NC}"
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml up -d vlm-llm)
        check_vlm_llm_health
        ;;
      stop)
        echo -e "${BLUE}Stopping VLM-LLM service...${NC}"
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml stop vlm-llm)
        ;;
      build)
        echo -e "${BLUE}Building VLM-LLM service...${NC}"
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml build vlm-llm)
        ;;
      rebuild)
        echo -e "${BLUE}Rebuilding VLM-LLM service...${NC}"
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml up -d --build --no-deps vlm-llm)
        ;;
      logs)
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml logs -f vlm-llm)
        ;;
      status)
        if curl -s http://localhost:8000/health 2>/dev/null; then
          echo ""
        else
          echo -e "${RED}VLM-LLM service not responding${NC}"
        fi
        ;;
      pull-models)
        echo -e "${BLUE}Pulling VLM and LLM models...${NC}"
        check_ollama_models
        ;;
      preload)
        echo -e "${BLUE}Preloading AI models into memory...${NC}"
        echo -e "${YELLOW}This takes ~80 seconds on CPU...${NC}"
        docker exec homemanager-ollama-dev ollama run llava:7b "hello" > /dev/null 2>&1
        echo -e "${GREEN}llava:7b loaded!${NC}"
        ;;
      *)
        echo -e "${BLUE}VLM-LLM Service Commands${NC}"
        echo ""
        echo -e "  ${GREEN}vlm-llm start${NC}          Start the VLM-LLM service"
        echo -e "  ${GREEN}vlm-llm stop${NC}           Stop the VLM-LLM service"
        echo -e "  ${GREEN}vlm-llm build${NC}          Build the Docker image"
        echo -e "  ${GREEN}vlm-llm rebuild${NC}        Rebuild and restart"
        echo -e "  ${GREEN}vlm-llm logs${NC}           View service logs"
        echo -e "  ${GREEN}vlm-llm status${NC}         Check service health"
        echo -e "  ${GREEN}vlm-llm pull-models${NC}    Pull llava:7b and qwen2.5:7b models"
        ;;
    esac
    ;;

  prune)
    echo -e "${YELLOW}This will remove ALL unused Docker resources including volumes. Continue? [y/N]${NC}"
    read -r response
    if [[ "$response" =~ ^([yY])$ ]]; then
      echo -e "${BLUE}Performing full Docker cleanup...${NC}"
      docker system prune -af --volumes
      echo -e "${GREEN}Full cleanup complete.${NC}"
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
    echo -e "${YELLOW}VLM-LLM Service:${NC}"
    echo -e "  ${GREEN}vlm-llm start${NC}        Start the VLM-LLM service"
    echo -e "  ${GREEN}vlm-llm stop${NC}         Stop the VLM-LLM service"
    echo -e "  ${GREEN}vlm-llm logs${NC}         View VLM-LLM logs"
    echo -e "  ${GREEN}vlm-llm status${NC}       Check service health"
    echo -e "  ${GREEN}vlm-llm pull-models${NC}  Pull llava:7b and qwen2.5:7b models"
    echo ""
    echo -e "${YELLOW}Other:${NC}"
    echo -e "  ${GREEN}logs <service>${NC}       Tail logs (postgres, redis, ollama, vlm-llm)"
    echo -e "  ${GREEN}redis${NC}                Open Redis CLI"
    echo -e "  ${GREEN}test${NC}                 Run all tests"
    echo -e "  ${GREEN}test backend${NC}         Run backend tests"
    echo -e "  ${GREEN}test frontend${NC}        Run frontend tests"
    echo -e "  ${GREEN}install${NC}              Install all npm dependencies"
    echo -e "  ${GREEN}clean${NC}                Remove everything (confirms first)"
    echo -e "  ${GREEN}prune${NC}                Full Docker cleanup including volumes (confirms first)"
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
