# 06 Capability 与 Tool Protocol

## 1. 核心原则

模型不能直接调用底层工具。模型只能提出 Capability Request。

```text
Agent → capability_request → validation → policy → tool compiler → workflow → node scheduler → tool runtime
```

## 2. Capability 与 Tool

Capability 是高层能力，给 Agent 看。

Tool 是底层工具，只给系统用。

| Capability | 底层 Tool 示例 |
|---|---|
| server_diagnose | docker_list_containers, docker_read_logs, check_ports |
| web_research | search_web, fetch_url, extract_content |
| memory_search | vector_search, fulltext_search, context_pack |
| file_analyze | read_file_safe, parse_file, summarize |
| node_dispatch | create_task, publish_nats |

## 3. Capability Request

```json
{
  "type": "capability_request",
  "capability": "server_diagnose",
  "goal": "检查 cloudflared 服务是否正常",
  "inputs": {
    "service_name": "cloudflared"
  },
  "constraints": {
    "preferred_node": "auto",
    "max_runtime_seconds": 120
  },
  "risk": "read_only",
  "confidence": 0.88
}
```

## 4. Tool Workflow

```json
{
  "workflow_name": "server_diagnose_v1",
  "capability": "server_diagnose",
  "risk_level": "read_only",
  "steps": [
    {
      "tool": "docker_list_containers",
      "args": { "filter_name": "cloudflared" },
      "risk_level": "read_only"
    },
    {
      "tool": "docker_read_logs",
      "args": { "container_name": "cloudflared", "tail": 200 },
      "risk_level": "read_only"
    }
  ]
}
```

## 5. 风险等级

| 等级 | 名称 | 默认 |
|---|---|---|
| L0 | read_only | 自动执行 |
| L1 | write_candidate | pending 或轻确认 |
| L2 | state_change | 必须确认 |
| L3 | destructive | 默认禁止 |
| L4 | unsafe | 拒绝 |

## 6. 禁止暴露给模型的底层工具

```text
shell_exec
ssh_exec
sql_query
file_write_raw
file_delete
docker_rm
docker_restart
browser_click_raw
send_email_raw
```

## 7. Tool Compiler 规则

Tool Compiler 必须是确定性代码，不调用 LLM。

示例：

```text
server_diagnose(service_name)
  → docker_list_containers
  → docker_inspect_container
  → docker_read_logs
  → check_ports
  → check_resource_usage
```

## 8. Tool Result Normalization

工具结果要标准化：

```json
{
  "service": "cloudflared",
  "container_found": true,
  "running": true,
  "restart_count": 0,
  "recent_errors": [],
  "important_logs": [],
  "raw_log_ref": "object://toolrun_xxx.log"
}
```
