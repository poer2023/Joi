# RC0 Status

Status date: 2026-05-22
Release tag target: `rc0-local-real-loop`

## Completed Capabilities

- Real DeepSeek model path through `openai_compatible` provider.
- Prompt assembly, model call trace, cache metadata, token and latency recording.
- Agent runtime with structured outputs, parse repair, model call limits, capability limits, and final answer handling.
- Memory Context Pack, memory governance, feedback, rerank, conflict and disabled memory controls.
- Read-only server diagnosis, read-only web research, and read-only system health check.
- Postgres task queue, NATS JetStream queue implementation, local worker, and remote worker node abstraction.
- Telegram Gateway private text entry, allowlist, explicit agent routing, and Trace link reply.
- Console pages for chat, run trace, agents, capabilities, memory, nodes, confirmations, prompt cache, model usage, and system health.
- Security eval coverage for dangerous operations, SSRF, local file and secret access, unauthorized Telegram, and forged nodes.

## Real Verification

- `MODEL_PROVIDER=openai_compatible`
- `MODEL_BASE_URL=https://api.deepseek.com`
- Current model: `deepseek-v4-flash`
- `ALLOW_MOCK_PROVIDER=false` and `REQUIRE_REAL_MODEL=true` have been used for real checks.
- Current Telegram bot: `dybz2bot`
- Current Telegram access: allowlisted private chat only.
- Current public console URL: Cloudflare quick tunnel from `PUBLIC_CONSOLE_URL`.
- Current VPS worker: `vps-la-1` on the RackNerd/Coolify host.
- Current remote worker network: public SSH reverse tunnel to private Postgres/NATS endpoints; database and queue are not exposed directly.
- Current remote worker allowed capabilities: `web_research_v1`, `fetch_url`, `server_diagnose_self`, `system_health_check_self`.

## Verification Flags

- real_model_verified=true
- real_telegram_verified=true
- real_vps_worker_verified=true
- security_evals_verified=true
- reboot_recovery_verified=false
- soak_24h_verified=false
- console_external_auth_verified=true
- reboot_acceptance_script_current_session_passed=true
- smoke_soak_verified=true

## Unverified Items

- Full host reboot recovery has not been verified yet because the main machine has not been rebooted during this RC0 pass.
- Full 24 hour soak test has not completed yet.
- Console/API management endpoints are protected by `ADMIN_TOKEN`; current no-auth API access returns 401.

## Known Risks

- The current Telegram bot is reused from OpenClaw and is a temporary operations shortcut.
- Cloudflare quick tunnel URLs can change; production should use a stable tunnel/domain.
- VPS worker currently depends on SSH reverse tunnel liveness.
- DeepSeek output can vary; evals validate structure instead of exact wording.
- Cost limits are warning-oriented in RC0; high-cost confirmation can be tightened after real usage baselines.

## Startup

Local development:

```bash
make dev-up
```

Single-node production profile:

```bash
make prod-up
```

Worker:

```bash
make worker-up
```

Manual environment load:

```bash
set -a
source configs/secrets.local.env
set +a
```

## Rollback

- Stop current services with `make dev-down` or the matching process manager.
- Restore the previous binary or container image.
- Restore PostgreSQL using `scripts/restore.sh`.
- Restart orchestrator, console, telegram-gateway, worker-runtime, NATS, and tunnel.

## Backup

Use:

```bash
make backup
```

Backups include PostgreSQL, configs, prompts, runtime yaml, memory jsonl, agent configs, and capability configs. Raw `.env` secrets are not packed into ordinary backups.

## Tagging

`rc0-local-real-loop` should point at the commit that contains this RC0 state document and the RC0 acceptance scripts.
