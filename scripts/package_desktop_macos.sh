#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${APP_VERSION:-0.1.0-rc0}"
DIST_DIR="$ROOT_DIR/dist/desktop"
APP_BUNDLE="$ROOT_DIR/apps/joi-desktop/build/bin/joi-desktop.app"
PACKAGE="$DIST_DIR/Joi-$VERSION-macos-arm64.zip"
MANIFEST="$DIST_DIR/Joi-$VERSION-macos-arm64.manifest.json"

if [[ ! -d "$APP_BUNDLE" ]]; then
  "$ROOT_DIR/scripts/build_desktop_macos.sh"
fi

mkdir -p "$DIST_DIR"
rm -f "$PACKAGE" "$MANIFEST"

cd "$(dirname "$APP_BUNDLE")"
ditto -c -k --keepParent "$(basename "$APP_BUNDLE")" "$PACKAGE"

cat > "$MANIFEST" <<JSON
{
  "name": "Joi",
  "version": "$VERSION",
  "platform": "macos-arm64",
  "app_bundle": "$APP_BUNDLE",
  "package": "$PACKAGE",
  "data_dir": "$HOME/Library/Application Support/Joi",
  "logs_dir": "$HOME/Library/Application Support/Joi/logs",
  "backups_dir": "$HOME/Library/Application Support/Joi/backups",
  "secrets": "macOS Keychain; not included in package or backups"
}
JSON

echo "Desktop macOS package complete: $PACKAGE"
echo "Manifest: $MANIFEST"
