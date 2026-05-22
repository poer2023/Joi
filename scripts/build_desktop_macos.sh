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

cd "$APP_DIR/frontend"
npm run build

cd "$APP_DIR"
go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2 build

APP_BUNDLE="$APP_DIR/build/bin/joi-desktop.app"
test -d "$APP_BUNDLE"
test -x "$APP_BUNDLE/Contents/MacOS/Joi"

echo "Desktop macOS build complete: $APP_BUNDLE"
