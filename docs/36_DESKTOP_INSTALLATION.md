# Joi Desktop Installation

Version: `0.1.0-rc0`

## Product Mode

Joi Desktop is the default product path. It runs as a Wails macOS app with embedded UI, embedded AppCore, SQLite storage, SQLite task queue, Memory OS, Worker Gateway, and optional Telegram.

It does not require Docker, Postgres, NATS, or a browser localhost console.

## Build

```bash
cd /Users/hao/Documents/Joi
./scripts/build_desktop_macos.sh
```

Output:

```text
apps/joi-desktop/build/bin/joi-desktop.app
```

## Package

```bash
cd /Users/hao/Documents/Joi
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
cd /Users/hao/Documents/Joi
./scripts/desktop_poc_check.sh
./scripts/run_desktop_evals.sh
```

The Desktop RC0 acceptance target is:

```text
12 passed / 0 failed
```
