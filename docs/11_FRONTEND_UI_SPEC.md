# 11 前端 UI 规格：Agent OS Console

## 1. 页面结构

```text
Console
  ├─ Chat Workbench
  ├─ Runs / Trace
  ├─ Memory Studio
  ├─ Agents
  ├─ Nodes
  ├─ Capabilities
  ├─ Models
  ├─ Tasks
  └─ Settings
```

## 2. Chat Workbench

布局：

```text
Conversation List | Chat Panel | Context Inspector
```

### 左侧

- 会话列表
- active_agent
- 最近消息
- 更新时间

### 中间

- 用户消息
- Agent 回复
- 工具执行状态
- 确认卡片
- 错误提示

### 右侧 Context Inspector

展示当前 run：

- selected_agent
- selected_model
- route_reason
- retrieved_memories
- capability_requests
- tool_workflow
- selected_node
- cost / latency

## 3. Run Trace

列表字段：

- run_id
- created_at
- selected_agent
- selected_model
- status
- duration
- tool_count
- node
- error_code

详情模块：

1. User Input
2. Session
3. Router
4. Memory
5. Agent
6. Capability
7. Policy
8. Tool Workflow
9. Node
10. Tool Runs
11. Final Response
12. Errors

## 4. Memory Studio

字段：

- content
- type
- scope
- confidence
- status
- usage_count
- success_count
- last_used_at
- source
- updated_at

操作：

- edit
- confirm
- disable
- archive
- delete
- merge
- pin
- view source
- view usage
- resolve conflict

## 5. Agent Registry

字段：

- name
- id
- enabled
- default_model
- fallback_model
- capabilities
- memory_scopes
- recent_runs
- error_rate

操作：

- create
- edit
- enable / disable
- duplicate
- test route

## 6. Node Console

字段：

- node_id
- name
- role
- status
- capabilities
- cpu
- memory
- running_tasks
- last_heartbeat
- auto_assignable
- manual_assignable

操作：

- enable / disable
- allow auto assign
- disallow auto assign
- test connection
- view logs
- drain node

## 7. Capability Console

展示：

- capability
- request schema
- workflow templates
- risk policy
- allowed agents
- allowed nodes
- recent tool_runs

## 8. Model Routing Console

展示：

- providers
- models
- agent mapping
- fallback
- cost
- latency
- error rate

## 9. UI 状态

每个页面必须处理：

- loading
- empty
- error
- permission denied
- stale node
- degraded service
