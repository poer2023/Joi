#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
COUNT="${MODEL_BASELINE_CALLS:-50}"
OUT="${MODEL_BASELINE_DOC:-docs/24_MODEL_COST_LATENCY_BASELINE.md}"

if [[ "${REQUIRE_REAL_MODEL:-true}" == "true" ]]; then
  : "${MODEL_PROVIDER:?MODEL_PROVIDER is required}"
  : "${MODEL_BASE_URL:?MODEL_BASE_URL is required}"
  if [[ -z "${MODEL_API_KEY:-}" && -z "${DEEPSEEK_API_KEY:-}" ]]; then
    echo "MODEL_API_KEY or DEEPSEEK_API_KEY is required" >&2
    exit 1
  fi
  export MODEL_API_KEY="${MODEL_API_KEY:-$DEEPSEEK_API_KEY}"
  : "${MODEL_NAME:?MODEL_NAME is required}"
  export ALLOW_MOCK_PROVIDER=false
fi

python3 - "$API" "$COUNT" "$OUT" <<'PY'
import json, os, statistics, sys, time, urllib.request
api, count, out = sys.argv[1].rstrip("/"), int(sys.argv[2]), sys.argv[3]
messages = [
    "用一句话回答：Joi 当前状态正常吗？",
    "我之前偏好什么部署方式？",
    "@research 请读取 https://example.com 并总结来源。",
    "Joi 自检",
]

def req(method, path, body=None):
    data = None
    headers = {}
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    if admin_token:
        headers["X-Admin-Token"] = admin_token
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(api + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))

run_ids = []
for i in range(count):
    payload = req("POST", "/api/chat/send", {"channel": "cost_baseline", "message": messages[i % len(messages)], "options": {"allow_tools": True, "preferred_node": "main-node", "allow_worker": False}})
    run_ids.append(payload["data"]["run_id"])
summary = req("GET", "/api/model-usage-summary")["data"]["items"]
recent = req("GET", "/api/model-calls")["data"]["model_calls"][: max(count, 50)]
latencies = [c.get("latency_ms", 0) for c in recent if c.get("latency_ms", 0) > 0]
p95 = sorted(latencies)[int(len(latencies) * 0.95) - 1] if latencies else 0
avg = statistics.mean(latencies) if latencies else 0
fallback = sum(1 for c in recent if (c.get("metadata") or {}).get("fallback_to_mock") is True or c.get("provider") == "mock_provider")
errors = sum(1 for c in recent if c.get("status") not in ("succeeded", "fallback_to_mock"))
total_cost = sum(item.get("estimated_cost", 0) for item in summary)

doc = f"""# Model Cost and Latency Baseline

Generated at: {time.strftime('%Y-%m-%d %H:%M:%S')}

## Sample

- Requested calls: {count}
- Run IDs: {', '.join(run_ids[:10])}{' ...' if len(run_ids) > 10 else ''}

## Metrics

- Average latency: {avg:.0f} ms
- p95 latency: {p95} ms
- Fallback calls in recent window: {fallback}
- Error calls in recent window: {errors}
- Estimated total cost in summary window: ${total_cost:.6f}

## Provider / Model / Agent

```json
{json.dumps(summary, ensure_ascii=False, indent=2)}
```

## Conclusions

- cheap_model: evaluate if general_agent dominates cost after real traffic.
- memory_context_pack: shorten if memory_agent input tokens dominate.
- prompt prefix: tune if cache hit ratio remains low after stable prefixes.
"""
open(out, "w", encoding="utf-8").write(doc)
print(out)
PY
