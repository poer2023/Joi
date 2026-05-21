#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CASES="${1:-evals/soak_cases.json}"
DURATION_SECONDS="${SOAK_DURATION_SECONDS:-86400}"
INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-600}"
OUT="${SOAK_OUTPUT:-soak-results-$(date +%Y%m%d-%H%M%S).jsonl}"

python3 - "$API" "$CASES" "$DURATION_SECONDS" "$INTERVAL_SECONDS" "$OUT" <<'PY'
import json, os, statistics, sys, time, urllib.request

api, cases_path, duration, interval, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
cases = json.load(open(cases_path, encoding="utf-8"))
end = time.time() + duration
latencies = []
total = success = failures = 0
dead_task_max = stuck_running_task_max = worker_offline_events = model_error_events = telegram_error_events = nats_reconnect_events = 0

def req(method, path, body=None, timeout=120):
    data = None
    headers = {}
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    if admin_token:
        headers["X-Admin-Token"] = admin_token
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(api.rstrip("/") + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw.startswith("{") else raw

with open(out, "a", encoding="utf-8") as fh:
    while time.time() < end:
        for case in cases:
            total += 1
            started = time.time()
            record = {"ts": time.time(), "case": case["id"], "ok": False}
            try:
                if case["kind"] == "http":
                    req("GET", case["path"])
                else:
                    payload = req("POST", "/api/chat/send", {"channel": "soak", "message": case["message"], "options": {"allow_tools": True, "preferred_node": "main-node", "allow_worker": False}})
                    record["run_id"] = payload["data"]["run_id"]
                record["ok"] = True
                success += 1
            except Exception as exc:
                failures += 1
                record["error"] = str(exc)
            record["latency_ms"] = int((time.time() - started) * 1000)
            latencies.append(record["latency_ms"])
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            fh.flush()
        try:
            health = req("GET", "/api/system-health")
            data = health.get("data") or {}
            queue = data.get("queue_status") or {}
            model = data.get("model_latency") or {}
            workers = data.get("worker_status") or []
            dead_task_max = max(dead_task_max, int(queue.get("dead_tasks") or 0))
            stuck_running_task_max = max(stuck_running_task_max, int(queue.get("stuck_running_tasks") or 0))
            if any(worker.get("status") == "offline" for worker in workers):
                worker_offline_events += 1
            if int(model.get("model_errors_today") or 0) > 0:
                model_error_events += 1
            health_record = {"ts": time.time(), "case": "system_health_snapshot", "ok": True, "dead_task": dead_task_max, "stuck_running_task": stuck_running_task_max, "worker_offline_events": worker_offline_events, "model_error_events": model_error_events}
            fh.write(json.dumps(health_record, ensure_ascii=False) + "\n")
            fh.flush()
        except Exception as exc:
            failures += 1
            total += 1
            fh.write(json.dumps({"ts": time.time(), "case": "system_health_snapshot", "ok": False, "error": str(exc)}, ensure_ascii=False) + "\n")
        if os.environ.get("TELEGRAM_SOAK_PING") == "true":
            try:
                token = os.environ["TELEGRAM_BOT_TOKEN"]
                urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=30).read()
            except Exception:
                telegram_error_events += 1
        remaining = end - time.time()
        if remaining <= 0:
            break
        time.sleep(min(interval, remaining))

p95 = sorted(latencies)[int(len(latencies) * 0.95) - 1] if latencies else 0
avg = statistics.mean(latencies) if latencies else 0
summary = {"total": total, "success": success, "failures": failures, "success_rate": success / total if total else 0, "avg_latency_ms": avg, "p95_latency_ms": p95, "dead_task": dead_task_max, "stuck_running_task": stuck_running_task_max, "worker_offline": worker_offline_events, "model_error": model_error_events, "telegram_error": telegram_error_events, "nats_reconnect": nats_reconnect_events, "output": out}
print(json.dumps(summary, ensure_ascii=False, indent=2))
if summary["success_rate"] < 0.99 or summary["dead_task"] != 0 or summary["stuck_running_task"] != 0:
    sys.exit(1)
PY
