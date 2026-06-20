# 46 数据模型与 API 规格：Task / Memory / Artifact

## 1. 设计约束

当前仓库已经存在 `tasks` 和 `task_attempts`，它们是 Worker Queue 表：

```text
tasks.run_id
tasks.capability_id
tasks.workflow_id
tasks.assigned_node_id
tasks.payload/result/error
task_attempts
```

这些表服务 Node Scheduler、Worker Gateway 和底层 capability 派发，不能直接改造成用户可理解的产品任务。

本轮新增产品任务层，物理表使用 `product_*` 前缀：

```text
product_tasks
product_task_steps
product_task_deliverables
artifacts
open_loops
proactive_messages
```

UI 和文案仍叫“任务 / Task”。

## 2. SQLite/Postgres 双栈要求

所有新表必须同时落地：

```text
services/orchestrator-core/internal/appcore/sqlite_schema.sql
database/sqlite/00x_product_task_memory_artifact.sql
database/migrations/00x_product_task_memory_artifact.sql
```

SQLite 使用 `TEXT` 存 JSON；Postgres 使用 `JSONB`。

新增 schema 必须能在 Desktop Mode 下独立运行，不依赖 Docker、Postgres、NATS。

## 3. Product Task

### 3.1 表：product_tasks

```sql
CREATE TABLE product_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning',
  mode TEXT NOT NULL DEFAULT 'serious_task',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_from_conversation_id TEXT REFERENCES conversations(id),
  created_from_message_id TEXT REFERENCES messages(id),
  latest_run_id TEXT REFERENCES runs(id),
  owner_user_id TEXT NOT NULL DEFAULT 'default_user',
  source_channel TEXT NOT NULL DEFAULT 'desktop',
  risk_level TEXT NOT NULL DEFAULT 'read_only',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  current_step_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
```

Postgres 版本将 `metadata TEXT` 改为 `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`，时间字段为 `TIMESTAMPTZ`。

### 3.2 status 枚举

```text
planning
running
waiting_confirmation
completed
failed
cancelled
blocked
```

### 3.3 mode 枚举

```text
chat_assist
serious_task
background_task
```

### 3.4 priority 枚举

```text
low
normal
high
urgent
```

### 3.5 与现有 run 的关系

```text
product_task 1 - n runs
run 1 - n run_steps
run 1 - n tool_runs
run 1 - n model_calls
```

为了避免改动 `runs` 表，v0 在 `runs.metadata.product_task_id` 中写入关联，同时 `product_tasks.latest_run_id` 指向最新 run。

v1 可考虑给 `runs` 增加 `product_task_id` 显式列。

## 4. Product Task Step

### 4.1 表：product_task_steps

```sql
CREATE TABLE product_task_steps (
  id TEXT PRIMARY KEY,
  product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  sort_order INTEGER NOT NULL DEFAULT 0,
  capability_id TEXT,
  tool_workflow_id TEXT,
  run_id TEXT REFERENCES runs(id),
  tool_run_id TEXT REFERENCES tool_runs(id),
  worker_task_id TEXT REFERENCES tasks(id),
  summary TEXT NOT NULL DEFAULT '',
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.2 status 枚举

```text
pending
running
done
failed
skipped
waiting_confirmation
blocked
```

### 4.3 写入规则

- 计划生成后写入 pending steps。
- 当前 run 进入某个能力调用时，将对应 step 改为 running。
- 本地 tool_run 完成后写入 `tool_run_id`、`output`、`summary`。
- Worker 派发时写入 `worker_task_id`，等待 ack/fail 后更新。
- 高风险确认时 step 进入 `waiting_confirmation`。

## 5. Artifact

### 5.1 表：artifacts

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'markdown',
  source_product_task_id TEXT REFERENCES product_tasks(id),
  source_run_id TEXT REFERENCES runs(id),
  source_conversation_id TEXT REFERENCES conversations(id),
  source_message_id TEXT REFERENCES messages(id),
  linked_memory_ids TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 5.2 type 枚举

```text
report
plan
summary
diff
decision
memory_digest
research_note
code_patch
```

MVP UI 只开放：

```text
report
plan
summary
diff
```

### 5.3 表：product_task_deliverables

```sql
CREATE TABLE product_task_deliverables (
  id TEXT PRIMARY KEY,
  product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 6. Memory Candidate

### 6.1 v0 存储策略

优先复用现有 `memories` 表作为候选收件箱：

```text
memories.status = 'pending'
memories.metadata.candidate_source = 'conversation_reflection'
memories.metadata.candidate_reason = ...
memories.metadata.conversation_type = ...
memories.source_event_ids = [conversation_id, message_id, run_id]
```

这样可以直接复用现有 Memory Inbox、confirm、disable、feedback、conflict 等能力。

### 6.2 可选审计表：memory_candidates

如果后续需要保留 LLM 原始候选和治理结果，可新增：

```sql
CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id),
  source_conversation_id TEXT REFERENCES conversations(id),
  source_run_id TEXT REFERENCES runs(id),
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  lifetime TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT '',
  raw_output TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
```

v0 可以不建此表，但 Reflection 代码必须把原始候选写进 `memories.metadata.raw_candidate`。

## 7. Open Loop

```sql
CREATE TABLE open_loops (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  source_conversation_id TEXT REFERENCES conversations(id),
  source_run_id TEXT REFERENCES runs(id),
  source_product_task_id TEXT REFERENCES product_tasks(id),
  suggested_followup TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
```

status：

```text
open
snoozed
closed
converted_to_task
suppressed
```

## 8. Proactive Message

```sql
CREATE TABLE proactive_messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  source_open_loop_id TEXT REFERENCES open_loops(id),
  source_product_task_id TEXT REFERENCES product_tasks(id),
  score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  channel TEXT NOT NULL DEFAULT 'desktop',
  send_after TEXT,
  expires_at TEXT,
  feedback TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
```

type：

```text
companion
task
memory
system
```

status：

```text
draft
queued
sent
dismissed
suppressed
expired
failed
```

## 9. Electron IPC / App API

所有响应仍遵守：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "trace_id": "run_xxx"
}
```

Electron IPC 通过受控 preload 暴露 DTO；内部错误仍要映射为同样的错误结构。

### 9.1 Product Task API

```text
ListProductTasks(filter) -> ProductTaskListResponse
GetProductTask(id) -> ProductTaskDetail
CreateProductTask(request) -> ProductTask
UpdateProductTaskStatus(id, status) -> ProductTask
AttachRunToProductTask(product_task_id, run_id) -> ProductTask
ListProductTaskSteps(product_task_id) -> ProductTaskStepListResponse
```

DTO：

```ts
type ProductTask = {
  id: string;
  title: string;
  description: string;
  status: string;
  mode: string;
  priority: string;
  risk_level: string;
  progress_percent: number;
  current_step_id?: string;
  latest_run_id?: string;
  summary?: string;
  created_from_conversation_id?: string;
  created_from_message_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};
```

### 9.2 Artifact API

```text
ListArtifacts(filter) -> ArtifactListResponse
GetArtifact(id) -> ArtifactDetail
CreateArtifact(request) -> Artifact
UpdateArtifact(id, patch) -> Artifact
CreateArtifactVersion(id, content) -> Artifact
AttachArtifactToTask(product_task_id, artifact_id) -> ProductTaskDeliverable
```

### 9.3 Reflection API

```text
RunConversationReflection(conversation_id, run_id?) -> ReflectionResult
ListOpenLoops(filter) -> OpenLoopListResponse
ListProactiveMessages(filter) -> ProactiveMessageListResponse
DecideProactiveMessage(id, action, feedback?) -> ProactiveMessage
```

### 9.4 SendChat 扩展

当前 `SendChat` 请求增加可选字段：

```ts
type ChatRequest = {
  conversation_id?: string;
  channel?: string;
  user_id?: string;
  message: string;
  preferred_node?: string;
  allow_worker?: boolean;
  input_mode?: 'auto' | 'chat_assist' | 'serious_task' | 'background_task';
  product_task_id?: string;
};
```

返回增加：

```ts
type ChatResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  product_task?: ProductTask;
  artifacts?: ArtifactSummary[];
  proactive_candidates?: ProactiveMessageSummary[];
  model_calls?: ModelCall[];
};
```

## 10. 索引

SQLite：

```sql
CREATE INDEX idx_product_tasks_status ON product_tasks(status, updated_at DESC);
CREATE INDEX idx_product_tasks_conversation ON product_tasks(created_from_conversation_id, updated_at DESC);
CREATE INDEX idx_product_task_steps_task ON product_task_steps(product_task_id, sort_order);
CREATE INDEX idx_artifacts_task ON artifacts(source_product_task_id, updated_at DESC);
CREATE INDEX idx_open_loops_status ON open_loops(status, updated_at DESC);
CREATE INDEX idx_proactive_status ON proactive_messages(status, score DESC, created_at DESC);
```

Postgres 同步创建等价索引。

## 11. 迁移验收

必须通过：

```text
services/orchestrator-core: go test ./...
services/worker-runtime: go test ./...
services/telegram-gateway: go test ./...
pnpm test:store
pnpm eval:desktop:ts
pnpm build:electron
```

并新增最少 1 个 SQLite migration check：

```text
product_tasks / artifacts / proactive_messages 在临时 DB 中创建成功
SendChat serious_task 能写入 product_tasks
Artifact 能关联 run 和 product_task
```
