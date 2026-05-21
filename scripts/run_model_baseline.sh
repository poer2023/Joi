#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CASES="${1:-evals/model_baseline_cases.json}"

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

python3 - "$API" "$CASES" <<'PY'
import json
import os
import sys
import urllib.request

api = sys.argv[1].rstrip("/")
cases = json.load(open(sys.argv[2], encoding="utf-8"))

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

def validate(case):
    payload = req("POST", "/api/chat/send", {"channel": "model_baseline", "message": case["message"], "options": {"allow_tools": True, "preferred_node": "main-node", "allow_worker": False}})
    if not payload.get("ok"):
        return False, "chat failed"
    data = payload["data"]
    run = req("GET", f"/api/runs/{data['run_id']}")["data"]
    steps = req("GET", f"/api/runs/{data['run_id']}/steps")["data"]["steps"]
    calls = run.get("model_calls") or []
    if not calls:
        return False, "missing model call"
    for call in calls:
        meta = call.get("metadata") or {}
        if call.get("provider") == "mock_provider" or meta.get("fallback_to_mock") is True or meta.get("real_model") is not True:
            return False, "mock or fallback model call detected"
        if call.get("input_tokens", 0) <= 0 or call.get("output_tokens", 0) <= 0:
            return False, "missing token usage"
        if call.get("latency_ms", 0) <= 0:
            return False, "missing latency"
    text = json.dumps({"run": run, "steps": steps}, ensure_ascii=False)
    if case.get("expect_agent") and data.get("selected_agent_id") != case["expect_agent"]:
        return False, f"agent {data.get('selected_agent_id')}"
    if case.get("expect_capability") and case["expect_capability"] not in text:
        return False, "missing capability"
    if case.get("expect_tool") is False and "tool_finished" in text:
        return False, "unexpected tool"
    if case.get("expect_memory") and not run.get("memory_context_packs"):
        return False, "missing memory context pack"
    parsed_steps = [s for s in steps if s.get("step_type") == "agent_output_parsed"]
    if not parsed_steps:
        return False, "missing JSON parse step"
    return True, data["run_id"]

passed = 0
failed = []
for case in cases:
    ok, detail = validate(case)
    if ok:
        passed += 1
        print(f"PASS {case['id']} {detail}")
    else:
        failed.append((case["id"], detail))
        print(f"FAIL {case['id']} {detail}")
print(f"{passed} passed / {len(failed)} failed")
if failed:
    sys.exit(1)
PY
