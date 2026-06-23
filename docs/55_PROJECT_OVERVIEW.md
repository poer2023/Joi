# Joi Project Overview

Last updated: 2026-06-23

Joi is a local-first personal agent OS. Its default product shape is a native-feeling macOS Desktop app backed by local SQLite, macOS Keychain, a TypeScript tool-calling runtime, Memory OS, Run Trace, and optional external entrances such as Telegram, iMessage, and remote Workers.

The default user flow is simple:

```text
open /Applications/Joi.app
chat or start a task
inspect the run, tools, memory, artifacts, and external handoff state inside Desktop
```

Joi is not a generic chat wrapper. The core product idea is that the model proposes structured tool calls, while the local runtime owns permission boundaries, execution, persistence, confirmations, memory, and traceability.

## Current Source and App

```text
repo: /Users/hao/project/Joi
installed app: /Applications/Joi.app
data: ~/Library/Application Support/Joi
```

`/Users/hao/Documents/Joi` is a stale residual path and must not be used as the project source.

## Product Modes

| Mode | Purpose | Default |
|---|---|---|
| Desktop Mode | Personal daily app | Yes |
| Server Mode | Advanced Web Console / orchestrator deployment | No |
| Worker Mode | Optional execution node | No |

Desktop Mode does not require Docker, Postgres, NATS, or a browser localhost console.

## Main Code Areas

| Path | Purpose |
|---|---|
| `apps/joi-electron` | Electron main/preload/renderer shell and desktop lifecycle |
| `apps/joi-desktop/frontend` | Shared React renderer used by Desktop |
| `packages/store` | SQLite store, schema bootstrapping, diagnostics, backups, trace |
| `packages/runtime` | Tool-calling runtime, model providers, capability executors, Worker Gateway |
| `packages/secrets` | Keychain/env secret adapter |
| `packages/shared-types` | Shared Desktop API and DTO contracts |
| `database/sqlite/001_init_schema.sql` | Desktop SQLite schema |
| `docs` | Product, architecture, operation, and implementation documentation |

## Current Runtime Capabilities

- Desktop chat with persisted conversations and runs.
- Real model tool-calling runtime.
- Run Trace and run events.
- Memory OS storage and retrieval.
- Workspace/file/web/read-only diagnostics capabilities.
- Permission-gated write/apply-patch and browser interaction paths.
- Keychain-backed model/Telegram/worker secrets.
- Optional Telegram and iMessage inbound services.
- Optional Worker Gateway for remote task execution.

## Current App Repair Status

The 2026-06-23 local app launch regression was fixed in the Electron main lifecycle. Reopening Joi after closing the last window now recreates or shows the main window instead of leaving the app with only a hidden main process.

Verification and package details are tracked in:

```text
docs/54_LOCAL_REPO_AND_APP_STATE.md
docs/36_DESKTOP_INSTALLATION.md
docs/53_ELECTRON_NATIVE_REFACTOR.md
```
