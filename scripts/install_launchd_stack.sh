#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$HOME/.joi/runtime"
PLIST="$HOME/Library/LaunchAgents/com.hao.joi.stack.plist"
LOG_DIR="$HOME/.joi/logs"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$RUNTIME_ROOT"

rsync -a --delete \
  --exclude '.git' \
  --exclude 'apps/console-web/node_modules' \
  --exclude 'apps/console-web/.next' \
  --exclude 'backups' \
  --exclude 'logs' \
  --exclude 'soak-results-*.jsonl' \
  "$ROOT/" "$RUNTIME_ROOT/"

if [[ -f "$ROOT/configs/secrets.local.env" ]]; then
  mkdir -p "$RUNTIME_ROOT/configs"
  cp "$ROOT/configs/secrets.local.env" "$RUNTIME_ROOT/configs/secrets.local.env"
  chmod 600 "$RUNTIME_ROOT/configs/secrets.local.env"
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.hao.joi.stack</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$RUNTIME_ROOT/scripts/launchd_stack.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$RUNTIME_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.hao.joi.stack"
echo "installed $PLIST"
