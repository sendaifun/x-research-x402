#!/usr/bin/env bash
#
# CT Alpha — One-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yashhsm/ct-alpha/main/install.sh | bash
#
# What it does:
#   1. Checks for / installs Bun
#   2. Clones ct-alpha to ~/ct-alpha
#   3. Runs interactive setup (X API token, watchlist, skill install)
#

set -euo pipefail

REPO="https://github.com/yashhsm/ct-alpha.git"
INSTALL_DIR="$HOME/ct-alpha"

echo ""
echo "  🔍 CT Alpha Installer"
echo "  ─────────────────────"
echo ""

# --- 1. Check Bun ---
if command -v bun &>/dev/null; then
  echo "  ✅ Bun $(bun --version) detected"
else
  echo "  📦 Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if command -v bun &>/dev/null; then
    echo "  ✅ Bun $(bun --version) installed"
  else
    echo "  ❌ Bun installation failed. Install manually: https://bun.sh"
    exit 1
  fi
fi

# --- 2. Clone or update repo ---
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  📂 Existing installation found at $INSTALL_DIR"
  echo "     Pulling latest..."
  cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null || true
else
  if [ -d "$INSTALL_DIR" ]; then
    echo "  ⚠️  $INSTALL_DIR exists but is not a git repo."
    echo "     Remove it first or choose a different location."
    exit 1
  fi
  echo "  📥 Cloning ct-alpha to $INSTALL_DIR..."
  git clone "$REPO" "$INSTALL_DIR"
fi

# --- 3. Run interactive setup ---
echo ""
cd "$INSTALL_DIR"
bun run install.ts
