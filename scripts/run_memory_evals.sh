#!/usr/bin/env bash
set -euo pipefail

API="${ORCHESTRATOR_URL:-http://localhost:8080}"
CASES="${1:-evals/memory_retrieval_cases.json}"

python3 - "$API" "$CASES" <<'PY'
import json
import os
import sys
import urllib.request

api = sys.argv[1].rstrip("/")
cases_path = sys.argv[2]
doc = json.load(open(cases_path, encoding="utf-8"))

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

def seed(case):
    body = {"content": case["seed"], "source_event_ids": ["memory_eval_" + case["id"]]}
    if case.get("low_confidence"):
        body["metadata"] = {"confidence_hint": "low"}
    resp = req("POST", "/api/memories/propose", body)
    memory = resp.get("data") or resp
    return memory.get("id") or memory.get("memory_id")

def search(query):
    resp = req("POST", "/api/memories/search", {"query": query, "limit": 5})
    data = resp.get("data") or resp
    return data.get("results") or data.get("memories") or []

ids = {}
for case in doc["cases"]:
    mid = seed(case)
    ids[case["id"]] = mid
    if mid and case.get("pin"):
        try:
            req("PATCH", f"/api/memories/{mid}", {"pinned": True})
        except Exception:
            pass
    if mid and case.get("disable"):
        try:
            req("PATCH", f"/api/memories/{mid}", {"disabled": True})
        except Exception:
            pass

hits = 0
precision_hits = 0
disabled_leak_count = 0
pinned_cases = 0
pinned_hits = 0
for case in doc["cases"]:
    results = search(case["query"])
    joined = "\n".join(json.dumps(r, ensure_ascii=False) for r in results)
    if case.get("must_not_contain"):
        if case["must_not_contain"] in joined:
            disabled_leak_count += 1
        else:
            hits += 1
            precision_hits += 1
    else:
        ok = case.get("must_contain", "") in joined
        if ok:
            hits += 1
            precision_hits += 1
    if case.get("pin"):
        pinned_cases += 1
        if results and case.get("must_contain", "") in json.dumps(results[0], ensure_ascii=False):
            pinned_hits += 1

total = len(doc["cases"])
recall = hits / total if total else 0
precision = precision_hits / total if total else 0
pinned_rate = pinned_hits / pinned_cases if pinned_cases else 1
print(f"recall@5={recall:.2f}")
print(f"precision@5={precision:.2f}")
print(f"pinned_hit_rate={pinned_rate:.2f}")
print(f"disabled_leak_count={disabled_leak_count}")
if recall < doc["targets"]["recall_at_5"] or disabled_leak_count != doc["targets"]["disabled_leak_count"]:
    sys.exit(1)
PY
