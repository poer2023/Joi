# RC0 Status

Status date: 2026-05-23
Release tag target: `rc0-local-real-loop`
Desktop validation tag: `desktop-rc0-validation`
Desktop validation commit: `2634854`

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
- Desktop Gateway remote worker path: `vps-la-1` verified through Desktop Worker Gateway with `assignment_reason=user_selected`.

## Verification Flags

- real_model_verified=true
- real_telegram_verified=true
- real_vps_worker_verified=true
- security_evals_verified=true
- reboot_recovery_verified=true
- soak_24h_verified=true
- console_external_auth_verified=true
- reboot_acceptance_script_current_session_passed=true
- smoke_soak_verified=true
- desktop_gateway_vps_verified=true
- first_run_onboarding_verified=true
- desktop_backup_restore_verified=true
- desktop_rc0_validation_commit=2634854

## Unverified Items

- Console/API management endpoints are protected by `ADMIN_TOKEN`; current no-auth API access returns 401.

## Reboot Acceptance

- Verified at: 2026-05-22 01:25 Asia/Shanghai
- Run Trace: `run_dc41e3126f3a86114f06797b`
- Result: orchestrator, console, PostgreSQL, queue mode, Telegram, main-node, local-worker-1, vps-la-1, Cloudflare tunnel, and `system_health_check_v1` passed after reboot.

## 24 Hour Soak

- Verified at: 2026-05-23 01:21 Asia/Shanghai
- Log: `logs/soak-24h-20260522-012530.log`
- JSONL: `logs/soak-results-20260522-012530.jsonl`
- Measured active cases: 840
- Success: 840
- Failures: 0
- Success rate: 100%
- Average latency: 3246.74 ms
- p95 latency: 7828 ms
- dead_task: 0
- stuck_running_task: 0
- worker_offline: 0
- model_error: 0
- telegram_error: 0
- nats_reconnect: 0

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
`desktop-rc0-validation` points at `2634854 Complete desktop RC0 validation`.
