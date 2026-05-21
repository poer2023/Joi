# Worker Failure Drill

Goal: prove remote worker loss is visible, retried safely, and recovered.

## Drill Cases

- Kill `worker-runtime`.
- Stop the SSH reverse tunnel.
- Reboot VPS.
- Make NATS temporarily unavailable.
- Make Orchestrator temporarily unavailable.

## Commands

Read-only status:

```bash
set -a
source configs/secrets.local.env
set +a
./scripts/worker_failure_drill.sh check_only
```

Kill worker process:

```bash
DRILL_CONFIRM=YES ./scripts/worker_failure_drill.sh kill_worker
```

Reboot VPS:

```bash
DRILL_CONFIRM=YES ./scripts/worker_failure_drill.sh restart_vps
```

## Expected Results

- Node Console marks `vps-la-1` offline after heartbeat expiry.
- Running tasks move to retry or dead according to retry policy.
- New tasks are not claimed by unauthorized nodes.
- After worker and tunnel recover, heartbeat returns to healthy.

## systemd/autossh Recommendation

Use a systemd unit for worker-runtime and a separate autossh or systemd-managed SSH reverse tunnel. Keep database and NATS bound to localhost on the main machine.

Example tunnel command:

```bash
autossh -M 0 -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 15432:127.0.0.1:5432 racknerd-e0ccce3
```

Worker service should set only the minimum required env:

```bash
NODE_ID=vps-la-1
WORKER_TOKEN=...
NODE_SECRET=...
DATABASE_URL=postgres://agentos:...@127.0.0.1:15432/agentos?sslmode=disable
WORKER_CAPABILITIES=web_research_v1,fetch_url,server_diagnose_self,system_health_check_self
```
