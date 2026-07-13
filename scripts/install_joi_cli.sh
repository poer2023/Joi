#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="${JOI_APP_BUNDLE:-/Applications/Joi.app}"
SOURCE="$ROOT_DIR/apps/joi-cli/bin/joi"
TARGET_DIR="${JOI_CLI_BIN_DIR:-$HOME/.local/bin}"
TARGET="$TARGET_DIR/joi"

test -x "$APP_BUNDLE/Contents/MacOS/Joi"
test -f "$APP_BUNDLE/Contents/Resources/cli/joi.mjs"
mkdir -p "$TARGET_DIR"

if [[ -e "$TARGET" ]] && ! /usr/bin/grep -q 'Joi managed CLI launcher' "$TARGET"; then
  echo "Refusing to replace unmanaged command: $TARGET" >&2
  exit 1
fi

/usr/bin/install -m 0755 "$SOURCE" "$TARGET"
echo "Joi CLI installed: $TARGET"
