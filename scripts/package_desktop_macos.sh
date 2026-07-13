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
CANONICAL_ROOT="${JOI_CANONICAL_ROOT:-/Users/hao/project/Joi}"
ALLOW_NON_MAIN_INSTALL="${JOI_ALLOW_NON_MAIN_INSTALL:-0}"
GIT_ROOT="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"
GIT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current)"
GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
ORIGIN_MAIN_COMMIT="$(git -C "$ROOT_DIR" rev-parse --verify refs/remotes/origin/main 2>/dev/null || true)"

CANONICAL_ROOT="$(cd "$CANONICAL_ROOT" && pwd -P)"
GIT_ROOT="$(cd "$GIT_ROOT" && pwd -P)"

if [[ "$INSTALL_APP" == "/Applications/Joi.app" && "$ALLOW_NON_MAIN_INSTALL" != "1" ]]; then
  if [[ "$GIT_ROOT" != "$CANONICAL_ROOT" ]]; then
    echo "Refusing to replace /Applications/Joi.app from non-canonical worktree: $GIT_ROOT" >&2
    echo "Use the clean main checkout at $CANONICAL_ROOT." >&2
    exit 2
  fi
  if [[ "$GIT_BRANCH" != "main" ]]; then
    echo "Refusing to replace /Applications/Joi.app from branch '$GIT_BRANCH'; expected 'main'." >&2
    exit 2
  fi
  if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing to replace /Applications/Joi.app from a dirty main worktree." >&2
    exit 2
  fi
  if [[ -z "$ORIGIN_MAIN_COMMIT" || "$GIT_COMMIT" != "$ORIGIN_MAIN_COMMIT" ]]; then
    echo "Refusing to replace /Applications/Joi.app because HEAD does not equal origin/main." >&2
    echo "HEAD=$GIT_COMMIT origin/main=${ORIGIN_MAIN_COMMIT:-missing}" >&2
    exit 2
  fi
elif [[ "$ALLOW_NON_MAIN_INSTALL" == "1" ]]; then
  echo "Warning: JOI_ALLOW_NON_MAIN_INSTALL=1 bypasses the canonical main install guard." >&2
fi

mkdir -p "$DIST_DIR"
rm -f "$PACKAGE" "$MANIFEST"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

APP_VERSION="$VERSION" /bin/bash "$ROOT_DIR/scripts/build_desktop_macos.sh"
test -x "$BUILT_APP/Contents/MacOS/Joi"

ditto "$BUILT_APP" "$APP_BUNDLE"
xattr -cr "$APP_BUNDLE" || true

BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PROVENANCE="$APP_BUNDLE/Contents/Resources/joi-build-provenance.json"
cat > "$PROVENANCE" <<JSON
{
  "git_commit": "$GIT_COMMIT",
  "git_branch": "$GIT_BRANCH",
  "source_root": "$GIT_ROOT",
  "origin_main_commit": "$ORIGIN_MAIN_COMMIT",
  "built_at": "$BUILD_TIME",
  "install_target": "$INSTALL_APP",
  "canonical_main_guard_bypassed": $([[ "$ALLOW_NON_MAIN_INSTALL" == "1" ]] && echo true || echo false)
}
JSON

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
JOI_APP_BUNDLE="$INSTALL_APP" /bin/bash "$ROOT_DIR/scripts/install_joi_cli.sh"
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
  "git_commit": "$GIT_COMMIT",
  "git_branch": "$GIT_BRANCH",
  "origin_main_commit": "$ORIGIN_MAIN_COMMIT",
  "built_at": "$BUILD_TIME",
  "app_bundle": "$INSTALL_APP",
  "installed_app": "$INSTALL_APP",
  "runtime_bin": "$INSTALL_APP/Contents/MacOS/Joi",
  "cli_bin": "$HOME/.local/bin/joi",
  "package": "$PACKAGE",
  "source_app": "$BUILT_APP",
  "provenance": "$INSTALL_APP/Contents/Resources/joi-build-provenance.json",
  "data_dir": "$HOME/Library/Application Support/Joi",
  "logs_dir": "$HOME/Library/Application Support/Joi/logs",
  "backups_dir": "$HOME/Library/Application Support/Joi/backups",
  "secrets": "macOS Keychain; not included in package or backups"
}
JSON

echo "Desktop Electron macOS package complete: $PACKAGE"
echo "Manifest: $MANIFEST"
