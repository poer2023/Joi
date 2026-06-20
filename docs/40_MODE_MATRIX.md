# Joi Mode Matrix

Desktop Mode is the default product shape. Server Mode is an advanced deployment shape. Worker Mode is an execution node.

| Area | Desktop Mode | Server Mode | Worker Mode |
| --- | --- | --- | --- |
| Entry | `Joi.app` | Web Console + orchestrator service | `worker-runtime` |
| UI | Embedded Electron UI | `apps/console-web` | none |
| Storage | SQLite local file | Postgres | none |
| Queue | SQLiteTaskQueue | Postgres or NATS JetStream | remote gateway or server queue |
| Secrets | macOS Keychain, env fallback for dev | env / secret manager | worker token / node secret |
| Docker | not required | optional for deployment | not required |
| NATS | not required | optional/high-throughput queue | optional only in server deployments |
| Memory | local SQLite Memory OS | Postgres Memory OS | no full memory access |
| Worker Gateway | embedded in `Joi.app` | orchestrator service | connects outward |
| Remote Worker | optional standby node | optional scalable nodes | primary role |
| Best For | personal daily app | long-running Linux/server install | VPS/Mac mini/Linux task executor |

## Defaults

```text
desktop:
  APP_MODE=desktop
  DATA_STORE=sqlite
  TASK_QUEUE_DRIVER=sqlite
  UI=embedded
  DOCKER_REQUIRED=false

server:
  APP_MODE=server
  DATA_STORE=postgres
  TASK_QUEUE_DRIVER=nats
  UI=web

worker:
  APP_MODE=worker
  DATA_STORE=none
  TASK_QUEUE_DRIVER=remote_gateway
```

## Product Rule

Normal use starts with Desktop Mode. Web/Compose/NATS/Postgres remain valuable, but they are no longer the default user path.
