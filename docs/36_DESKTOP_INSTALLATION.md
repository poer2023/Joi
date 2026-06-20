# Joi Desktop Installation

Version: `0.1.0-rc0`

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
dist/desktop/Joi-0.1.0-rc0-macos-arm64.zip
dist/desktop/Joi-0.1.0-rc0-macos-arm64.manifest.json
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

The TS desktop eval acceptance target is:

```text
17 passed / 0 failed
```
