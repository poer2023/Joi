# Joi Local Repo and App State

Last updated: 2026-07-17 Asia/Shanghai

## Source of Truth

The active Joi repository on this Mac is:

```text
/Users/hao/project/Joi
```

Use this path for all code edits, builds, tests, packaging, and documentation updates.

The old path is not a source tree and is absent on the current machine:

```text
/Users/hao/Documents/Joi
```

Do not recreate it, use it as evidence, or build from it. Older shortcuts must
be updated to `/Users/hao/project/Joi` instead.

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

The release baseline is the clean, pushed `main` branch in the canonical repo.
The current package path is:

```text
dist/desktop/Joi-0.1.1-macos-arm64.zip
dist/desktop/Joi-0.1.1-macos-arm64.manifest.json
```

The build source app is temporary:

```text
apps/joi-electron/release-desktop/mac-arm64/Joi.app
```

`scripts/package_desktop_macos.sh` removes that bundle after the installed app,
ZIP, manifest, provenance, and code signature have all been verified. A
successful package run also removes superseded `app-archive-*` rollback copies
and older macOS ARM64 ZIP/manifest pairs. The steady state is therefore:

- one runnable bundle: `/Applications/Joi.app`;
- one current distributable ZIP and matching manifest under `dist/desktop`;
- no runnable App under the repository, `.local`, `~/.joi/runtime`, or Trash.

## Branch And Build Isolation

`/Applications/Joi.app` is the production-like local install. The default
packaging path may replace it only when all of these conditions are true:

- the source root resolves to `/Users/hao/project/Joi`;
- the checked-out branch is `main`;
- the main worktree is clean, including untracked files;
- `HEAD` exactly equals the locally fetched `origin/main`.

This guard lives in `scripts/package_desktop_macos.sh`. Feature and exploration
branches may still run source builds and tests, but they cannot silently replace
the installed app. An exceptional non-main install requires the explicit
`JOI_ALLOW_NON_MAIN_INSTALL=1` override and is intentionally visible in the
package output.

Every packaged app contains:

```text
/Applications/Joi.app/Contents/Resources/joi-build-provenance.json
```

The provenance records the exact Git branch, commit, canonical source root,
`origin/main` commit, build time, install target, and whether the safety guard
was bypassed. Use it before diagnosing a possible preview/installed-app mismatch.

The local and remote repository keep `main` as the only branch. Historical
implementation remains available through Git history, not parallel branches,
stashes, detached worktrees, or runnable App copies.

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

As of 2026-07-17, the stale `/Users/hao/Documents/Joi` path is absent, old App
bundles and local build archives have been removed, and the packaging workflow
now enforces the single-installed-App steady state after every successful run.
The user-data directory under `~/Library/Application Support/Joi` is explicitly
outside this cleanup boundary.
