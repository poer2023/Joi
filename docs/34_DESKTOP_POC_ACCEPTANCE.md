# Desktop PoC Acceptance

Desktop Mode is the default Joi product path. The acceptance gate is intentionally narrow: prove that Joi can run as a local app with embedded AppCore and SQLite, without starting Docker, Postgres, NATS, or a browser localhost console.

## What The PoC Checks

- `APP_MODE=desktop`
- `DATA_STORE=sqlite`
- `TASK_QUEUE_DRIVER=sqlite`
- `DOCKER_REQUIRED=false`
- AppCore initializes SQLite and applies `database/sqlite/001_init_schema.sql`
- Chat writes `conversations`, `messages`, `runs`, `run_steps`, `prompt_assemblies`, `model_calls`, and `memory_context_packs`
- Run Trace can be read back from SQLite
- Memory Search is available through SQLite FTS5
- System Health reports SQLite and local queue state
- Backup Manager writes a `.joibak` file and excludes secrets

## Run

```bash
./scripts/desktop_poc_check.sh
```

Expected output:

```text
Desktop PoC passed: Electron IPC, TS SQLite store, run trace, task/artifact flow, and desktop evals pass without Docker/Postgres/NATS.
```

With real provider enforcement:

```bash
./scripts/desktop_real_model_check.sh
```

This sets:

```text
ALLOW_MOCK_PROVIDER=false
REQUIRE_REAL_MODEL=true
```

Expected assertions:

```text
model runtime tests passed
preload contract ok
Electron chat has no mock fallback
```

Build the Electron app bundle:

```bash
./scripts/build_desktop_macos.sh
```

The bundle is written under:

```text
apps/joi-electron/release-desktop/mac-arm64/Joi.app
```

## Non-Goals

- This PoC does not replace Server Mode.
- This PoC does not require a remote worker.
- This PoC does not start `docker compose`.

The product gate remains:

```text
Open Joi Desktop App
No Docker
No Postgres
No NATS
Can chat
Can view Trace
Can write local SQLite
Can reopen with data still present
```
