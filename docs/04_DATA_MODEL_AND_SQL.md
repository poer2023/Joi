# 04 数据模型与 SQL 设计

## 1. 核心表

| 表 | 说明 |
|---|---|
| models | 模型配置 |
| agents | Agent Card |
| capabilities | 平台能力 |
| tools | 底层工具 |
| tool_workflows | capability 编译后的 workflow |
| conversations | 会话 |
| messages | 消息 |
| runs | 一次用户请求 |
| run_steps | Run Trace 步骤 |
| model_calls | 模型调用记录 |
| nodes | 节点 |
| tasks | 派发任务 |
| task_attempts | 任务尝试 |
| tool_runs | 工具执行记录 |
| memories | 长期记忆 |
| memory_embeddings | 向量 |
| memory_usage_logs | 记忆使用记录 |
| memory_feedback | 记忆反馈 |
| confirmations | 用户确认 |

## 2. 关系

```text
conversation 1 - n messages
message 1 - 1 run
run 1 - n run_steps
run 1 - n tool_runs
run 1 - n model_calls
run 1 - n memory_usage_logs
memory 1 - n memory_usage_logs
node 1 - n tasks
task 1 - n task_attempts
```

## 3. 枚举

### run.status

```text
pending
running
succeeded
failed
cancelled
blocked
requires_confirmation
```

### memory.type

```text
user_preference
project_fact
environment_fact
episode
outcome
heuristic
anti_pattern
entity
relationship
unresolved_issue
decision
```

### memory.status

```text
pending
confirmed
conflicted
disabled
archived
deleted
```

## 4. SQL

完整 SQL 在：

```text
database/001_init_schema.sql
```

## 5. 索引要求

- runs.created_at
- runs.status
- run_steps.run_id
- memories.type
- memories.status
- memories.scope_type + scope_id
- memories.entities GIN
- nodes.capabilities GIN
- tasks.status
