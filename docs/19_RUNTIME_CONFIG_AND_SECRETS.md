# Runtime Config and Secrets

Runtime config is loaded with this priority:

1. Environment variables
2. `runtime.yaml`
3. Built-in defaults

Secrets must stay in environment variables or a local `.env` file loaded by the process manager. The app may log whether a secret is present, but must never print secret values.

## Files

- `configs/runtime.example.yaml`: non-secret runtime defaults.
- `configs/secrets.example.env`: local secret variable names.

Copy them locally when needed:

```bash
cp configs/runtime.example.yaml configs/runtime.yaml
cp configs/secrets.example.env .env
```

## Covered Config

MODEL:

- `MODEL_PROVIDER`
- `MODEL_BASE_URL`
- `MODEL_NAME`
- `MODEL_TIMEOUT_SECONDS`
- `MODEL_MAX_RETRIES`
- `MODEL_API_KEY` from secrets only

TELEGRAM:

- `TELEGRAM_BOT_TOKEN` from secrets only
- `TELEGRAM_ALLOWED_USER_IDS`

TASK_QUEUE:

- `TASK_QUEUE_DRIVER`
- `NATS_URL`
- `NATS_STREAM`
- `NATS_TASK_SUBJECT`

NODE / WORKER:

- `NODE_ID`
- `NODE_SECRET`
- `WORKER_TOKEN`
- `WORKER_CAPABILITIES`
- `WORKER_ALLOW_AUTO_ASSIGN`
- `WORKER_ALLOW_MANUAL_ASSIGN`

PUBLIC_URL:

- `PUBLIC_BASE_URL`
- `CONSOLE_BASE_URL`
- `ORCHESTRATOR_URL`

## Logging Rules

Allowed in startup logs:

- selected driver
- selected model provider and model name
- public URLs
- node ID
- allowed user count
- whether a secret is present

Forbidden in startup logs:

- API keys
- bot tokens
- node secrets
- worker tokens
- complete database URLs if they include credentials
