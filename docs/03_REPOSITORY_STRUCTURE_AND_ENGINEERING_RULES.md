# 03 仓库结构与工程规范

## 1. 推荐结构

```text
agent-os/
  apps/
    console-web/
    telegram-gateway/
  services/
    orchestrator-core/
    agent-runtime/
    memory-service/
    worker-runtime/
    model-gateway/
  packages/
    shared-types/
    api-client/
  database/
    migrations/
    seeds/
  infra/
  configs/
  prompts/
  docs/
  tasks/
```

## 2. Go 服务建议结构

```text
services/orchestrator-core/
  cmd/orchestrator/main.go
  internal/api
  internal/store
  internal/runs
  internal/router
  internal/session
  internal/policy
  internal/agent
  internal/memory
  internal/capability
  internal/toolcompiler
  internal/nodes
  internal/config
```

## 3. Python 服务建议结构

```text
services/agent-runtime/
  app/main.py
  app/runtime
  app/providers
  app/prompts
  app/schemas
  app/output_parser

services/memory-service/
  app/main.py
  app/search
  app/extract
  app/context_pack
  app/embedding
  app/conflict
```

## 4. 命名规范

ID 前缀：

| 类型 | 前缀 |
|---|---|
| run | run_ |
| step | step_ |
| message | msg_ |
| memory | mem_ |
| node | node_ |
| task | task_ |
| tool_run | toolrun_ |

状态统一小写 snake_case：`pending`、`running`、`succeeded`、`failed`、`blocked`、`requires_confirmation`。

## 5. 日志规范

所有日志必须结构化：

```json
{
  "timestamp": "...",
  "service": "orchestrator-core",
  "level": "info",
  "run_id": "run_xxx",
  "step_id": "step_xxx",
  "message": "router selected agent",
  "metadata": {}
}
```

## 6. 迁移规范

所有表结构用 SQL migration，不允许代码隐式建表。

## 7. 错误码

```text
VALIDATION_ERROR
ROUTER_LOW_CONFIDENCE
AGENT_RUNTIME_ERROR
MODEL_PROVIDER_ERROR
POLICY_DENIED
REQUIRES_CONFIRMATION
CAPABILITY_NOT_FOUND
TOOL_COMPILE_FAILED
TOOL_EXECUTION_FAILED
NODE_UNAVAILABLE
MEMORY_SEARCH_FAILED
DATABASE_ERROR
TIMEOUT
```
