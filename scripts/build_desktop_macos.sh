#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/joi-desktop"
VERSION="${APP_VERSION:-0.1.0-rc0}"

export APP_MODE=desktop
export DATA_STORE=sqlite
export TASK_QUEUE_DRIVER=sqlite
export DOCKER_REQUIRED=false
export APP_VERSION="$VERSION"

ICON_SOURCE="$APP_DIR/frontend/src/assets/joi-app-icon.png"
if [[ -f "$ICON_SOURCE" ]]; then
  mkdir -p "$APP_DIR/build"
  cp "$ICON_SOURCE" "$APP_DIR/build/appicon.png"
fi

mkdir -p "$APP_DIR/build/darwin"
cat > "$APP_DIR/build/darwin/Info.plist" <<'PLIST'
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
    <dict>
        <key>CFBundlePackageType</key>
        <string>APPL</string>
        <key>CFBundleName</key>
        <string>{{.Info.ProductName}}</string>
        <key>CFBundleExecutable</key>
        <string>{{.OutputFilename}}</string>
        <key>CFBundleIdentifier</key>
        <string>com.hao.joi.desktop</string>
        <key>CFBundleVersion</key>
        <string>{{.Info.ProductVersion}}</string>
        <key>CFBundleGetInfoString</key>
        <string>{{.Info.Comments}}</string>
        <key>CFBundleShortVersionString</key>
        <string>{{.Info.ProductVersion}}</string>
        <key>CFBundleIconFile</key>
        <string>iconfile</string>
        <key>LSMinimumSystemVersion</key>
        <string>10.13.0</string>
        <key>NSHighResolutionCapable</key>
        <string>true</string>
        <key>NSHumanReadableCopyright</key>
        <string>{{.Info.Copyright}}</string>
    </dict>
</plist>
PLIST

cd "$APP_DIR/frontend"
npm run build

cd "$APP_DIR"
go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2 build

APP_BUNDLE="$APP_DIR/build/bin/Joi.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  APP_BUNDLE="$APP_DIR/build/bin/joi-desktop.app"
fi
test -d "$APP_BUNDLE"
test -x "$APP_BUNDLE/Contents/MacOS/Joi"

echo "Desktop macOS build complete: $APP_BUNDLE"
