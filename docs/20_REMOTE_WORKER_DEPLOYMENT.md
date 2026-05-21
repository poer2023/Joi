# Remote Worker Deployment

Phase 3 remote workers connect back to the main node over the public Internet using an authenticated SSH reverse tunnel. The first supported remote node is `vps-la-1`.

Do not expose PostgreSQL or NATS directly to the public Internet. The public path is the VPS SSH endpoint; database and queue traffic stays inside the encrypted SSH tunnel.

## Main Node

Start Postgres, NATS, Orchestrator, and Console on the Mac. The remote worker reaches local PostgreSQL and NATS through reverse-forwarded localhost ports on the VPS.

Required main-node env:

```bash
TASK_QUEUE_DRIVER=postgres
DATABASE_URL=postgres://agentos:...@localhost:5432/agentos?sslmode=disable
NODE_SECRET=...
```

Start the reverse tunnel from the Mac:

```bash
ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 15432:127.0.0.1:5432 \
  racknerd-e0ccce3
```

If `TASK_QUEUE_DRIVER=nats` is enabled later, also add `-R 14222:127.0.0.1:4222` and set the worker's `NATS_URL` to `nats://127.0.0.1:14222`.

## Worker Node

Install the worker binary and configure:

```bash
NODE_ID=vps-la-1
WORKER_TOKEN=...
WORKER_ALLOWED_NODE_IDS=local-worker-1,vps-la-1
TASK_QUEUE_DRIVER=postgres
DATABASE_URL=postgres://agentos:...@127.0.0.1:15432/agentos?sslmode=disable
WORKER_CAPABILITIES=web_research_v1,fetch_url,server_diagnose_self,system_health_check_self
```

The worker can only claim tasks assigned to its own `NODE_ID`. The payload is the minimum capability payload and must not contain the full long-term memory profile.

## v1 Scope

Allowed:

- `server_diagnose_v1` on the worker's own node.
- `web_research_v1` read-only fetch tasks.

Not allowed:

- file writes
- service restart / stop / rm
- broad memory reads
- shell command passthrough

## Verification

1. Confirm `vps-la-1` appears online in Node Console.
2. Run a chat or Console task with `Run on: vps-la-1`.
3. Check Run Trace for `node_id=vps-la-1` and `assignment_reason=user_selected`.
