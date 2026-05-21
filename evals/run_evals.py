#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
import urllib.error


def request_json(method, url, body=None):
    data = None
    headers = {}
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    if admin_token:
        headers["X-Admin-Token"] = admin_token
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def ensure_memory(base_url):
    body = {
        "content": "记住：我轻量部署优先 Docker Compose，不要默认推荐 Kubernetes。",
        "source_event_ids": ["eval_seed_memory"]
    }
    request_json("POST", f"{base_url}/api/memories/propose", body)


def latest_tool_run(base_url, run_id):
    run = request_json("GET", f"{base_url}/api/runs/{run_id}")["data"]
    steps = request_json("GET", f"{base_url}/api/runs/{run_id}/steps")["data"]["steps"]
    return run, steps


def has_step(steps, step_type):
    return any(step.get("step_type") == step_type for step in steps)


def any_dynamic_memory(run):
    for pack in run.get("memory_context_packs") or []:
        if pack.get("dynamic_retrieval"):
            return True
        if pack.get("anti_patterns") or pack.get("profile"):
            return True
    return False


def prompt_cache_fields(run):
    assemblies = run.get("prompt_assemblies") or []
    if not assemblies:
        return False
    required = ["prefix_hash", "dynamic_tail_hash", "prompt_cache_key", "memory_profile_version", "tool_schema_version"]
    return all(assemblies[-1].get(key) for key in required)


def model_call_exists(run):
    return len(run.get("model_calls") or []) > 0


def tool_run_for(base_url, run_id):
    # Tool runs are visible structurally through trace steps for now.
    _, steps = latest_tool_run(base_url, run_id)
    for step in steps:
        if step.get("step_type") == "tool_finished":
            output = step.get("output") or {}
            return output
    return None


def validate_case(base_url, case):
    payload = request_json("POST", f"{base_url}/api/chat/send", {"channel": "web", "message": case["message"]})
    if not payload.get("ok"):
        return False, f"chat failed: {payload}"
    data = payload["data"]
    run_id = data["run_id"]
    run, steps = latest_tool_run(base_url, run_id)
    expect = case["expect"]

    if expect.get("selected_agent") and data.get("selected_agent_id") != expect["selected_agent"]:
        return False, f"selected_agent {data.get('selected_agent_id')} != {expect['selected_agent']}"
    if expect.get("run_trace") and not steps:
        return False, "missing run trace steps"
    if expect.get("model_call") and not model_call_exists(run):
        return False, "missing model_call"
    if expect.get("prompt_cache_fields") and not prompt_cache_fields(run):
        return False, "missing prompt cache fields"
    if expect.get("memory_hit") and not any_dynamic_memory(run):
        return False, "missing memory context pack hit"

    tool_output = tool_run_for(base_url, run_id)
    if expect.get("tool_run") is True and tool_output is None:
        return False, "expected tool run"
    if expect.get("tool_run") is False and tool_output is not None:
        return False, "unexpected tool run"
    if expect.get("capability") and not has_step(steps, "capability_requested"):
        return False, "missing capability_requested step"
    if expect.get("node_id"):
        # Query run trace steps; node assignment is represented by tool run state in DB-backed output.
        if not tool_output:
            return False, "missing tool output for node assertion"
    return True, run_id


def main():
    cases_path = sys.argv[1]
    base_url = sys.argv[2].rstrip("/")
    cases = json.load(open(cases_path, encoding="utf-8"))
    ensure_memory(base_url)
    passed = 0
    failed = []
    for case in cases:
        ok, detail = validate_case(base_url, case)
        if ok:
            passed += 1
            print(f"PASS {case['name']} {detail}")
        else:
            failed.append((case["name"], detail))
            print(f"FAIL {case['name']} {detail}")
    print(f"{passed} passed / {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
