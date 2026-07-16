#!/usr/bin/env bash
#
# Herdr Hub Connector — Install Script
#
# Downloads/copies the connector, builds it, and installs it as a
# systemd user service. Run this from the connector source directory.
#
# Usage:
#   ./install.sh                 # Interactive install
#   ./install.sh --uninstall     # Remove the service
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/herdr/connector"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }

# ─── Uninstall ──────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--uninstall" ]]; then
    info "Uninstalling Herdr Hub Connector..."

    if command -v node &>/dev/null && [[ -f "$INSTALL_DIR/dist/cli.js" ]]; then
        node "$INSTALL_DIR/dist/cli.js" uninstall
    else
        # Manual cleanup
        systemctl --user stop herdr-connector 2>/dev/null || true
        systemctl --user disable herdr-connector 2>/dev/null || true
        rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/herdr-connector.service"
        systemctl --user daemon-reload 2>/dev/null || true
        ok "Service removed"
    fi

    echo ""
    info "To fully clean up, also remove:"
    echo "  rm -rf $INSTALL_DIR"
    echo "  rm -rf ${XDG_CONFIG_HOME:-$HOME/.config}/herdr/hub-connector"
    echo "  rm -rf ${XDG_STATE_HOME:-$HOME/.local/state}/herdr/hub-connector"
    exit 0
fi

# ─── Prerequisites ──────────────────────────────────────────────────────────────

info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
    err "Node.js is required but not found in PATH."
    err "Install Node.js 20+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VERSION < 20 )); then
    warn "Node.js v$NODE_VERSION detected. v20+ is recommended."
fi
ok "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
    err "npm is required but not found in PATH."
    exit 1
fi
ok "npm $(npm -v)"

if ! command -v systemctl &>/dev/null; then
    err "systemctl not found. This installer requires systemd."
    err "For macOS, use launchd (not yet supported)."
    exit 1
fi
ok "systemd available"

# ─── Build ──────────────────────────────────────────────────────────────────────

info "Building connector..."
cd "$SCRIPT_DIR"

if [[ ! -d "node_modules" ]]; then
    npm install
fi

npm run build
ok "Build complete"

# ─── Install via CLI ────────────────────────────────────────────────────────────

echo ""
info "Running installer..."
echo ""

# Use npx tsx for the source version, or node dist/cli.js if built
if [[ -f "dist/cli.js" ]]; then
    node dist/cli.js install
else
    npx tsx src/cli.ts install
fi
