# Joi Local Repo and App State

Last updated: 2026-06-23 11:15 Asia/Shanghai

## Source of Truth

The active Joi repository on this Mac is:

```text
/Users/hao/project/Joi
```

Use this path for all code edits, builds, tests, packaging, and documentation updates.

The old path is not a source tree:

```text
/Users/hao/Documents/Joi
```

That path is a stale residual from earlier desktop work. Current terminal access to it is blocked by macOS with `Operation not permitted`, so agents must not use it as evidence for current Joi behavior. If the path must remain reachable for older shortcuts, it should be converted to a symlink to `/Users/hao/project/Joi` after Finder grants access.

## Installed App

The active installed app is:

```text
/Applications/Joi.app
```

It is an Electron-native macOS app using:

```text
apps/joi-electron
apps/joi-desktop/frontend
packages/store
packages/runtime
packages/secrets
database/sqlite/001_init_schema.sql
```

User data is outside the app bundle:

```text
~/Library/Application Support/Joi
```

Do not delete or overwrite this data directory during app repair or package replacement unless explicitly requested.

## Current Package

The latest installed package from this repair line is:

```text
dist/desktop/Joi-0.1.0-20260623.1115-macos-arm64.zip
dist/desktop/Joi-0.1.0-20260623.1115-macos-arm64.manifest.json
```

The build source app is:

```text
apps/joi-electron/release-desktop/mac-arm64/Joi.app
```

## Launch Regression Fixed

The 2026-06-23 local launch failure was not a binary signing crash. The Electron main process stayed alive after the last window closed, but the renderer process was gone. Reopening the app only hit the single-instance lock and did not recreate a window.

The fix is in:

```text
apps/joi-electron/src/main/index.ts
apps/joi-electron/src/main/ipc.ts
```

Current lifecycle behavior:

- `second-instance` ensures a window exists and is visible.
- macOS `activate` ensures a window exists and is visible.
- `did-finish-load`, `ready-to-show`, and a short fallback timer all reveal the window.
- Renderer load/gone events are logged.
- IPC handlers are removed before re-registration so window recreation does not crash on duplicate handlers.

## Verification Commands

Use these from `/Users/hao/project/Joi`:

```bash
pnpm --filter @joi/electron build
pnpm test:electron-contract
/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
```

Manual verification should target the installed app:

```bash
open -a /Applications/Joi.app
```

The repaired reopen path is:

1. Launch `/Applications/Joi.app`.
2. Close the last Joi window.
3. Launch `/Applications/Joi.app` again.
4. Confirm a new renderer process appears and the Joi window is visible.

## Old Residual Cleanup Status

Attempted cleanup from the current terminal:

```text
mv /Users/hao/Documents/Joi ... -> Operation not permitted
osascript/Finder move -> blocked waiting on macOS permission
```

Required manual cleanup if Finder permission is available:

```bash
mkdir -p /Users/hao/project/Joi/.local/stale-documents-joi-archive
mv /Users/hao/Documents/Joi /Users/hao/project/Joi/.local/stale-documents-joi-archive/Joi
ln -s /Users/hao/project/Joi /Users/hao/Documents/Joi
```

If macOS still blocks terminal access, perform the same move in Finder, then create the symlink from Terminal after the old directory is gone.
