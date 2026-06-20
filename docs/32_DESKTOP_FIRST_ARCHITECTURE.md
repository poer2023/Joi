# Desktop-first Architecture

Joi's default product shape is a local Electron-native Desktop App. Server Mode remains available, but it is no longer the default user path.

## Product Modes

### Desktop Mode

Desktop Mode is the default.

- Product entry: `Joi.app`
- UI: embedded desktop UI
- Runtime: Electron main/preload/renderer with TypeScript store/runtime services
- Storage: local SQLite
- Task queue: SQLiteTaskQueue
- Memory OS: local-first
- Telegram: optional gateway
- Remote Worker: optional standby node
- Docker: not required
- Postgres: not required
- NATS: not required
- Browser localhost Console: not required

The user should open Joi and chat. They should not start Docker, Postgres, NATS, or a localhost web server.

### Server Mode

Server Mode is an advanced deployment shape.

- Product entry: orchestrator service + Web Console
- UI: Web Console
- Storage: Postgres
- Task queue: Postgres or NATS JetStream
- Docker Compose: allowed for deployment and development
- Target: Linux server, Mac mini, high-availability host, multiple workers

Server Mode is for long-running infrastructure and high-concurrency use, not the default App experience.

### Worker Mode

Worker Mode is an execution node.

- Product entry: `worker-runtime`
- Storage: none
- Task queue: remote gateway or server queue
- Responsibilities: claim minimal tasks, execute allowed read-only capabilities, ack/fail results
- Memory access: no full memory database

Remote Workers are standby nodes. They are not a dependency for Desktop Mode startup.

## Storage

Desktop Mode defaults to SQLite at the local app data path:

- macOS: `~/Library/Application Support/Joi/joi.db`
- Linux: `~/.local/share/joi/joi.db`

SQLite runs with:

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

SQLite FTS5 is the first local full-text memory search engine. Vector search can be added later only after Memory Studio governance is proven useful.

Postgres remains supported for Server Mode.

## Queue

Desktop Mode defaults to SQLiteTaskQueue. Local worker loops can consume from the same SQLite database.

Remote Workers must not connect directly to SQLite. They connect through Worker Gateway APIs:

- `POST /worker/register`
- `POST /worker/heartbeat`
- `POST /worker/tasks/claim`
- `POST /worker/tasks/{id}/ack`
- `POST /worker/tasks/{id}/fail`

Server Mode can continue to use NATS JetStream.

## UI

The existing React desktop UI is retained in two roles:

- embedded UI source for Electron Desktop
- Server Mode UI

The default product entry is not `localhost:3000`.

## Memory OS

Memory OS is local-first in Desktop Mode:

- confirmed memories live in local SQLite
- candidate memories go through Memory Inbox
- disabled memories must not be retrieved
- remote backups are optional and encrypted later

Remote Workers receive only minimum task payloads and never receive full long-term memory.

## Backup

Desktop Mode backups are local-first:

- SQLite database
- agent configs
- capability configs
- prompts
- runtime config
- memory export JSONL

Plaintext secrets must not be included:

- `MODEL_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `WORKER_TOKEN`
- `NODE_SECRET`

Secret storage moves toward macOS Keychain and Linux Secret Service.

## Architecture Rule

Desktop Mode must not become a Web service wrapped in a desktop shell. Electron calls local TypeScript services over a controlled preload IPC bridge. Localhost HTTP may exist as a temporary compatibility bridge, but it is not the formal Desktop architecture.
