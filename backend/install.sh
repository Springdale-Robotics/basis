#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════╗"
echo "║         Basis Installer             ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Detect OS
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_LIKE=$ID_LIKE
  elif [ -f /etc/debian_version ]; then
    OS="debian"
  elif [ -f /etc/redhat-release ]; then
    OS="rhel"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
  else
    OS="unknown"
  fi
}

# Check if running as root or can sudo
can_sudo() {
  if [ "$EUID" -eq 0 ]; then
    return 0
  elif sudo -n true 2>/dev/null; then
    return 0
  else
    return 1
  fi
}

# Run command with sudo if needed
run_sudo() {
  if [ "$EUID" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Install Docker on Debian/Ubuntu
install_docker_debian() {
  echo "Installing Docker..."
  run_sudo apt-get update -qq
  run_sudo apt-get install -y -qq ca-certificates curl gnupg
  run_sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/$OS/gpg | run_sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  run_sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | run_sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  run_sudo apt-get update -qq
  run_sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

  # Add current user to docker group
  if [ "$EUID" -ne 0 ]; then
    run_sudo usermod -aG docker $USER
    echo -e "${YELLOW}Note: You may need to log out and back in for Docker permissions to take effect.${NC}"
  fi
}

# Install Docker on RHEL/CentOS/Fedora
install_docker_rhel() {
  echo "Installing Docker..."
  run_sudo dnf -y install dnf-plugins-core
  run_sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
  run_sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run_sudo systemctl start docker
  run_sudo systemctl enable docker

  if [ "$EUID" -ne 0 ]; then
    run_sudo usermod -aG docker $USER
    echo -e "${YELLOW}Note: You may need to log out and back in for Docker permissions to take effect.${NC}"
  fi
}

# Install Docker on macOS
install_docker_macos() {
  if command -v brew &> /dev/null; then
    echo "Installing Docker via Homebrew..."
    brew install --cask docker
    echo ""
    echo -e "${YELLOW}Docker Desktop installed. Please:${NC}"
    echo "  1. Open Docker from Applications"
    echo "  2. Complete the Docker Desktop setup"
    echo "  3. Run this installer again"
    exit 0
  else
    echo -e "${RED}Please install Docker Desktop manually:${NC}"
    echo "  https://docs.docker.com/desktop/install/mac-install/"
    exit 1
  fi
}

# Prompt to install Docker
prompt_install_docker() {
  echo -e "${YELLOW}Docker is not installed.${NC}"
  echo ""

  detect_os

  case $OS in
    ubuntu|debian|raspbian)
      if can_sudo; then
        echo -e "Install Docker now? [Y/n] "
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
          install_docker_debian
          return 0
        fi
      else
        echo "To install Docker, run:"
        echo "  curl -fsSL https://get.docker.com | sh"
        echo "  sudo usermod -aG docker \$USER"
        echo "  # Log out and back in, then run this installer again"
      fi
      ;;
    fedora|centos|rhel|rocky|alma)
      if can_sudo; then
        echo -e "Install Docker now? [Y/n] "
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
          install_docker_rhel
          return 0
        fi
      else
        echo "To install Docker, run:"
        echo "  sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin"
      fi
      ;;
    macos)
      install_docker_macos
      ;;
    *)
      echo "To install Docker, visit:"
      echo "  https://docs.docker.com/get-docker/"
      ;;
  esac

  exit 1
}

# Check Docker is running
check_docker_running() {
  if ! docker info &> /dev/null; then
    echo -e "${YELLOW}Docker is installed but not running.${NC}"

    detect_os

    if [[ "$OS" == "macos" ]]; then
      echo "Please start Docker Desktop and run this installer again."
    else
      echo "Starting Docker..."
      if can_sudo; then
        run_sudo systemctl start docker
        sleep 2
        if docker info &> /dev/null; then
          echo -e "${GREEN}✓${NC} Docker started"
          return 0
        fi
      fi
      echo "Try: sudo systemctl start docker"
    fi
    exit 1
  fi
}

# Main dependency check
echo "Checking dependencies..."

# Check Docker
if ! command -v docker &> /dev/null; then
  prompt_install_docker
fi

check_docker_running

# Check Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null 2>&1; then
  echo -e "${YELLOW}Docker Compose not found.${NC}"

  detect_os

  if [[ "$OS" == "macos" ]]; then
    echo "Docker Compose is included with Docker Desktop."
    echo "Please ensure Docker Desktop is fully installed."
  else
    echo "Installing Docker Compose plugin..."
    if can_sudo; then
      run_sudo apt-get update -qq 2>/dev/null || true
      run_sudo apt-get install -y -qq docker-compose-plugin 2>/dev/null || \
      run_sudo dnf install -y docker-compose-plugin 2>/dev/null || \
      { echo "Please install docker-compose-plugin manually"; exit 1; }
    else
      echo "Please install: docker-compose-plugin"
      exit 1
    fi
  fi
fi

# Use 'docker compose' if available
if docker compose version &> /dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

echo -e "${GREEN}✓${NC} Docker ready"

# Check if port is available
PORT="${PORT:-3000}"
if command -v lsof &> /dev/null; then
  if lsof -i ":$PORT" &> /dev/null; then
    echo -e "${YELLOW}Port $PORT is in use.${NC}"
    echo -n "Enter alternative port: "
    read -r PORT
    PORT="${PORT:-3001}"
  fi
fi

# Get installation directory
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if already installed
if [ -f "${INSTALL_DIR}/.env" ]; then
  echo ""
  echo -e "${YELLOW}Existing installation detected.${NC}"
  echo -n "Reinstall? This will regenerate credentials. [y/N] "
  read -r response
  if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Starting existing installation..."
    cd "$INSTALL_DIR"
    $COMPOSE up -d

    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")
    echo ""
    echo -e "Running at: ${BLUE}http://${LOCAL_IP}:${PORT}${NC}"
    exit 0
  fi
fi

# Generate secure credentials
echo "Generating secure credentials..."
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
SESSION_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create .env file
cat > "${INSTALL_DIR}/.env" << EOF
# Basis Configuration
# Generated on $(date)

# Database
DB_PASSWORD=${DB_PASSWORD}

# Security (auto-generated)
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Server
PORT=${PORT}
CORS_ORIGINS=*

# Auto-run migrations on startup
AUTO_MIGRATE=true
EOF

echo -e "${GREEN}✓${NC} Configuration generated"

# Update docker-compose port if non-default
if [ "$PORT" != "3000" ]; then
  # Create override file for custom port
  cat > "${INSTALL_DIR}/docker-compose.override.yml" << EOF
version: '3.8'
services:
  backend:
    ports:
      - "${PORT}:3000"
EOF
fi

# Start services
echo "Starting services (this may take a few minutes on first run)..."
cd "$INSTALL_DIR"
$COMPOSE up -d --build 2>&1 | while read line; do
  # Show progress without overwhelming output
  if [[ "$line" == *"Pull"* ]] || [[ "$line" == *"Build"* ]] || [[ "$line" == *"Start"* ]]; then
    echo "  $line"
  fi
done

echo "Waiting for backend..."

# Wait for backend to be healthy with progress
MAX_ATTEMPTS=90
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if curl -s "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  if [ $((ATTEMPT % 5)) -eq 0 ]; then
    echo -n "."
  fi
  sleep 2
done
echo ""

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo -e "${RED}Backend failed to start.${NC}"
  echo ""
  echo "Check logs:"
  echo "  $COMPOSE logs backend"
  echo ""
  echo "Common issues:"
  echo "  - Port $PORT already in use"
  echo "  - Insufficient memory (need ~1GB free)"
  echo "  - Docker not running properly"
  exit 1
fi

echo -e "${GREEN}✓${NC} Backend running"

# Get local IP for network access
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")

# Success message
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Open your browser to complete setup:${NC}"
echo ""
echo -e "   Local:   ${BLUE}http://localhost:${PORT}${NC}"
if [ "$LOCAL_IP" != "localhost" ] && [ -n "$LOCAL_IP" ]; then
echo -e "   Network: ${BLUE}http://${LOCAL_IP}:${PORT}${NC}"
fi
echo ""
echo -e "Commands:"
echo "   Stop:    $COMPOSE down"
echo "   Start:   $COMPOSE up -d"
echo "   Logs:    $COMPOSE logs -f"
echo ""
