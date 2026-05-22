# Server Mode

Server Mode is now the advanced deployment path, not the default Joi product path.

## Default User Path

Normal users should run Desktop Mode:

```text
APP_MODE=desktop
DATA_STORE=sqlite
TASK_QUEUE_DRIVER=sqlite
UI=embedded
DOCKER_REQUIRED=false
```

Desktop Mode packages the UI, AppCore, local SQLite store, SQLite task queue, Memory OS, Worker Gateway, and optional Telegram Gateway into the local app lifecycle.

## Server Mode Use Cases

Use Server Mode when the deployment needs:

- Linux server long-running operation
- Multiple remote workers at higher volume
- Postgres durability and external database administration
- NATS JetStream queueing
- Web Console as a separate service
- Docker Compose based development or production operations

Server Mode defaults:

```text
APP_MODE=server
DATA_STORE=postgres
TASK_QUEUE_DRIVER=nats
UI=web
```

## What Remains

The existing Web Console, Docker Compose files, Postgres migrations, NATS queue, Telegram Gateway, Worker Runtime, real-model checks, and RC0 scripts remain valid for Server Mode and development.

## Boundary

Server Mode must not leak back into the default product story. A user opening Joi as an app should not need to start Docker, Postgres, NATS, Web Console, or Orchestrator HTTP service manually.
