#!/bin/bash
# Basis Quick Install
# Usage: curl -fsSL https://get.homemanager.app/install.sh | bash

set -e

REPO_URL="${REPO_URL:-https://github.com/your-username/homemanager}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/homemanager}"
BRANCH="${BRANCH:-main}"

echo "Downloading Basis..."

# Check git
command -v git >/dev/null 2>&1 || { echo "Git required: sudo apt install git"; exit 1; }

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR" && git pull --quiet
else
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR" --quiet
fi

# Run installer
cd "$INSTALL_DIR/backend"
chmod +x install.sh
exec ./install.sh
