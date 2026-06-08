#!/usr/bin/env bash
# Install savant-gateway as a launchd agent (macOS).
# Starts automatically on login, restarts on crash.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="$HOME"
PLIST_NAME="com.savant.gateway"
PLIST_DEST="$HOME_DIR/Library/LaunchAgents/$PLIST_NAME.plist"
NODE_BIN="$(command -v node)"
PORT="${GATEWAY_PORT:-3100}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found in PATH. Install Node.js first."
  exit 1
fi

mkdir -p "$HOME_DIR/.savant"
mkdir -p "$HOME_DIR/Library/LaunchAgents"

# Install dependencies if node_modules is missing.
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "→ Installing dependencies..."
  npm install --prefix "$SCRIPT_DIR" --omit=dev
fi

# Render plist from template.
sed \
  -e "s|INSTALL_DIR|$SCRIPT_DIR|g" \
  -e "s|HOME_DIR|$HOME_DIR|g" \
  -e "s|NODE_BIN|$NODE_BIN|g" \
  -e "s|GATEWAY_PORT_VALUE|$PORT|g" \
  "$SCRIPT_DIR/$PLIST_NAME.plist.template" > "$PLIST_DEST"

# Reload as a LaunchAgent for the current GUI user.
UID_VALUE="$(id -u)"
LAUNCHD_DOMAIN="gui/${UID_VALUE}"
launchctl bootout "$LAUNCHD_DOMAIN" "$PLIST_DEST" 2>/dev/null || true
launchctl bootstrap "$LAUNCHD_DOMAIN" "$PLIST_DEST"
launchctl enable "$LAUNCHD_DOMAIN/$PLIST_NAME"
launchctl kickstart -k "$LAUNCHD_DOMAIN/$PLIST_NAME"

# Wait briefly for health so install confirms server startup.
for _ in {1..20}; do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "✓ savant-gateway installed and started"
echo "  Port : $PORT"
echo "  Logs : $HOME_DIR/.savant/gateway.log"
echo "  Plist: $PLIST_DEST"
echo "  Health: $HEALTH_URL"
echo ""
echo "  Other commands:"
echo "    launchctl bootout $LAUNCHD_DOMAIN $PLIST_DEST                # stop"
echo "    launchctl bootstrap $LAUNCHD_DOMAIN $PLIST_DEST              # start"
echo "    launchctl kickstart -k $LAUNCHD_DOMAIN/$PLIST_NAME           # restart"
echo "    curl $HEALTH_URL"
