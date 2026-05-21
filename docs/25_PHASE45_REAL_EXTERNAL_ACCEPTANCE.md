# Phase 4.5 Real External Acceptance

Phase 4.5 is the cutover from local verified behavior to real external
operation. Mock provider fallback must be disabled for model acceptance.

## Required Environment

```bash
MODEL_PROVIDER=openai_compatible
MODEL_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=...
MODEL_NAME=deepseek-v4-flash
MODEL_TIMEOUT_SECONDS=60
MODEL_MAX_RETRIES=1
ALLOW_MOCK_PROVIDER=false
REQUIRE_REAL_MODEL=true

TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=123456789
PUBLIC_CONSOLE_URL=https://joi-console.<public-tunnel-domain>

TASK_QUEUE_DRIVER=nats
NATS_URL=nats://<controller-tailnet-ip>:4222
WORKER_ALLOWED_NODE_IDS=local-worker-1,vps-la-1
NODE_SECRET=...
WORKER_TOKEN=...
```

## Order

1. Start controller stack with Postgres, NATS, orchestrator, console, and local
   worker.
2. Export `DEEPSEEK_API_KEY`, then run `make model-baseline`.
3. Run `make telegram-check`, then manually send an allowed private Telegram
   message and verify the Trace URL.
4. Deploy `worker-runtime` to `vps-la-1` through the public SSH reverse tunnel described in `docs/20_REMOTE_WORKER_DEPLOYMENT.md`.
5. Run `make vps-worker-check`.
6. Run `make prod-status`.
7. Run `SOAK_DURATION_SECONDS=86400 make soak-test`.

## Acceptance Criteria

- No model call has `provider=mock_provider`.
- No model call has `fallback_to_mock=true`.
- Run Trace shows `real_model=true`, tokens, latency, cache fields, and cost.
- Telegram replies use the public Console URL, not localhost.
- `vps-la-1` is healthy and manually selected web research is assigned to it.
- Worker disconnect causes offline/retry/dead-task state to appear and recover.
- 24-hour soak success rate is at least 99%, dead tasks are zero, and running
  tasks recover after restart.
