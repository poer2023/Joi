#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CASES="${1:-evals/agent_behavior_cases.json}"

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
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))

def validate(case):
    payload = req("POST", "/api/chat/send", {"channel": "agent_eval", "message": case["message"]})
    data = payload["data"]
    steps = req("GET", f"/api/runs/{data['run_id']}/steps")["data"]["steps"]
    text = json.dumps(steps, ensure_ascii=False)
    if data.get("selected_agent_id") != case.get("expect_agent"):
        return False, f"agent {data.get('selected_agent_id')}"
    if case.get("expect_tool") is True and "tool_finished" not in text:
        return False, "missing tool"
    if case.get("expect_tool") is False and "tool_finished" in text:
        return False, "unexpected tool"
    if case.get("expect_capability") and case["expect_capability"] not in text:
        return False, "missing capability"
    if case.get("forbid_capability") and case["forbid_capability"] in text:
        return False, "forbidden capability used"
    if case.get("expect_memory_proposal") and "memory_proposed" not in text:
        return False, "missing memory proposal"
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
