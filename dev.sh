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

# Helper: setup backend env (always regenerate to use current ports)
setup_backend_env() {
  # Use acquired ports or defaults
  local port=${BACKEND_PORT:-3000}
  local frontend_port=${FRONTEND_PORT:-5173}
  local vlm_llm_port=${VLM_LLM_PORT:-8000}

  echo -e "${BLUE}Configuring backend .env (port $port, CORS for frontend port $frontend_port)...${NC}"
  cat > "$BACKEND_DIR/.env" << EOF
DATABASE_URL=postgres://homemanager:devpassword@localhost:5432/homemanager
REDIS_URL=redis://localhost:6379
SESSION_SECRET=dev-session-secret-at-least-32-characters-long
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
PORT=$port
NODE_ENV=development
CORS_ORIGINS=http://localhost:$frontend_port
LOG_LEVEL=debug
STORAGE_PATH=./storage
# Image parsing (VLM-LLM two-stage pipeline)
IMAGE_PARSE_PROVIDER=auto
VLM_LLM_SERVICE_URL=http://localhost:$vlm_llm_port
OLLAMA_HOST=http://localhost:11434
OLLAMA_VLM_MODEL=minicpm-v
OLLAMA_LLM_MODEL=qwen2.5:7b
# HandwritingOCR API (handwritingocr.com) — set key to enable for handwritten recipes
# HANDWRITING_OCR_API_KEY=
EOF
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

# Helper: check and fix apt if broken (common issue with apt_pkg module)
check_apt_health() {
  if ! command -v apt-get &> /dev/null; then
    return 0  # Not a Debian-based system
  fi

  # Test if apt works by running a simple command
  if ! python3 -c "import apt_pkg" 2>/dev/null; then
    echo -e "${YELLOW}Detected broken apt_pkg Python module. Fixing...${NC}"
    # Reinstall python3-apt to fix the module
    sudo apt-get install --reinstall -y python3-apt 2>/dev/null || true
    # If that didn't work, try to fix the symlink manually
    if ! python3 -c "import apt_pkg" 2>/dev/null; then
      local apt_pkg_file=$(find /usr/lib/python3/dist-packages -name "apt_pkg*.so" 2>/dev/null | head -1)
      if [ -n "$apt_pkg_file" ]; then
        sudo ln -sf "$apt_pkg_file" /usr/lib/python3/dist-packages/apt_pkg.so 2>/dev/null || true
      fi
    fi
    if python3 -c "import apt_pkg" 2>/dev/null; then
      echo -e "${GREEN}apt_pkg module fixed.${NC}"
    else
      echo -e "${YELLOW}Could not fix apt_pkg module. Some apt operations may show warnings.${NC}"
    fi
  fi
}

# Track if apt has been updated this session
APT_UPDATED=false

# Helper: run apt-get update once per session
apt_update_once() {
  if [ "$APT_UPDATED" = false ]; then
    echo -e "${BLUE}Updating package lists...${NC}"
    sudo apt-get update
    APT_UPDATED=true
  fi
}

# Helper: install a package via apt (handles update, prompts user)
apt_install() {
  local package=$1
  local description=$2

  if ! command -v apt-get &> /dev/null; then
    return 1  # Not a Debian-based system
  fi

  echo -e "${BLUE}Would you like to install $package via apt? [Y/n]${NC}"
  read -r response
  if [[ "$response" =~ ^([nN])$ ]]; then
    return 1
  fi

  apt_update_once
  echo -e "${BLUE}Installing $package...${NC}"
  if sudo apt-get install -y "$package"; then
    echo -e "${GREEN}$package installed.${NC}"
    return 0
  else
    echo -e "${RED}Failed to install $package.${NC}"
    return 1
  fi
}

# Helper: check for ffmpeg (required for video thumbnails)
check_ffmpeg() {
  if command -v ffmpeg &> /dev/null; then
    return 0  # Already installed
  fi

  echo -e "${YELLOW}ffmpeg is not installed. Video thumbnails will not work.${NC}"

  # macOS
  if command -v brew &> /dev/null; then
    echo -e "${BLUE}Would you like to install ffmpeg via Homebrew? [Y/n]${NC}"
    read -r response
    if [[ ! "$response" =~ ^([nN])$ ]]; then
      echo -e "${BLUE}Installing ffmpeg...${NC}"
      brew install ffmpeg
      echo -e "${GREEN}ffmpeg installed.${NC}"
    fi
  # Debian/Ubuntu
  elif command -v apt-get &> /dev/null; then
    apt_install ffmpeg "video thumbnail support" || true
  else
    echo -e "${YELLOW}Please install ffmpeg manually for video thumbnail support.${NC}"
  fi
}

# Helper: check for NVIDIA GPU and container toolkit (required for GPU-accelerated AI)
check_nvidia_gpu() {
  # Check if NVIDIA GPU is available
  if ! command -v nvidia-smi &> /dev/null; then
    return 0  # No GPU, nothing to do
  fi

  # GPU detected, check if nvidia-container-toolkit is installed
  if dpkg -l 2>/dev/null | grep -q "ii.*nvidia-container-toolkit"; then
    echo -e "${GREEN}GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)${NC}"
    return 0
  fi

  echo -e "${YELLOW}NVIDIA GPU detected but nvidia-container-toolkit is not installed.${NC}"
  echo -e "${YELLOW}AI image parsing will run on CPU (slow) without it.${NC}"
  echo ""
  echo -e "${BLUE}Would you like to install nvidia-container-toolkit for GPU acceleration? [Y/n]${NC}"
  read -r response
  if [[ "$response" =~ ^([nN])$ ]]; then
    echo -e "${YELLOW}Continuing without GPU acceleration...${NC}"
    return 0
  fi

  echo -e "${BLUE}Installing nvidia-container-toolkit...${NC}"

  # Add NVIDIA repository if not present
  if [ ! -f /etc/apt/sources.list.d/nvidia-container-toolkit.list ]; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
      sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
      sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
    APT_UPDATED=false  # Force update since we added a new repo
  fi

  apt_update_once
  if sudo apt-get install -y nvidia-container-toolkit; then
    echo -e "${BLUE}Restarting Docker to enable GPU support...${NC}"
    sudo systemctl restart docker 2>/dev/null || sudo service docker restart 2>/dev/null || true
    sleep 2
    echo -e "${GREEN}nvidia-container-toolkit installed! GPU acceleration enabled.${NC}"
  else
    echo -e "${RED}Failed to install nvidia-container-toolkit. Continuing without GPU acceleration.${NC}"
  fi
}

# Helper: check if a process belongs to homemanager (via cwd or cmdline)
is_homemanager_process() {
  local pid=$1

  # Check /proc/$pid/cwd on Linux
  if [ -d "/proc/$pid" ]; then
    local cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    if [[ "$cwd" == *"homemanager"* ]]; then
      return 0
    fi
    # Check cmdline for homemanager patterns
    local cmdline=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ' || true)
    if [[ "$cmdline" == *"homemanager"* ]]; then
      return 0
    fi
  fi

  # macOS fallback using lsof
  if command -v lsof &> /dev/null; then
    local cwd=$(lsof -p "$pid" 2>/dev/null | grep cwd | awk '{print $NF}' || true)
    if [[ "$cwd" == *"homemanager"* ]]; then
      return 0
    fi
  fi

  return 1
}

# Helper: grep pattern that matches a host port in Docker port mappings
# Docker format: "host_ip:host_port->container_port/proto" — we match host_port only
docker_host_port_grep() {
  local port=$1
  echo -E "(^|,\s*)(\[::\]:|[0-9.]*:)$port->"
}

# Helper: check if a Docker container using a host port is a homemanager container
is_homemanager_container_on_port() {
  local port=$1
  local pattern=$(docker_host_port_grep "$port")
  local container=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E "$pattern" | awk '{print $1}')
  if [ -n "$container" ] && [[ "$container" == *"homemanager"* ]]; then
    return 0
  fi
  return 1
}

# Helper: get Docker container name using a host port
get_container_on_port() {
  local port=$1
  local pattern=$(docker_host_port_grep "$port")
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E "$pattern" | awk '{print $1}'
}

# Helper: check if a port is available (checks both lsof and docker)
is_port_available() {
  local port=$1
  # Check if anything is actually listening on this port (ignore stale client connections)
  if lsof -iTCP:"$port" -sTCP:LISTEN -t &>/dev/null; then
    return 1
  fi
  # Also check if Docker has anything bound to this host port
  local pattern=$(docker_host_port_grep "$port")
  if docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "$pattern"; then
    return 1
  fi
  return 0
}

# Helper: get PID of process listening on a port
get_pid_on_port() {
  local port=$1
  lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
}

# Helper: find an available port starting from base (tries +0, +1, +10, +100)
find_available_port() {
  local base=$1
  local offsets=(0 1 10 100)

  for offset in "${offsets[@]}"; do
    local port=$((base + offset))
    if is_port_available "$port"; then
      echo "$port"
      return 0
    fi
  done

  # If all failed, return empty
  echo ""
  return 1
}

# Helper: smart port acquisition - kill homemanager processes, find alternatives for others
# Usage: acquire_port "service_name" default_port RESULT_VAR
acquire_port() {
  local service_name=$1
  local default_port=$2
  local result_var=$3

  if is_port_available "$default_port"; then
    eval "$result_var=$default_port"
    return 0
  fi

  # Port is in use - check if it's a homemanager Docker container
  local container=$(get_container_on_port "$default_port")
  if [ -n "$container" ]; then
    if [[ "$container" == *"homemanager"* ]]; then
      echo -e "${YELLOW}Stopping old homemanager container on port $default_port ($container)...${NC}"
      docker stop "$container" 2>/dev/null || true
      docker rm -f "$container" 2>/dev/null || true
      sleep 2
      if is_port_available "$default_port"; then
        eval "$result_var=$default_port"
        return 0
      fi
    else
      echo -e "${YELLOW}Port $default_port in use by container '$container' (not homemanager)${NC}"
    fi
  fi

  # Check if it's a homemanager process (non-Docker)
  local pid=$(get_pid_on_port "$default_port")
  if [ -n "$pid" ] && is_homemanager_process "$pid"; then
    echo -e "${YELLOW}Killing old homemanager process on port $default_port (PID $pid)...${NC}"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
    if is_port_available "$default_port"; then
      eval "$result_var=$default_port"
      return 0
    fi
  fi

  # Port is used by another process - find an alternative
  local new_port=$(find_available_port "$default_port")
  if [ -z "$new_port" ]; then
    echo -e "${RED}Could not find available port for $service_name (tried $default_port, +1, +10, +100)${NC}"
    exit 1
  fi

  if [ "$new_port" != "$default_port" ]; then
    echo -e "${YELLOW}Port $default_port in use by another process, using port $new_port for $service_name${NC}"
  fi

  eval "$result_var=$new_port"
}

# Helper: acquire VLM-LLM port
acquire_vlm_llm_port() {
  # Skip if already acquired
  if [ -n "$VLM_LLM_PORT" ]; then
    return 0
  fi
  # Remove old container first (it may be on any port from a previous run)
  docker stop homemanager-vlm-llm-dev 2>/dev/null || true
  docker rm -f homemanager-vlm-llm-dev 2>/dev/null || true
  acquire_port "vlm-llm" 8000 VLM_LLM_PORT
  export VLM_LLM_PORT
}

# Helper: smart cleanup and port acquisition
smart_cleanup() {
  acquire_port "backend" 3000 BACKEND_PORT
  acquire_port "frontend" 5173 FRONTEND_PORT
  # Always remove old homemanager VLM-LLM container first (it may be on any port)
  docker stop homemanager-vlm-llm-dev 2>/dev/null || true
  docker rm -f homemanager-vlm-llm-dev 2>/dev/null || true
  acquire_port "vlm-llm" 8000 VLM_LLM_PORT
  export BACKEND_PORT FRONTEND_PORT VLM_LLM_PORT
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
  acquire_vlm_llm_port
  echo -e "${BLUE}Starting VLM-LLM service on port $VLM_LLM_PORT...${NC}"
  (cd "$BACKEND_DIR" && VLM_LLM_PORT=$VLM_LLM_PORT $COMPOSE -f docker-compose.dev.yml up -d vlm-llm)
}

# Helper: check VLM-LLM service health
check_vlm_llm_health() {
  local vlm_port=${VLM_LLM_PORT:-8000}
  if docker ps --format '{{.Names}}' | grep -q 'homemanager-vlm-llm-dev'; then
    echo -e "${BLUE}Waiting for VLM-LLM service on port $vlm_port...${NC}"
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
      if curl -s "http://localhost:$vlm_port/health" > /dev/null 2>&1; then
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

      # Pull VLM model (minicpm-v) for document/OCR understanding
      if ! docker exec homemanager-ollama-dev ollama list 2>/dev/null | grep -q 'minicpm-v'; then
        echo -e "${YELLOW}Downloading VLM model (minicpm-v) - this may take a few minutes...${NC}"
        docker exec homemanager-ollama-dev ollama pull minicpm-v
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
        smart_cleanup
        check_apt_health
        check_nvidia_gpu
        check_ffmpeg
        start_infra
        setup_backend_env
        install_deps
        start_vlm_llm
        check_ollama_models
        run_migrations

        echo ""
        echo -e "${GREEN}Starting HomeManager...${NC}"
        echo -e "  Backend:  ${BLUE}http://localhost:$BACKEND_PORT${NC}"
        echo -e "  Frontend: ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
        echo ""
        echo "Press Ctrl+C to stop"
        echo ""

        # Start both processes with dynamic ports
        (cd "$FRONTEND_DIR" && VITE_PORT=$FRONTEND_PORT VITE_BACKEND_URL="http://localhost:$BACKEND_PORT" npm run dev) &
        FRONTEND_PID=$!
        trap "kill $FRONTEND_PID 2>/dev/null; exit" INT TERM
        load_backend_env
        (cd "$BACKEND_DIR" && npm run dev)
        ;;

      backend)
        # Backend only
        acquire_port "backend" 3000 BACKEND_PORT
        export BACKEND_PORT
        # Set default frontend port for CORS (user may specify different port when starting frontend)
        FRONTEND_PORT=${FRONTEND_PORT:-5173}
        export FRONTEND_PORT
        # Remove old VLM-LLM container and acquire port before setup_backend_env
        docker stop homemanager-vlm-llm-dev 2>/dev/null || true
        docker rm -f homemanager-vlm-llm-dev 2>/dev/null || true
        acquire_port "vlm-llm" 8000 VLM_LLM_PORT
        export VLM_LLM_PORT
        check_apt_health
        check_nvidia_gpu
        check_ffmpeg
        start_infra
        setup_backend_env
        if [ ! -d "$BACKEND_DIR/node_modules" ]; then
          (cd "$BACKEND_DIR" && npm install)
        fi
        start_vlm_llm
        check_ollama_models
        run_migrations

        echo ""
        echo -e "${GREEN}Starting backend...${NC}"
        echo -e "  Backend: ${BLUE}http://localhost:$BACKEND_PORT${NC}"
        echo ""
        load_backend_env
        (cd "$BACKEND_DIR" && npm run dev)
        ;;

      frontend)
        # Frontend only (assumes backend is running)
        acquire_port "frontend" 5173 FRONTEND_PORT
        export FRONTEND_PORT
        # Detect backend port (check common ports)
        BACKEND_PORT=""
        for port in 3000 3001 3010 3100; do
          if lsof -ti:"$port" &>/dev/null; then
            BACKEND_PORT=$port
            break
          fi
        done
        if [ -z "$BACKEND_PORT" ]; then
          echo -e "${YELLOW}Warning: Could not detect running backend, assuming port 3000${NC}"
          BACKEND_PORT=3000
        fi
        export BACKEND_PORT

        if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
          (cd "$FRONTEND_DIR" && npm install)
        fi

        echo ""
        echo -e "${GREEN}Starting frontend...${NC}"
        echo -e "  Frontend: ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
        echo -e "  Proxying to backend: ${BLUE}http://localhost:$BACKEND_PORT${NC}"
        echo ""
        (cd "$FRONTEND_DIR" && VITE_PORT=$FRONTEND_PORT VITE_BACKEND_URL="http://localhost:$BACKEND_PORT" npm run dev)
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
    # Kill homemanager processes — use SIGKILL and retry to handle tsx watch respawns
    for attempt in 1 2 3; do
      pkill -9 -f "tsx.*src/index" 2>/dev/null || true
      pkill -9 -f "vite.*homemanager\|VITE_PORT" 2>/dev/null || true
      pkill -9 -f "homemanager.*npm" 2>/dev/null || true
      pkill -9 -f "node.*homemanager.*/backend/" 2>/dev/null || true
      pkill -9 -f "node.*homemanager.*/frontend/" 2>/dev/null || true
      # Check if ports are free
      if ! lsof -ti:3000 &>/dev/null && ! lsof -ti:3001 &>/dev/null && ! lsof -ti:5173 &>/dev/null; then
        break
      fi
      sleep 1
    done
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
        acquire_vlm_llm_port
        echo -e "${BLUE}Starting VLM-LLM service on port $VLM_LLM_PORT...${NC}"
        (cd "$BACKEND_DIR" && VLM_LLM_PORT=$VLM_LLM_PORT $COMPOSE -f docker-compose.dev.yml up -d vlm-llm)
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
        acquire_vlm_llm_port
        echo -e "${BLUE}Rebuilding VLM-LLM service on port $VLM_LLM_PORT...${NC}"
        (cd "$BACKEND_DIR" && VLM_LLM_PORT=$VLM_LLM_PORT $COMPOSE -f docker-compose.dev.yml up -d --build --no-deps vlm-llm)
        ;;
      logs)
        (cd "$BACKEND_DIR" && $COMPOSE -f docker-compose.dev.yml logs -f vlm-llm)
        ;;
      status)
        # Check common VLM-LLM ports
        local vlm_port=""
        for port in 8000 8001 8010 8100; do
          if curl -s "http://localhost:$port/health" 2>/dev/null; then
            vlm_port=$port
            break
          fi
        done
        if [ -n "$vlm_port" ]; then
          echo -e "${GREEN}VLM-LLM service running on port $vlm_port${NC}"
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
        docker exec homemanager-ollama-dev ollama run minicpm-v "hello" > /dev/null 2>&1
        echo -e "${GREEN}minicpm-v loaded!${NC}"
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
        echo -e "  ${GREEN}vlm-llm pull-models${NC}    Pull minicpm-v and qwen2.5:7b models"
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
