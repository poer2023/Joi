# Reboot Acceptance

Goal: prove Joi recovers after the main Mac reboots.

## Preconditions

- `configs/secrets.local.env` contains real DeepSeek, Telegram, public URL, worker, and `ADMIN_TOKEN` values.
- Production or dev process manager starts orchestrator, console, telegram-gateway, worker-runtime, Postgres, NATS, Cloudflare tunnel, and the SSH reverse tunnel.
- `vps-la-1` worker is allowed to reconnect through the public SSH reverse tunnel.

## Procedure

1. Start the selected profile and verify `scripts/check_prod_status.sh` passes.
2. Reboot the main machine.
3. Wait 2 minutes after login or service manager startup.
4. Run:

```bash
set -a
source configs/secrets.local.env
set +a
./scripts/reboot_acceptance_check.sh
```

## Required Checks

- orchestrator `/ready`
- Console reachable
- PostgreSQL query
- NATS monitor or Postgres queue fallback
- Telegram bot `getMe`
- main-node registered
- local-worker-1 registered and healthy
- vps-la-1 registered and healthy
- Cloudflare tunnel public URL reachable
- `system_health_check_v1` creates a Run Trace

## Pass Criteria

All checks must pass. After passing, update `docs/25_RC0_STATUS.md`:

```text
reboot_recovery_verified=true
```
