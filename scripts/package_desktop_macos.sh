#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${APP_VERSION:-0.1.1}"
DIST_DIR="$ROOT_DIR/dist/desktop"
BUILT_APP="$ROOT_DIR/apps/joi-electron/release-desktop/mac-arm64/Joi.app"
STAGE_DIR="$DIST_DIR/.package-stage"
APP_BUNDLE="$STAGE_DIR/Joi.app"
INSTALL_APP="${INSTALL_APP:-/Applications/Joi.app}"
PACKAGE="$DIST_DIR/Joi-$VERSION-macos-arm64.zip"
MANIFEST="$DIST_DIR/Joi-$VERSION-macos-arm64.manifest.json"

mkdir -p "$DIST_DIR"
rm -f "$PACKAGE" "$MANIFEST"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

APP_VERSION="$VERSION" /bin/bash "$ROOT_DIR/scripts/build_desktop_macos.sh"
test -x "$BUILT_APP/Contents/MacOS/Joi"

ditto "$BUILT_APP" "$APP_BUNDLE"
xattr -cr "$APP_BUNDLE" || true

EXISTING_PIDS="$(
  /bin/ps -axo pid=,args= | /usr/bin/awk -v app="$INSTALL_APP" '
    index($0, app "/Contents/MacOS/Joi") {
      print $1
    }'
)"
if [[ -n "$EXISTING_PIDS" ]]; then
  /bin/kill $EXISTING_PIDS >/dev/null 2>&1 || true
  sleep 1
fi

if [[ -e "$INSTALL_APP" ]]; then
  ARCHIVE_DIR="$ROOT_DIR/.local/app-archive-$(date +%Y%m%d-%H%M%S)/Applications"
  mkdir -p "$ARCHIVE_DIR"
  mv "$INSTALL_APP" "$ARCHIVE_DIR/$(basename "$INSTALL_APP")"
fi
ditto "$APP_BUNDLE" "$INSTALL_APP"
xattr -cr "$INSTALL_APP" || true
touch "$INSTALL_APP"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$INSTALL_APP" >/dev/null 2>&1 || true
fi

cd "$(dirname "$APP_BUNDLE")"
COPYFILE_DISABLE=1 ditto -c -k --norsrc --keepParent "$(basename "$APP_BUNDLE")" "$PACKAGE"
rm -rf "$STAGE_DIR"

cat > "$MANIFEST" <<JSON
{
  "name": "Joi",
  "version": "$VERSION",
  "platform": "macos-arm64",
  "packaging_mode": "electron_app_bundle",
  "app_bundle": "$INSTALL_APP",
  "installed_app": "$INSTALL_APP",
  "runtime_bin": "$INSTALL_APP/Contents/MacOS/Joi",
  "package": "$PACKAGE",
  "source_app": "$BUILT_APP",
  "data_dir": "$HOME/Library/Application Support/Joi",
  "logs_dir": "$HOME/Library/Application Support/Joi/logs",
  "backups_dir": "$HOME/Library/Application Support/Joi/backups",
  "secrets": "macOS Keychain; not included in package or backups"
}
JSON

echo "Desktop Electron macOS package complete: $PACKAGE"
echo "Manifest: $MANIFEST"
