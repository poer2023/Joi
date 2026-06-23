# Joi Desktop Installation

Version: `0.1.0-20260623.1115`

Local state reference: `docs/54_LOCAL_REPO_AND_APP_STATE.md`

## Product Mode

Joi Desktop is the default product path. It now runs as an Electron-native macOS app with the shared React renderer, TypeScript SQLite store/runtime, macOS Keychain, SQLite task queue, Memory OS, Worker Gateway, and optional Telegram.

It does not require Docker, Postgres, NATS, or a browser localhost console.

## Build

```bash
cd /Users/hao/project/Joi
./scripts/build_desktop_macos.sh
```

Output:

```text
apps/joi-electron/release-desktop/mac-arm64/Joi.app
```

## Package

```bash
cd /Users/hao/project/Joi
./scripts/package_desktop_macos.sh
```

Output:

```text
dist/desktop/Joi-0.1.0-20260623.1115-macos-arm64.zip
dist/desktop/Joi-0.1.0-20260623.1115-macos-arm64.manifest.json
```

## Runtime Defaults

```text
APP_MODE=desktop
DATA_STORE=sqlite
TASK_QUEUE_DRIVER=sqlite
DOCKER_REQUIRED=false
```

Secrets are read from macOS Keychain first. Environment variables remain a development fallback.

## Verification

```bash
cd /Users/hao/project/Joi
pnpm test:electron-contract
pnpm test:runtime
pnpm test:store
pnpm eval:desktop:ts
pnpm build:electron
```

Installed app verification:

```bash
/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
open -a /Applications/Joi.app
```

The 2026-06-23 launch regression fix requires this manual reopen check:

1. Launch `/Applications/Joi.app`.
2. Close the last Joi window.
3. Launch `/Applications/Joi.app` again.
4. Confirm the Joi window reappears.

The TS desktop eval acceptance target is:

```text
17 passed / 0 failed
```
