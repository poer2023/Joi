# 50 文件级开发拆解：伙伴前台 + 执行后台

## 1. 目标

本文件把 45-49 的 spec 落到具体代码路径。实现时按本文件顺序推进，避免先做 UI 空壳或继续扩设置页。

第一阶段完成定义：

```text
用户输入产品方向
→ 生成 pending memory / open loop / proactive draft
→ 用户输入严肃任务
→ 创建 product task
→ 展示 task card 和步骤
→ 生成 artifact
→ Run Trace 仍可追溯到底层 capability/tool/model
```

## 2. Step 1：Schema 与迁移

### 2.1 修改路径

```text
services/orchestrator-core/internal/appcore/sqlite_schema.sql
database/sqlite/002_product_task_memory_artifact.sql
database/migrations/009_product_task_memory_artifact.sql
services/orchestrator-core/internal/appcore/sqlite_schema.go
```

如果 `sqlite_schema.go` 是 embed 生成文件，按现有生成方式更新，不手写拼接。

### 2.2 新增表

```text
product_tasks
product_task_steps
product_task_deliverables
artifacts
open_loops
proactive_messages
```

### 2.3 不做

```text
不改现有 tasks / task_attempts 语义
不把 worker queue tasks 当成用户任务
不迁移历史 worker tasks
```

### 2.4 验收

临时 SQLite DB 初始化后：

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='product_tasks';
SELECT name FROM sqlite_master WHERE type='table' AND name='artifacts';
SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_messages';
```

## 3. Step 2：Store 与 DTO

### 3.1 建议新增文件

```text
services/orchestrator-core/internal/appcore/product_tasks.go
services/orchestrator-core/internal/appcore/artifacts.go
services/orchestrator-core/internal/appcore/reflection.go
services/orchestrator-core/internal/appcore/proactive.go
```

如果项目更倾向把 DTO 放在 `desktop_views.go`，可以先放在那里，但应避免继续无限膨胀单文件。

### 3.2 DTO

新增：

```text
ProductTask
ProductTaskStep
ProductTaskDetail
ProductTaskListResponse
ArtifactSummary
ArtifactDetail
OpenLoopRecord
ProactiveMessageRecord
ReflectionResult
```

### 3.3 方法

```text
ListProductTasks(ctx, filter)
GetProductTask(ctx, id)
CreateProductTask(ctx, request)
UpdateProductTaskStatus(ctx, id, status)
UpsertProductTaskStep(ctx, request)
CreateArtifact(ctx, request)
AttachArtifactToTask(ctx, productTaskID, artifactID)
ListOpenLoops(ctx, filter)
ListProactiveMessages(ctx, filter)
DecideProactiveMessage(ctx, id, action, feedback)
RunConversationReflection(ctx, request)
```

### 3.4 验收

Go tests 覆盖：

```text
create product task
append task steps
create artifact linked to task/run
create proactive draft
dismiss proactive draft
```

## 4. Step 3：SendChat 接入 Product Task

### 4.1 修改路径

```text
apps/joi-desktop/app.go
apps/joi-desktop/frontend/src/api/desktop.ts
services/orchestrator-core/internal/appcore/appcore.go
services/orchestrator-core/internal/store/chat.go
```

### 4.2 请求字段

```ts
input_mode?: 'auto' | 'chat_assist' | 'serious_task' | 'background_task';
product_task_id?: string;
```

### 4.3 返回字段

```ts
product_task?: ProductTask;
artifacts?: ArtifactSummary[];
proactive_candidates?: ProactiveMessageSummary[];
```

### 4.4 行为

```text
input_mode=serious_task → 创建 product_task
自动判断为 serious_task → 创建 product_task
已有 product_task_id → 当前 run 关联已有 task
普通 chat_assist → 不创建 product_task
background_task → 创建 open_loop 或 proactive draft
```

### 4.5 Trace

新增 run_steps：

```text
task_classified
product_task_created
product_task_step_started
product_task_step_completed
artifact_created
conversation_reflection
proactive_candidate_created
```

## 5. Step 4：Capability / Tool Run 关联步骤

### 5.1 修改路径

```text
services/orchestrator-core/internal/appcore/appcore.go
services/orchestrator-core/internal/store/capability.go
services/orchestrator-core/internal/appcore/workspace_capabilities.go
services/orchestrator-core/internal/store/task_queue.go
```

### 5.2 行为

当 capability request 发生时：

```text
读取 run.metadata.product_task_id
找到或创建对应 product_task_step
本地工具完成后写 tool_run_id
worker 派发后写 worker_task_id
失败时 step.status=failed
确认时 step.status=waiting_confirmation
```

### 5.3 不变

```text
Tool Compiler 仍然是唯一编译入口
Policy Engine 仍然决定 risk/confirmation
Worker privacy boundary 不放松
```

## 6. Step 5：Reflection v0

### 6.1 修改路径

```text
services/orchestrator-core/internal/appcore/reflection.go
services/orchestrator-core/internal/appcore/appcore.go
services/orchestrator-core/internal/store/memory*.go
docs/17_PROMPT_TEMPLATES.md
```

### 6.2 最小实现

v0 可以先用规则 + 当前模型 JSON 输出混合：

```text
规则识别明确 “记住/提醒/帮我/给我/整理/报告”
模型负责结构化候选
parser 严格校验 JSON
sanitizer 删除 secret/path 敏感内容
写入 pending memories / open_loops / proactive_messages
```

### 6.3 失败策略

```text
Reflection 失败不影响 SendChat 主回复
失败必须写 run_step error
不得因为 reflection 失败回滚 chat/run/model_call
```

## 7. Step 6：前端 API 与状态

### 7.1 修改路径

```text
apps/joi-desktop/frontend/src/api/desktop.ts
apps/joi-desktop/frontend/src/App.tsx
apps/joi-desktop/frontend/src/App.css
```

如组件继续变大，应拆：

```text
apps/joi-desktop/frontend/src/components/LeftRail.tsx
apps/joi-desktop/frontend/src/components/TaskCard.tsx
apps/joi-desktop/frontend/src/components/TaskExecutionPanel.tsx
apps/joi-desktop/frontend/src/components/CompanionInsightPanel.tsx
apps/joi-desktop/frontend/src/components/ArtifactViewer.tsx
apps/joi-desktop/frontend/src/components/ProactiveQueuePanel.tsx
```

### 7.2 状态

```text
productTasks
activeProductTaskID
activeProductTaskDetail
artifacts
openLoops
proactiveMessages
inputMode
artifactViewerID
```

### 7.3 验收

```text
普通聊天：右侧是 CompanionInsightPanel
严肃任务：中间有 TaskCard，右侧是 TaskExecutionPanel
Artifact：可打开，能看到 source run
Proactive：draft 可忽略、反馈、批准发送
```

## 8. Step 7：Eval 与回归

### 8.1 修改路径

```text
services/orchestrator-core/cmd/desktop-evals/main.go
evals/README.md
scripts/run_desktop_evals.sh
```

### 8.2 新增 eval case

```text
companion_direction_reflection
serious_task_creates_product_task
artifact_created_from_report_task
proactive_message_requires_review
memory_candidate_can_be_confirmed
tool_run_links_product_task_step
```

### 8.3 必跑命令

```text
cd services/orchestrator-core && go test ./...
cd services/worker-runtime && go test ./...
cd services/telegram-gateway && go test ./...
cd apps/joi-desktop/frontend && npm run build
./scripts/desktop_poc_check.sh
./scripts/run_desktop_evals.sh
```

## 9. Step 8：截图验收

每个阶段保留截图：

```text
chat_with_task_card.png
companion_insight_panel.png
task_execution_panel.png
artifact_viewer.png
proactive_queue.png
trace_with_product_task.png
```

截图只用于验收，不应成为代码依赖。
