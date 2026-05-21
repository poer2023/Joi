# Real World E2E Acceptance

The real-world E2E package verifies Joi against real infrastructure rather than mocks.

Run:

```bash
ALLOW_MOCK_PROVIDER=false REQUIRE_REAL_MODEL=true REQUIRE_REAL_TELEGRAM=true ./scripts/e2e_real_check.sh
```

Required checks:

- Orchestrator `/ready`
- Console HTTP response
- PostgreSQL connectivity
- NATS connectivity
- model provider health
- Telegram bot token and bot API
- `main-node`
- `local-worker-1`
- `web_research_v1`
- `server_diagnose_v1`
- Run Trace presence for created runs

Rules:

- If `ALLOW_MOCK_PROVIDER=false`, any `fallback_to_mock` model call is a failure.
- If `REQUIRE_REAL_MODEL=true`, the model provider must be available and not `mock_provider`.
- If `REQUIRE_REAL_TELEGRAM=true`, `TELEGRAM_BOT_TOKEN` must be set and `getMe` must succeed.
- The script must never print API keys or bot tokens.
