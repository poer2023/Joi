# 24 Hour Soak Test Report

Status: full 24 hour run in progress after reboot acceptance.

## Smoke Soak

Run a 2 hour smoke soak first:

```bash
set -a
source configs/secrets.local.env
set +a
SOAK_DURATION_SECONDS=7200 SOAK_INTERVAL_SECONDS=600 ./scripts/soak_test_24h.sh
```

## Full Soak

Run the formal 24 hour soak:

```bash
set -a
source configs/secrets.local.env
set +a
SOAK_DURATION_SECONDS=86400 SOAK_INTERVAL_SECONDS=600 ./scripts/soak_test_24h.sh
```

## Metrics To Record

- success_rate
- avg_latency_ms
- p95_latency_ms
- dead_task
- stuck_running_task
- worker_offline
- model_error
- telegram_error
- nats_reconnect

## RC0 Target

- success_rate >= 99%
- dead_task = 0
- stuck_running_task = 0

## Latest Smoke Result

- Duration: 1 second smoke run
- Total cases: 6
- Success: 6
- Failures: 0
- Success rate: 100%
- p95 latency: 5801 ms
- dead_task: 0
- stuck_running_task: 0
- worker_offline: 0
- model_error: 0
- telegram_error: 0
- nats_reconnect: 0
- Output: `soak-results-20260522-004432.jsonl`

No completed 24 hour soak result has been recorded yet.

## Current Full Run

- Started at: 2026-05-22 01:25 Asia/Shanghai
- Log: `logs/soak-24h-20260522-012530.log`
- JSONL: `logs/soak-results-20260522-012530.jsonl`
- First cycle: health, system health, memory, web research, tiny model call, and queue ack all passed.
