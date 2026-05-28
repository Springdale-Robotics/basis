#!/bin/bash
# Basis Quick Install
# Usage: curl -fsSL https://raw.githubusercontent.com/Springdale-Robotics/basis/main/backend/deploy/get-basis.sh | bash

set -e

REPO_URL="${REPO_URL:-https://github.com/Springdale-Robotics/basis}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/basis}"
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

# Run the native installer (Node/Postgres/Redis + systemd, no Docker).
# Needs root and the checkout path as --source.
cd "$INSTALL_DIR"
exec sudo bash backend/deploy/native/install.sh --source "$INSTALL_DIR"
