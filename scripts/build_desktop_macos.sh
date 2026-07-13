#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${APP_VERSION:-0.1.1}"
ELECTRON_DIR="$ROOT_DIR/apps/joi-electron"
OUTPUT_DIR="$ELECTRON_DIR/release-desktop"
APP_BUNDLE="$OUTPUT_DIR/mac-arm64/Joi.app"

export APP_MODE=desktop
export DATA_STORE=sqlite
export TASK_QUEUE_DRIVER=sqlite
export DOCKER_REQUIRED=false
export APP_VERSION="$VERSION"

cd "$ROOT_DIR"
pnpm --filter @joi/electron build
rm -rf "$OUTPUT_DIR"
pnpm --filter @joi/electron exec electron-builder --mac dir --arm64 --config.directories.output=release-desktop --config.mac.identity=null

test -d "$APP_BUNDLE"
test -x "$APP_BUNDLE/Contents/MacOS/Joi"

if [[ -n "${JOI_BUILD_PROVENANCE_FILE:-}" ]]; then
  test -f "$JOI_BUILD_PROVENANCE_FILE"
  install -m 0644 "$JOI_BUILD_PROVENANCE_FILE" \
    "$APP_BUNDLE/Contents/Resources/joi-build-provenance.json"
fi

SIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
if [[ -z "$SIGN_IDENTITY" ]] && command -v security >/dev/null 2>&1; then
  SIGN_IDENTITY="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | awk -F'"' '/Apple Development|Developer ID Application/ { print $2; exit }'
  )"
fi

if [[ -n "$SIGN_IDENTITY" ]]; then
  ENTITLEMENTS="$(
    find "$ROOT_DIR/node_modules/.pnpm" -path '*/app-builder-lib/templates/entitlements.mac.plist' -print -quit
  )"
  if [[ -n "$ENTITLEMENTS" ]]; then
    codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
  else
    codesign --force --deep --options runtime --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
  fi
else
  codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true
fi

codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

echo "Desktop Electron macOS build complete: $APP_BUNDLE"
