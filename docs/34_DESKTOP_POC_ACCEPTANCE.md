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
Desktop PoC passed: SQLite AppCore wrote chat, run trace, health, and backup without Docker/Postgres/NATS.
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
real_model=true
fallback_to_mock=false
model_call_provider=openai_compatible
```

Build the Wails app bundle:

```bash
cd apps/joi-desktop
go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2 build
```

The bundle is written under:

```text
apps/joi-desktop/build/bin/joi-desktop.app
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
