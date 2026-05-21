#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
NODE_ID="${NODE_ID:-vps-la-1}"
ADMIN_HEADER=()
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  ADMIN_HEADER=(-H "X-Admin-Token: ${ADMIN_TOKEN}")
fi

curl -fsS "${ADMIN_HEADER[@]}" "$API/api/nodes" | grep -q "\"id\":\"$NODE_ID\"" || { echo "$NODE_ID not registered" >&2; exit 1; }
curl -fsS "${ADMIN_HEADER[@]}" "$API/api/nodes" | grep -q "\"status\":\"healthy\"" || { echo "no healthy node found" >&2; exit 1; }

RUN_ID="$(curl -fsS -X POST "$API/api/chat/send" \
  -H 'Content-Type: application/json' \
  -d "{\"channel\":\"vps_worker_check\",\"message\":\"@research 请读取 https://example.com 并总结来源\",\"options\":{\"preferred_node\":\"$NODE_ID\",\"allow_worker\":true,\"allow_tools\":true}}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["run_id"])')"

deadline=$((SECONDS + ${WORKER_WAIT_SECONDS:-20}))
while true; do
  TRACE="$(curl -fsS "${ADMIN_HEADER[@]}" "$API/api/runs/$RUN_ID")"
  task_status="$(TRACE="$TRACE" NODE_ID="$NODE_ID" python3 - <<'PY'
import json
import os

trace = json.loads(os.environ["TRACE"])["data"]
node_id = os.environ["NODE_ID"]
for task in trace.get("tasks", []):
    if task.get("assigned_node_id") == node_id:
        print(task.get("status", ""))
        break
else:
    print("")
PY
)"
  if [[ "$task_status" == "succeeded" ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "run $RUN_ID task on $NODE_ID did not succeed before timeout (status=${task_status:-missing})" >&2
    exit 1
  fi
  sleep 1
done

STEPS="$(curl -fsS "${ADMIN_HEADER[@]}" "$API/api/runs/$RUN_ID/steps")"
TRACE="$TRACE" STEPS="$STEPS" NODE_ID="$NODE_ID" python3 - <<'PY'
import json
import os
import sys

trace = json.loads(os.environ["TRACE"])["data"]
steps = json.loads(os.environ["STEPS"])["data"].get("steps", [])
node_id = os.environ["NODE_ID"]

tasks = [task for task in trace.get("tasks", []) if task.get("assigned_node_id") == node_id]
if not tasks:
    sys.exit(f"run {trace.get('id')} was not assigned to {node_id}")

task = tasks[0]
if task.get("status") != "succeeded":
    sys.exit(f"run {trace.get('id')} task on {node_id} status is {task.get('status')}")

attempts = task.get("attempts", [])
if not any(attempt.get("node_id") == node_id and attempt.get("status") == "succeeded" for attempt in attempts):
    sys.exit(f"run {trace.get('id')} has no succeeded attempt on {node_id}")

assigned_by_trace = any(
    (step.get("output") or {}).get("node_id") == node_id
    and (step.get("output") or {}).get("assignment_reason") == "user_selected"
    for step in steps
)
if not assigned_by_trace:
    sys.exit(f"run {trace.get('id')} missing assignment_reason=user_selected for {node_id}")
PY
echo "vps worker check passed: $RUN_ID"
