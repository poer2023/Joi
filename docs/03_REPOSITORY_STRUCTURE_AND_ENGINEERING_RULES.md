# 03 仓库结构与工程规范

当前真实仓库是 `/Users/hao/project/Joi`。旧路径 `/Users/hao/Documents/Joi` 是残留路径，不是源码入口。

## 1. 当前结构

```text
Joi/
  apps/
    joi-electron/          # Electron-native desktop shell
    joi-desktop/frontend/  # Shared React renderer
    console-web/           # Server Mode / historical Web Console
  packages/
    store/                 # SQLite store and local persistence
    runtime/               # Tool-calling runtime and capability executors
    secrets/               # Keychain/env secret adapter
    shared-types/          # Shared Desktop API contracts
  database/
    sqlite/                # Desktop SQLite schema
  services/
    orchestrator-core/     # Server Mode / historical Go path
  docs/
  scripts/
  tasks/
```

## 2. Desktop Code Boundaries

- Electron lifecycle, window behavior, IPC registration, and inbound service startup live in `apps/joi-electron/src/main`.
- Controlled renderer bridge code lives in `apps/joi-electron/src/preload`.
- Shared UI components and Desktop screens live in `apps/joi-desktop/frontend`.
- Runtime/tool execution logic lives in `packages/runtime`.
- SQLite persistence and schema migration compatibility live in `packages/store` and `database/sqlite`.

Do not reintroduce a Wails runtime fallback or treat browser preview as proof of installed app behavior.

## 3. IDs and Statuses

ID prefixes:

| Type | Prefix |
|---|---|
| run | `run_` |
| step | `step_` |
| message | `msg_` |
| memory | `mem_` |
| node | `node_` |
| task | `task_` |
| tool run | `toolrun_` |

Statuses are lower snake case: `pending`, `running`, `succeeded`, `failed`, `blocked`, `requires_confirmation`.

## 4. Logs and Diagnostics

Logs and diagnostics must be structured enough to link back to run or task state:

```json
{
  "timestamp": "...",
  "service": "joi-desktop",
  "level": "info",
  "run_id": "run_xxx",
  "step_id": "step_xxx",
  "message": "tool finished",
  "metadata": {}
}
```

Diagnostics exports must redact secrets, prompt bodies, raw model output, and sensitive tool output.

## 5. Schema and Data Rules

- Desktop user data lives in `~/Library/Application Support/Joi`.
- Schema changes must be represented in `database/sqlite/001_init_schema.sql` and store migration/compatibility code when needed.
- Do not delete, reset, or overwrite the live user data directory during app repair unless explicitly requested.

## 6. Error Codes

```text
VALIDATION_ERROR
ROUTER_LOW_CONFIDENCE
MODEL_PROVIDER_ERROR
POLICY_DENIED
REQUIRES_CONFIRMATION
CAPABILITY_NOT_FOUND
TOOL_EXECUTION_FAILED
NODE_UNAVAILABLE
MEMORY_SEARCH_FAILED
DATABASE_ERROR
TIMEOUT
```
