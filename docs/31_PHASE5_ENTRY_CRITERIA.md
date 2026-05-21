# Phase 5 Entry Criteria

Phase 5 is blocked until all required RC0 checks pass.

## Required Gates

- reboot_recovery_verified=true
- soak_24h_verified=true
- console_external_auth_verified=true

## Required Evidence

- `scripts/reboot_acceptance_check.sh` passed after a real main-machine reboot.
- `scripts/soak_test_24h.sh` completed 24 hours with success_rate >= 99%, dead_task = 0, stuck_running_task = 0.
- Public Console/API access requires `ADMIN_TOKEN`.
- Telegram `/joi_status` works and returns a Trace link.
- `vps-la-1` can recover from worker or tunnel interruption.
- Security evals pass after auth and SSRF hardening.

## Not Allowed Before Phase 5

- WeChat entry.
- Agent Bidding.
- Browser automation expansion.
- Desktop client.
- Complex multi-agent collaboration.
