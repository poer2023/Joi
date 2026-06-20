# Joi 对话流式会话与执行过程展示改造 Spec

> 版本：v1.0 Draft
> 日期：2026-06-17
> 适用范围：Joi Desktop 会话页、Run 事件协议、执行过程展示、Trace 回放、Auto/Chat/Task/Bg 模式接线
> 主要目标：把 Joi 的对话体验从“事件日志直接糊脸”改造成“聊天优先、执行可见、Trace 可回放、状态语义清晰”的产品级会话系统。

---

## 1. 背景

当前 Joi Desktop 已具备基础会话、Run、run_events、run_steps、tool_runs、artifact、memory、confirmation_request 等核心对象。数据结构并不算混乱，尤其是 `messages` 表当前只包含 `user` 与 `assistant` 两类角色，没有把工具调用、状态、Trace 作为 message role 塞进主消息流。

真正的问题集中在三处：

1. **事件语义边界不清**
   当前 `run.completed` 在 assistant message 写库后立即发出，但它并不代表后台 worker、reflection、task、artifact 或 UI 流式展示全部完成。

2. **前端缺少稳定的 Conversation Render Model**
   React 组件直接消费 run events、execution actions、trace、streamingAssistantMessage 等混合状态，导致 UI 需要猜测哪些事件该展示给用户，哪些只该进入 Trace。

3. **对话展示层与执行层混在一起**
   主聊天流本应只展示用户可理解的自然语言与轻量执行状态，但当前会把 reflection、worker、Run completed 等内部执行状态以过重的卡片插入聊天流，造成用户感知错乱。

本 Spec 的核心改造思路：

```text
Raw Run Events
      ↓
Event Normalizer
      ↓
Run Aggregator / Conversation Projector
      ↓
Conversation Render Items
      ↓
MessageList / InlineStatus / CompactRunCard / TaskEntry / TracePanel
```

React 组件不再直接理解后端事件细节。组件只消费前端投影后的渲染模型。

---

## 2. 当前事实与约束

### 2.1 当前真实数据对象

后端当前已存在以下对象：

```text
conversation
message
run
run_step
run_event
tool_run
artifact
memory
confirmation_request
product_task
product_task_step
```

reflection 没有独立表，当前主要表现为：

```text
run_steps.step_type = 'conversation_reflection'
run_events.item_type = 'reflection'
```

### 2.2 当前消息与 Run 关系

当前事实：

```text
一个 user message 当前实际对应一个 run
一个 assistant message 当前实际对应一个 run
assistant message 通过 messages.metadata.run_id 关联 run
工具调用结果不是 message，而是 run_steps / run_events / tool_runs
```

当前 `messages.role` 只有：

```text
user
assistant
```

因此，本次改造不需要把 tool/status/trace 从 message 表迁出。它们本来就不在 message 表里。问题在事件语义和前端投影。

### 2.3 当前流式协议

桌面端当前流式方式：

```text
Electron preload event: joi:run:event
SQLite: run_events 持久化用于回放
Frontend: window.joi.onRunEvent 实时接收
```

当前不是 SSE，也不是 WebSocket，也不是 HTTP streaming。

当前 `assistant.delta` 是后端把最终 response 按固定字符切块模拟出来：

```text
stream_source = fallback_final_chunk
```

不是模型 provider 的真实 token stream。

### 2.4 当前关键问题样例

当前可能出现如下事件顺序：

```text
run.started
assistant.delta
assistant.delta
run.completed
worker.running
worker.completed
```

这说明当前 `run.completed` 实际表示“前台 assistant message 写库完成”，并不表示“整个任务完成”。如果前端把它渲染成“Joi 已完成本轮处理”，但 worker 后续还在跑，UI 状态会自相矛盾。

---

## 3. 改造目标

### 3.1 产品目标

Joi 对话页应形成以下体验：

```text
普通聊天：
用户看到自然语言对话，默认不展示 Run Trace。

工具调用：
用户看到轻量、可理解的执行状态，例如“已读取网页 · 查看”。

多步骤任务：
用户看到折叠的执行卡，能展开看步骤。

后台任务：
用户在主聊天只看到任务入口，详细过程进入任务面板。

调试追踪：
开发者或高级用户可以在 Trace 面板看到完整事件。
```

### 3.2 技术目标

1. 明确事件协议边界。
2. 新增前端 Conversation Render Model。
3. 把主聊天流、执行过程、Trace 三层解耦。
4. Auto / Chat / Task / Bg 模式真正接线。
5. reflection、policy、workflow、raw JSON 默认不进入主聊天流。
6. 支持从 `run_events` 回放得到同样的 UI 投影。
7. 为未来真实 token streaming 留出接口。

### 3.3 非目标

本阶段不做：

1. 全量重写前端架构。
2. 更换 Electron preload 事件为 SSE/WebSocket。
3. 完整重构后端 Run/Task 数据模型。
4. 展示模型原始 chain-of-thought。
5. 第一阶段实现所有工具的精细化 UI。
6. 第一阶段实现完整权限审批系统。

---

## 4. 核心设计原则

### 4.1 主聊天流只展示用户可理解内容

主聊天流允许展示：

```text
user message
assistant message
轻量工具状态
任务入口
用户需要确认的审批项
最终产物入口
```

主聊天流默认不展示：

```text
reflection skipped
policy internal event
workflow raw event
worker raw delta
raw JSON
数据库字段
模型内部推理链
```

### 4.2 事件不等于 UI

后端事件是事实记录，不是 UI 组件。

错误做法：

```tsx
if (event.item_type === 'reflection') {
  return <RunStepCard />
}
```

正确做法：

```text
RunEvent[]
  ↓ projectConversation()
ConversationRenderItem[]
  ↓ render
UI Components
```

### 4.3 状态语义必须单一

每个完成事件只能代表一个清晰边界。

```text
assistant.completed        assistant 文本完成
foreground_run.completed   前台会话流程完成
worker.completed           后台 worker 完成
task.completed             产品任务完成
reflection.completed       反思流程完成
run.finalized              run 相关事件全部归档完成
```

不要再让 `run.completed` 同时承担所有含义。一个字段扛太多职责，最后就像一根牙签撑摩天楼，听起来很励志，实际很荒诞。

---

## 5. 术语定义

| 术语 | 定义 |
|---|---|
| Conversation | 一组连续消息的会话容器 |
| Message | 用户或助手的自然语言消息，只包含 `user` / `assistant` |
| Run | 一轮用户输入触发的执行上下文 |
| Run Event | Run 过程中的事实事件，可实时推送，也可持久化回放 |
| Run Step | 后端执行步骤记录，偏持久化与审计 |
| Tool Run | 工具调用记录，包含 input/output/error/risk |
| Foreground Run | 直接服务本轮聊天回复的前台流程 |
| Background Task | 可在聊天回复完成后继续执行的后台任务 |
| Reflection | 会话后内部记忆、任务候选、归纳逻辑 |
| Trace | 面向开发/高级用户的完整事件追踪 |
| Conversation Render Model | 前端从 messages + run_events 投影出的 UI 渲染模型 |

---

## 6. 目标架构

### 6.1 总体架构

```text
Backend
├─ SendChat
├─ Run Event Emitter
├─ SQLite Persistence
├─ Worker / Task Runtime
└─ Reflection Runtime

Electron Preload Event Channel
└─ joi:run:event

Frontend
├─ Event Receiver
├─ Event Normalizer
├─ Run Event Store
├─ Conversation Projector
├─ Conversation Render Model
├─ Chat Components
└─ Trace / Task Panels
```

### 6.2 前端三层展示

```text
Conversation Layer
只展示 user / assistant 自然对话与少量用户可理解状态。

Execution Layer
展示当前 run 的工具调用、进度、审批、任务入口。

Trace Layer
展示完整事件、raw JSON、内部 reflection、policy、workflow、worker delta。
```

---

## 7. 后端事件协议 Spec

### 7.1 事件命名规范

事件类型使用 dot notation：

```text
<domain>.<action>
```

例如：

```text
run.started
assistant.delta
assistant.completed
foreground_run.completed
tool.started
tool.completed
worker.started
worker.completed
reflection.completed
run.finalized
run.failed
```

### 7.2 标准事件字段

```ts
export type RunEvent = {
  id: string;
  run_id: string;
  seq: number;
  type: RunEventType;
  item_id: string;
  item_type: RunEventItemType;
  status: RunEventStatus;
  parent_item_id?: string;
  title?: string;
  summary?: string;
  snapshot?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};
```

兼容当前字段：

```text
后端数据库字段 event_type
前端标准字段 type
```

前端 normalizer 必须兼容：

```ts
const type = event.type || event.event_type;
```

### 7.3 事件类型枚举

```ts
export type RunEventType =
  | 'run.started'
  | 'assistant.delta'
  | 'assistant.completed'
  | 'foreground_run.completed'
  | 'tool.started'
  | 'tool.delta'
  | 'tool.completed'
  | 'tool.failed'
  | 'worker.started'
  | 'worker.delta'
  | 'worker.completed'
  | 'worker.failed'
  | 'task.started'
  | 'task.delta'
  | 'task.completed'
  | 'task.failed'
  | 'approval.required'
  | 'approval.approved'
  | 'approval.rejected'
  | 'artifact.created'
  | 'reflection.started'
  | 'reflection.completed'
  | 'reflection.failed'
  | 'run.finalized'
  | 'run.failed';
```

### 7.4 item_type 枚举

```ts
export type RunEventItemType =
  | 'run'
  | 'assistant_message'
  | 'model'
  | 'tool'
  | 'capability'
  | 'workflow'
  | 'node'
  | 'worker'
  | 'task'
  | 'approval'
  | 'artifact'
  | 'reflection'
  | 'policy'
  | 'memory'
  | 'system';
```

兼容策略：

```text
当前 assistant.delta 的 item_type = model
新协议推荐 assistant.delta 的 item_type = assistant_message
前端必须同时兼容 model 与 assistant_message
```

### 7.5 status 枚举

```ts
export type RunEventStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'blocked';
```

前端 normalize：

```ts
export function normalizeStatus(status: string): NormalizedStatus {
  switch (status) {
    case 'succeeded':
    case 'completed':
      return 'completed';
    case 'running':
      return 'running';
    case 'queued':
    case 'pending':
      return 'pending';
    case 'waiting_approval':
      return 'waiting_approval';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'blocked':
      return 'blocked';
    case 'skipped':
      return 'skipped';
    default:
      return 'running';
  }
}
```

---

## 8. 关键事件语义

### 8.1 `run.started`

表示一轮 run 被创建并开始处理。

```json
{
  "type": "run.started",
  "item_type": "run",
  "status": "running",
  "title": "Run started",
  "summary": "Joi 开始处理",
  "snapshot": {
    "conversation_id": "conv_xxx",
    "user_message_id": "msg_xxx",
    "input_mode": "auto",
    "selected_agent_id": "general_agent"
  }
}
```

默认展示：hidden。
Trace 展示：是。

### 8.2 `assistant.delta`

表示 assistant 文本流式增量。

```json
{
  "type": "assistant.delta",
  "item_type": "assistant_message",
  "status": "running",
  "delta": {
    "text": "可以帮你总结",
    "stream_source": "provider_token"
  },
  "metadata": {
    "message_id": "msg_assistant_xxx"
  }
}
```

默认展示：chat。
Trace 展示：是。

兼容当前 fallback：

```json
{
  "type": "assistant.delta",
  "item_type": "model",
  "delta": {
    "text": "可以帮你总结",
    "stream_source": "fallback_final_chunk"
  }
}
```

### 8.3 `assistant.completed`

表示 assistant 文本已经完整生成。

```json
{
  "type": "assistant.completed",
  "item_type": "assistant_message",
  "status": "completed",
  "snapshot": {
    "assistant_message_id": "msg_xxx",
    "content": "可以帮你总结网页内容。请把网页链接发给我..."
  }
}
```

前端行为：

```text
停止 assistant bubble 打字状态
把 streamingAssistantMessage.complete 设为 true
允许 message reconcile
```

默认展示：chat state。
Trace 展示：是。

### 8.4 `foreground_run.completed`

表示前台对话流程结束。对用户来说，本轮聊天已经收口。

```json
{
  "type": "foreground_run.completed",
  "item_type": "run",
  "status": "completed",
  "summary": "本轮回复已完成",
  "snapshot": {
    "assistant_message_id": "msg_xxx",
    "has_background_work": false
  }
}
```

前端行为：

```text
允许结束本轮 isSubmitting
允许收起轻量执行状态
不代表后台 worker / task / reflection 全部完成
```

默认展示：hidden。
Trace 展示：是。

### 8.5 `worker.started` / `worker.delta` / `worker.completed`

表示后台 worker 任务生命周期。

```json
{
  "type": "worker.started",
  "item_type": "worker",
  "status": "running",
  "title": "Worker 已领取任务",
  "summary": "正在读取网页"
}
```

```json
{
  "type": "worker.completed",
  "item_type": "worker",
  "status": "completed",
  "title": "Worker 执行完成",
  "summary": "已读取 example.com",
  "snapshot": {
    "task_id": "task_xxx",
    "tool_run_id": "toolrun_xxx",
    "result_preview": {}
  }
}
```

默认展示：

```text
Auto: 如果是短工具，投影成 InlineStatus；如果是后台任务，投影成 TaskEntry
Task: 投影到 CompactRunCard / TaskPanel
Bg: 主聊天只显示任务入口
Chat: 默认不展示，除非用户显式要求执行
```

### 8.6 `reflection.completed`

表示内部反思、记忆候选或任务候选流程完成。

```json
{
  "type": "reflection.completed",
  "item_type": "reflection",
  "status": "completed",
  "title": "会话反思",
  "summary": "本轮无需生成记忆或后续任务候选",
  "snapshot": {
    "reflection_skipped": true
  }
}
```

默认展示：trace_only。
主聊天展示：否。
例外：如果 reflection 产生用户可见的 proactive task/open loop，则生成独立 `task.created` 或 `suggestion.created` 事件展示。

### 8.7 `run.finalized`

表示该 run 相关事件都已经归档完成。

```json
{
  "type": "run.finalized",
  "item_type": "run",
  "status": "completed",
  "summary": "Run 已归档完成",
  "snapshot": {
    "foreground_completed": true,
    "background_completed": true,
    "reflection_completed": true
  }
}
```

默认展示：hidden。
Trace 展示：是。

---

## 9. 后端改造 Spec

### 9.1 最小事件改造

P0 必须新增：

```text
assistant.completed
foreground_run.completed
run.finalized
```

P0 兼容保留：

```text
run.completed
```

但前端不再把 `run.completed` 直接理解为“全部完成”。

### 9.2 推荐事件顺序

#### 9.2.1 普通问答

```text
run.started
assistant.delta*
assistant.completed
foreground_run.completed
reflection.completed        // trace only，可异步
run.finalized
```

#### 9.2.2 普通澄清

```text
run.started
assistant.delta*
assistant.completed
foreground_run.completed
reflection.completed        // trace only，通常 skipped
run.finalized
```

#### 9.2.3 前台工具调用

```text
run.started
tool.started
tool.delta*
tool.completed
assistant.delta*
assistant.completed
foreground_run.completed
reflection.completed        // trace only
run.finalized
```

#### 9.2.4 后台 worker

```text
run.started
assistant.delta*            // “已交给后台处理...”
assistant.completed
foreground_run.completed
worker.started
worker.delta*
worker.completed
reflection.completed        // trace only
run.finalized
```

#### 9.2.5 需要审批

```text
run.started
tool.started
approval.required
foreground_run.waiting_approval
```

用户批准后：

```text
approval.approved
tool.completed
assistant.delta*
assistant.completed
foreground_run.completed
run.finalized
```

用户拒绝后：

```text
approval.rejected
assistant.delta*            // “已取消该操作”
assistant.completed
foreground_run.completed
run.finalized
```

### 9.3 后端代码修改点

#### 9.3.1 AppCore SendChat

当前位置：

```text
services/orchestrator-core/internal/appcore/appcore.go
```

当前流程问题：

```text
assistant message 写库后立即 emit run.completed
```

目标改为：

```go
// 1. 插入 assistant message
assistantMessageID := insertAssistantMessage(...)

// 2. 如果 response 是 fallback chunk，则补发 assistant.delta
emitAssistantDeltas(...)

// 3. 新增 assistant.completed
emitRunEvent(ctx, tx, req.EventSink, runEventInput{
  RunID: runID,
  Type: "assistant.completed",
  ItemID: assistantMessageID,
  ItemType: "assistant_message",
  Status: "completed",
  Title: "Assistant response completed",
  Snapshot: map[string]any{
    "assistant_message_id": assistantMessageID,
    "content": response,
  },
})

// 4. 新增 foreground_run.completed
emitRunEvent(ctx, tx, req.EventSink, runEventInput{
  RunID: runID,
  Type: "foreground_run.completed",
  ItemID: runID,
  ItemType: "run",
  Status: "completed",
  Title: "Foreground run completed",
  Summary: "本轮回复已完成",
  Snapshot: map[string]any{
    "assistant_message_id": assistantMessageID,
    "has_background_work": hasBackgroundWork,
  },
})

// 5. run.finalized 在后台事件都结束后发，P0 可以在无后台任务时立即发
```

#### 9.3.2 reflection 改造

当前：

```text
runConversationReflectionTx 在 SendChat 事务中同步执行
即使 skipped，也产生 run_step / run_event
```

P0 目标：

```text
保留 reflection 逻辑
但前端默认 trace_only
后端事件 type 改为 reflection.completed 或兼容 item.completed + item_type reflection
```

P1 目标：

```text
reflection 从主 SendChat 事务中移出，放入后台异步队列
reflection 不阻塞 assistant.completed / foreground_run.completed
```

### 9.4 数据库兼容

P0 不需要改表。

当前 `run_events.event_type` 是 TEXT，可直接新增事件类型。

建议新增索引，若不存在：

```sql
CREATE INDEX IF NOT EXISTS idx_run_events_run_seq
ON run_events(run_id, seq);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
ON messages(conversation_id, created_at);
```

P1 可考虑在 `messages` 表增加显式 `run_id` 字段，但不是本次必要项：

```sql
ALTER TABLE messages ADD COLUMN run_id TEXT;
```

如果新增，需迁移：

```sql
UPDATE messages
SET run_id = json_extract(metadata, '$.run_id')
WHERE role = 'assistant'
  AND json_extract(metadata, '$.run_id') IS NOT NULL;
```

---

## 10. 前端改造 Spec

### 10.1 新增目录结构

建议新增：

```text
frontend/src/features/chat/types.ts
frontend/src/features/chat/runEventNormalizer.ts
frontend/src/features/chat/eventVisibility.ts
frontend/src/features/chat/conversationProjector.ts
frontend/src/features/chat/executionSummary.ts
frontend/src/features/chat/components/MessageList.tsx
frontend/src/features/chat/components/MessageBubble.tsx
frontend/src/features/chat/components/InlineStatus.tsx
frontend/src/features/chat/components/CompactRunCard.tsx
frontend/src/features/chat/components/TaskEntry.tsx
frontend/src/features/chat/components/TraceDrawer.tsx
```

现阶段可以不立刻从 `App.tsx` 全量迁移，但新逻辑必须落到独立文件，避免 `App.tsx` 继续膨胀。

### 10.2 标准输入数据

```ts
export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
  run_id?: string;
};

export type StreamingAssistantMessage = {
  id: string;
  conversation_id: string;
  role: 'assistant';
  content: string;
  run_id?: string;
  complete: boolean;
};
```

### 10.3 Run Event Normalizer

```ts
export type NormalizedRunEvent = {
  id: string;
  runId: string;
  seq: number;
  type: string;
  itemId: string;
  itemType: string;
  status: NormalizedStatus;
  parentItemId?: string;
  title?: string;
  summary?: string;
  snapshot: Record<string, unknown>;
  delta: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
};

export function normalizeRunEvent(raw: any): NormalizedRunEvent {
  return {
    id: String(raw.id || `${raw.run_id || raw.runID}:${raw.seq || Date.now()}`),
    runId: String(raw.run_id || raw.runID || ''),
    seq: Number(raw.seq || 0),
    type: String(raw.type || raw.event_type || raw.event || ''),
    itemId: String(raw.item_id || raw.itemID || ''),
    itemType: String(raw.item_type || raw.itemType || ''),
    status: normalizeStatus(String(raw.status || 'running')),
    parentItemId: raw.parent_item_id || raw.parentItemID,
    title: raw.title ? String(raw.title) : undefined,
    summary: raw.summary ? String(raw.summary) : undefined,
    snapshot: asObject(raw.snapshot),
    delta: asObject(raw.delta),
    error: raw.error ? String(raw.error) : undefined,
    metadata: asObject(raw.metadata),
    createdAt: raw.created_at || raw.createdAt,
  };
}
```

### 10.4 Conversation Render Item 类型

```ts
export type ConversationRenderItem =
  | ChatMessageRenderItem
  | InlineStatusRenderItem
  | CompactRunCardRenderItem
  | TaskEntryRenderItem
  | ApprovalRenderItem
  | ArtifactRenderItem;

export type ChatMessageRenderItem = {
  type: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  streaming?: boolean;
  createdAt?: string;
};

export type InlineStatusRenderItem = {
  type: 'inline_status';
  id: string;
  runId: string;
  anchorMessageId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  label: string;
  detail?: string;
  traceAvailable?: boolean;
  startedAt?: string;
  completedAt?: string;
};

export type CompactRunCardRenderItem = {
  type: 'compact_run_card';
  id: string;
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  title: string;
  progressLabel?: string;
  steps: CompactRunStep[];
  collapsed: boolean;
  traceAvailable?: boolean;
};

export type CompactRunStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  summary?: string;
  durationMs?: number;
};

export type TaskEntryRenderItem = {
  type: 'task_entry';
  id: string;
  runId: string;
  taskId: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  summary?: string;
};

export type ApprovalRenderItem = {
  type: 'approval';
  id: string;
  runId: string;
  title: string;
  riskLevel: 'read_only' | 'private_content' | 'state_change' | 'dangerous';
  summary?: string;
  status: 'waiting_approval' | 'approved' | 'rejected';
};

export type ArtifactRenderItem = {
  type: 'artifact';
  id: string;
  runId: string;
  artifactId: string;
  title: string;
  artifactType: string;
};
```

---

## 11. Event Visibility 规则

### 11.1 可见性枚举

```ts
export type EventVisibility =
  | 'chat'
  | 'inline'
  | 'compact'
  | 'task'
  | 'approval'
  | 'artifact'
  | 'trace_only'
  | 'hidden';
```

### 11.2 默认规则

```ts
export function getEventVisibility(event: NormalizedRunEvent, mode: InputMode): EventVisibility {
  const type = event.type;
  const itemType = event.itemType;

  if (type === 'assistant.delta' || type === 'assistant.completed') {
    return 'chat';
  }

  if (type === 'approval.required') {
    return 'approval';
  }

  if (type === 'artifact.created') {
    return 'artifact';
  }

  if (itemType === 'reflection') {
    return 'trace_only';
  }

  if (itemType === 'policy' || itemType === 'workflow') {
    return 'trace_only';
  }

  if (itemType === 'memory') {
    return 'trace_only';
  }

  if (type === 'run.started' || type === 'foreground_run.completed' || type === 'run.finalized') {
    return 'hidden';
  }

  if (itemType === 'worker') {
    if (mode === 'background_task') return 'task';
    if (mode === 'serious_task') return 'compact';
    if (mode === 'chat_assist') return 'trace_only';
    return 'inline';
  }

  if (itemType === 'tool' || itemType === 'capability' || itemType === 'node') {
    if (mode === 'chat_assist') return 'trace_only';
    if (mode === 'serious_task') return 'compact';
    return 'inline';
  }

  return 'trace_only';
}
```

### 11.3 模式覆盖

| 模式 | 工具事件 | worker 事件 | reflection | policy/workflow | assistant text |
|---|---|---|---|---|---|
| Chat | trace only | trace only | trace only | trace only | chat |
| Auto | inline | inline/task | trace only | trace only | chat |
| Task | compact/task | compact/task | trace only | trace only | chat |
| Bg | task entry | task entry | trace only | trace only | chat/brief |
| Debug | trace | trace | trace | trace | trace + chat |

---

## 12. Conversation Projector Spec

### 12.1 输入

```ts
export type BuildConversationRenderItemsInput = {
  messages: ConversationMessage[];
  streamingAssistant?: StreamingAssistantMessage | null;
  pendingUserMessage?: ConversationMessage | null;
  runEventsByRunId: Record<string, NormalizedRunEvent[]>;
  activeRunId?: string;
  mode: InputMode;
  debug?: boolean;
};
```

### 12.2 输出

```ts
export type BuildConversationRenderItemsOutput = {
  items: ConversationRenderItem[];
  traceOnlyEventsByRunId: Record<string, NormalizedRunEvent[]>;
  activeRunStatusByRunId: Record<string, NormalizedStatus>;
};
```

### 12.3 核心函数

```ts
export function buildConversationRenderItems(
  input: BuildConversationRenderItemsInput,
): BuildConversationRenderItemsOutput {
  const items: ConversationRenderItem[] = [];
  const traceOnlyEventsByRunId: Record<string, NormalizedRunEvent[]> = {};
  const activeRunStatusByRunId: Record<string, NormalizedStatus> = {};

  if (input.pendingUserMessage) {
    items.push(projectMessage(input.pendingUserMessage, true));
  }

  for (const message of input.messages) {
    items.push(projectMessage(message, false));

    if (message.role !== 'assistant') continue;

    const runId = getMessageRunId(message);
    if (!runId) continue;

    const projected = projectRunEventsForAssistantMessage({
      runId,
      assistantMessageId: message.id,
      events: input.runEventsByRunId[runId] || [],
      mode: input.mode,
      debug: input.debug,
    });

    items.push(...projected.items);
    traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
    activeRunStatusByRunId[runId] = projected.status;
  }

  if (input.streamingAssistant) {
    items.push({
      type: 'message',
      id: input.streamingAssistant.id,
      role: 'assistant',
      content: input.streamingAssistant.content,
      runId: input.streamingAssistant.run_id,
      streaming: !input.streamingAssistant.complete,
    });

    const runId = input.streamingAssistant.run_id;
    if (runId) {
      const projected = projectRunEventsForAssistantMessage({
        runId,
        assistantMessageId: input.streamingAssistant.id,
        events: input.runEventsByRunId[runId] || [],
        mode: input.mode,
        debug: input.debug,
      });
      items.push(...projected.items);
      traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
      activeRunStatusByRunId[runId] = projected.status;
    }
  }

  return { items, traceOnlyEventsByRunId, activeRunStatusByRunId };
}
```

### 12.4 投影规则

```ts
function projectRunEventsForAssistantMessage(input: {
  runId: string;
  assistantMessageId: string;
  events: NormalizedRunEvent[];
  mode: InputMode;
  debug?: boolean;
}): {
  items: ConversationRenderItem[];
  traceOnlyEvents: NormalizedRunEvent[];
  status: NormalizedStatus;
} {
  const visibleEvents: NormalizedRunEvent[] = [];
  const traceOnlyEvents: NormalizedRunEvent[] = [];

  for (const event of sortBySeq(input.events)) {
    const visibility = input.debug ? 'compact' : getEventVisibility(event, input.mode);

    if (visibility === 'trace_only') {
      traceOnlyEvents.push(event);
      continue;
    }
    if (visibility === 'hidden' || visibility === 'chat') {
      continue;
    }
    visibleEvents.push(event);
  }

  const items = aggregateVisibleEvents({
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    events: visibleEvents,
    mode: input.mode,
  });

  return {
    items,
    traceOnlyEvents,
    status: deriveRunStatus(input.events),
  };
}
```

### 12.5 去重规则

同一个 `item_id` 的 started/delta/completed 应聚合为一个展示对象。

```ts
function groupEventsByItem(events: NormalizedRunEvent[]): Map<string, NormalizedRunEvent[]> {
  const grouped = new Map<string, NormalizedRunEvent[]>();
  for (const event of events) {
    const key = event.itemId || `${event.itemType}:${event.title || event.seq}`;
    grouped.set(key, [...(grouped.get(key) || []), event]);
  }
  return grouped;
}
```

### 12.6 Run 状态推导

```ts
export function deriveRunStatus(events: NormalizedRunEvent[]): NormalizedStatus {
  if (events.some((e) => e.status === 'failed' || e.type.endsWith('.failed'))) return 'failed';
  if (events.some((e) => e.type === 'approval.required' && e.status === 'waiting_approval')) return 'waiting_approval';
  if (events.some((e) => e.status === 'running')) return 'running';
  if (events.some((e) => e.type === 'foreground_run.completed' || e.type === 'assistant.completed')) return 'completed';
  return 'pending';
}
```

注意：

```text
run.completed 不再作为唯一完成依据。
```

---

## 13. 执行展示组件 Spec

### 13.1 MessageBubble

职责：

```text
只展示 user / assistant 自然语言文本
不解析 tool/run/reflection
不展示 JSON
```

Props：

```ts
type MessageBubbleProps = {
  item: ChatMessageRenderItem;
};
```

行为：

```text
assistant streaming = true 时显示打字态
assistant streaming = false 时隐藏打字态
content 为空但 streaming 时显示轻量 skeleton
```

### 13.2 InlineStatus

适用：

```text
单工具调用
短时间状态
查询类工具
用户不需要看到步骤细节
```

示例：

```text
正在读取网页...
已读取网页 · 查看
已检索 5 条结果 · 查看
```

Props：

```ts
type InlineStatusProps = {
  item: InlineStatusRenderItem;
  onOpenTrace?: (runId: string) => void;
};
```

视觉规则：

```text
位于 assistant bubble 下方
高度尽量小
默认一行
支持点击“查看”进入 Trace 或展开详情
失败状态显示错误摘要，不展示 raw error stack
```

### 13.3 CompactRunCard

适用：

```text
多步骤任务
3-20 秒执行
serious_task 前台执行
多个 tool/capability 串联
```

示例：

```text
正在总结网页 · 2/4
✓ 读取网页
✓ 提取正文
• 生成摘要
○ 整理引用
```

Props：

```ts
type CompactRunCardProps = {
  item: CompactRunCardRenderItem;
  onOpenTrace?: (runId: string) => void;
};
```

行为：

```text
running 时默认展开或半展开
completed 后默认折叠
failed 时默认展开失败步骤
waiting_approval 时展示审批入口
```

### 13.4 TaskEntry

适用：

```text
background_task
长任务
worker 继续执行
有 product_task_id 的任务
```

示例：

```text
任务已创建：总结网页
后台执行中 · 查看任务
```

Props：

```ts
type TaskEntryProps = {
  item: TaskEntryRenderItem;
  onOpenTask?: (taskId: string) => void;
};
```

行为：

```text
主聊天只显示任务入口
详细步骤进入 Task Execution Panel
任务完成后更新状态，但不要把所有 worker delta 插回聊天流
```

### 13.5 TracePanel / TraceDrawer

适用：

```text
完整 run_events
debug
开发者排障
高级用户点击“查看过程”
```

展示内容：

```text
seq
event type
item type
status
title
summary
delta / snapshot 折叠 JSON
error
created_at
```

默认：

```text
不在主聊天流展开
通过按钮打开
```

---

## 14. 模式行为 Spec

### 14.1 InputMode 类型

当前后端已有：

```ts
export type InputMode = 'auto' | 'chat_assist' | 'serious_task' | 'background_task';
```

前端按钮映射：

| UI Label | input_mode |
|---|---|
| Auto | `auto` |
| Chat | `chat_assist` |
| Task | `serious_task` |
| Bg | `background_task` |

### 14.2 前端接线

当前错误：

```ts
input_mode: 'auto'
```

目标：

```tsx
const [inputMode, setInputMode] = useState<InputMode>('auto');

const result = await desktopApi.sendChat({
  conversation_id: currentConversationID || undefined,
  channel: 'desktop',
  user_id: 'desktop_user',
  message: prompt,
  preferred_node: routing.preferredNode,
  allow_worker: routing.allowWorker,
  model_name: modelName,
  input_mode: inputMode,
  product_task_id: activeProductTaskID || undefined,
});
```

### 14.3 Chat 模式

产品语义：

```text
用于普通问答、澄清、轻量对话。
不主动创建任务。
默认不展示工具过程。
```

后端约束目标：

```text
ShouldCreateTask = false
默认不触发 worker
工具调用需要非常明确的用户意图
```

UI：

```text
只展示 user / assistant 消息
不展示 InlineStatus，除非发生用户明确要求的可见工具调用
reflection trace only
```

### 14.4 Auto 模式

产品语义：

```text
Joi 自动判断是聊天、工具调用、任务还是后台任务。
```

UI：

```text
普通聊天：只展示回复
工具调用：InlineStatus
多步骤：CompactRunCard
后台：TaskEntry
```

### 14.5 Task 模式

产品语义：

```text
用户希望 Joi 认真执行一个可交付任务。
```

UI：

```text
展示 CompactRunCard
有 product_task 时展示 TaskEntry / TaskPanel
工具步骤默认可见摘要
产物入口可见
```

### 14.6 Bg 模式

产品语义：

```text
用户希望后台执行，不占用主聊天流。
```

UI：

```text
assistant 简短确认
主聊天展示 TaskEntry
worker 细节进入 TaskPanel / TracePanel
完成时更新任务状态或通知
```

---

## 15. 工具调用展示 Spec

### 15.1 工具分类

| 工具类型 | 当前例子 | 默认 UI |
|---|---|---|
| 公共查询 | web_research, browser_read | InlineStatus |
| 本地只读 | desktop_app_list, system_health_check | InlineStatus / CompactRunCard |
| 私有内容只读 | file_analyze, workspace_search, memory_search | CompactRunCard，摘要脱敏 |
| 写操作 | apply_patch_workflow, patch_proposal | Approval + TaskPanel |
| 内部事件 | reflection, memory internal, policy | Trace only |

### 15.2 工具摘要生成

新增函数：

```ts
export function summarizeExecutionEvent(event: NormalizedRunEvent): string {
  const toolName = String(event.snapshot.tool_name || event.delta.tool_name || event.title || '工具');

  if (event.status === 'running') {
    return toRunningLabel(toolName, event);
  }

  if (event.status === 'completed') {
    return toCompletedLabel(toolName, event);
  }

  if (event.status === 'failed') {
    return toFailedLabel(toolName, event);
  }

  return event.summary || event.title || '正在处理';
}
```

示例映射：

```ts
const toolLabelMap: Record<string, { running: string; completed: string }> = {
  web_research_v1: {
    running: '正在读取网页',
    completed: '已读取网页',
  },
  web_research_v2: {
    running: '正在检索网页',
    completed: '已完成网页检索',
  },
  workspace_search_v1: {
    running: '正在搜索工作区',
    completed: '已搜索工作区',
  },
  file_analyze_v1: {
    running: '正在分析文件',
    completed: '已分析文件',
  },
  system_health_check_v1: {
    running: '正在检查系统状态',
    completed: '已检查系统状态',
  },
};
```

### 15.3 展示输入输出

默认聊天流展示：

```text
已读取网页 · 查看
```

展开或 Trace 展示：

```text
工具名
风险等级
输入摘要
输出摘要
耗时
错误
原始 JSON 折叠
```

禁止默认展示：

```text
完整输入 JSON
完整网页正文
完整文件内容
私密路径
token / secret
stack trace
```

---

## 16. Streaming Spec

### 16.1 P0：兼容 fallback chunk

当前 fallback 仍可保留：

```text
assistant.delta stream_source = fallback_final_chunk
```

但必须补发：

```text
assistant.completed
```

前端完成判断改为：

```ts
if (event.type === 'assistant.completed') {
  markStreamingAssistantComplete(event);
}
```

兼容旧事件：

```ts
if (event.type === 'run.completed' && !hasSeenAssistantCompleted(runId)) {
  markStreamingAssistantComplete(event);
}
```

### 16.2 P1：真实 token streaming

目标后端抽象：

```go
type AssistantStreamWriter struct {
  RunID     string
  MessageID string
  Buffer    strings.Builder
  Emit      func(event runEventInput) error
}

func (w *AssistantStreamWriter) Delta(text string) error {
  w.Buffer.WriteString(text)
  return w.Emit(runEventInput{
    RunID:    w.RunID,
    Type:     "assistant.delta",
    ItemID:   w.MessageID,
    ItemType: "assistant_message",
    Status:   "running",
    Delta: map[string]any{
      "text": text,
      "stream_source": "provider_token",
    },
  })
}

func (w *AssistantStreamWriter) Complete() error {
  return w.Emit(runEventInput{
    RunID:    w.RunID,
    Type:     "assistant.completed",
    ItemID:   w.MessageID,
    ItemType: "assistant_message",
    Status:   "completed",
    Snapshot: map[string]any{
      "content": w.Buffer.String(),
    },
  })
}
```

### 16.3 前端 reconcile

当最终消息从数据库加载回来时：

```text
如果 persisted assistant message 与 streamingAssistantMessage run_id 相同：
  用 persisted message 替换 streaming message
  清理 streamingAssistantMessage
```

去重 key：

```text
assistant_message_id 优先
否则 run_id + role assistant
```

---

## 17. 状态管理 Spec

### 17.1 P0 保持 React useState

不强制引入 Zustand/Redux。

新增最小状态：

```ts
const [inputMode, setInputMode] = useState<InputMode>('auto');
const [runEventsByRunId, setRunEventsByRunId] = useState<Record<string, NormalizedRunEvent[]>>({});
```

### 17.2 事件接收逻辑

```ts
function dispatchExecutionEvent(raw: ExecutionEvent) {
  const event = normalizeRunEvent(raw);
  if (!event.runId) return;

  setRunEventsByRunId((current) => {
    const events = current[event.runId] || [];
    if (events.some((existing) => existing.id === event.id || existing.seq === event.seq)) {
      return current;
    }
    return {
      ...current,
      [event.runId]: [...events, event].sort((a, b) => a.seq - b.seq),
    };
  });

  handleAssistantStreamingEvent(event);
}
```

### 17.3 assistant streaming 逻辑

```ts
function handleAssistantStreamingEvent(event: NormalizedRunEvent) {
  if (event.type === 'assistant.delta') {
    const text = String(event.delta.text || event.delta.delta || '');
    if (!text) return;

    setStreamingAssistantMessage((current) => ({
      id: current?.id || getAssistantMessageId(event),
      conversation_id: current?.conversation_id || getConversationId(event),
      role: 'assistant',
      content: `${current?.content || ''}${text}`,
      run_id: event.runId || current?.run_id,
      complete: false,
    }));
    return;
  }

  if (event.type === 'assistant.completed') {
    setStreamingAssistantMessage((current) => current ? { ...current, complete: true } : current);
    return;
  }

  // Backward compatibility
  if (event.type === 'run.completed') {
    setStreamingAssistantMessage((current) => current ? { ...current, complete: true } : current);
  }
}
```

---

## 18. UI 验收场景

### 18.1 普通问答

输入：

```text
你好
```

期望事件：

```text
run.started
assistant.delta*
assistant.completed
foreground_run.completed
reflection.completed(trace only)
run.finalized
```

期望 UI：

```text
用户 bubble：你好
助手 bubble：你好！我是你的智能助手...
无 Run 卡片
无 reflection
无 “Run completed”
```

### 18.2 澄清请求

输入：

```text
什么时候总结的网页
```

期望 UI：

```text
用户 bubble：什么时候总结的网页
助手 bubble：可以帮你总结网页内容。请把网页链接发给我...
无 Run 卡片
无 会话反思
```

### 18.3 单工具调用

输入：

```text
帮我读取 https://example.com 并总结
```

期望 UI：

```text
用户 bubble
助手 bubble 流式输出或等待
InlineStatus：正在读取网页...
InlineStatus：已读取网页 · 查看
助手最终总结
```

不应出现：

```text
大 Run 卡片
raw JSON
policy/workflow/reflection
```

### 18.4 多步骤任务

输入模式：Task
输入：

```text
帮我整理这个项目的关键风险，并生成一份可执行计划
```

期望 UI：

```text
用户 bubble
助手 bubble：我会按以下步骤处理...
CompactRunCard：正在整理项目计划 · 2/4
  ✓ 搜索项目资料
  ✓ 提取风险
  • 生成计划
  ○ 整理产物
ArtifactEntry：已生成计划文档
```

### 18.5 后台任务

输入模式：Bg
输入：

```text
后台帮我每周五整理项目风险
```

期望 UI：

```text
助手 bubble：已创建后台任务，我会在每周五整理项目风险。
TaskEntry：后台任务已创建 · 查看
```

worker 事件只在任务面板/Trace 展示。

### 18.6 reflection

任何普通聊天之后，如果 reflection skipped：

期望 UI：

```text
主聊天不展示
Trace 可见 reflection.completed
```

### 18.7 旧 run_events 回放

加载历史 run，其中只有：

```text
assistant.delta
run.completed
item.completed reflection
```

期望 UI：

```text
assistant message 正常展示
run.completed 不渲染为大卡片
reflection 不进入主聊天
Trace 可见全部事件
```

---

## 19. 测试计划

### 19.1 单元测试

新增测试文件：

```text
frontend/src/features/chat/__tests__/runEventNormalizer.test.ts
frontend/src/features/chat/__tests__/eventVisibility.test.ts
frontend/src/features/chat/__tests__/conversationProjector.test.ts
frontend/src/features/chat/__tests__/executionSummary.test.ts
```

测试点：

```text
normalizeRunEvent 兼容 type/event_type
normalizeStatus 兼容 succeeded/completed
reflection => trace_only
author assistant.delta => chat
tool in Auto => inline
tool in Chat => trace_only
worker in Bg => task
run.completed 不生成主聊天卡片
旧事件可以正常投影
```

### 19.2 集成测试

场景：

```text
普通问答
澄清请求
网页读取
后台 worker
Task 模式
Bg 模式
历史回放
```

### 19.3 手工验收 Checklist

```text
[ ] 普通聊天无 Run 大卡片
[ ] reflection 不出现在主聊天
[ ] Run completed 不和 Assistant response 正在执行冲突
[ ] Auto/Chat/Task/Bg 按钮真实传入后端
[ ] Chat 模式不展示工具过程
[ ] Auto 模式工具调用展示 InlineStatus
[ ] Task 模式展示 CompactRunCard
[ ] Bg 模式展示 TaskEntry
[ ] Trace 面板仍可看到完整 run_events
[ ] 历史会话回放不破坏
[ ] assistant streaming 不重复、不截断、不乱序
```

---

## 20. 分阶段实施计划

### PR 1：后端事件语义修复

范围：

```text
appcore.go
execution_events.go
frontend api type 如需同步
```

改动：

```text
新增 assistant.completed
新增 foreground_run.completed
新增 run.finalized
保留 run.completed 兼容旧逻辑
reflection 事件改为 reflection.completed 或保持兼容但前端过滤
```

验收：

```text
普通问答事件顺序正确
run.completed 不再被前端当作唯一完成依据
assistant.completed 可驱动 streaming 完成
```

### PR 2：前端模式按钮接线

范围：

```text
App.tsx Composer 相关状态
sendChat 调用
```

改动：

```text
新增 inputMode state
Auto/Chat/Task/Bg 点击更新 inputMode
sendChat 传 input_mode: inputMode
```

验收：

```text
后端 run metadata 能看到不同 input_mode
Chat/Task/Bg 不再全是 auto
```

### PR 3：Run Event Normalizer + Visibility

范围：

```text
features/chat/runEventNormalizer.ts
features/chat/eventVisibility.ts
App.tsx dispatchExecutionEvent 接入
```

改动：

```text
所有 Electron run event 先 normalize
runEventsByRunId 按 runId 聚合
reflection/policy/workflow 默认 trace_only
```

验收：

```text
主聊天不显示 reflection
Trace 仍可看到 reflection
旧事件兼容
```

### PR 4：Conversation Projector

范围：

```text
features/chat/conversationProjector.ts
MessageList 渲染逻辑
```

改动：

```text
displayMessages.map 改为 renderItems.map
ExecutionActionFlow 不再直接插在 assistant 前
```

验收：

```text
普通问答只显示消息
工具调用显示 InlineStatus
Task 模式显示 CompactRunCard
```

### PR 5：执行组件拆分

范围：

```text
MessageBubble
InlineStatus
CompactRunCard
TaskEntry
TraceDrawer
```

改动：

```text
从 App.tsx 拆 UI 组件
统一组件 props
统一 collapsed 行为
```

验收：

```text
UI 层不直接读取 raw run_events
组件只消费 ConversationRenderItem
```

### PR 6：真实 token streaming

范围：

```text
模型 provider 调用层
AssistantStreamWriter
assistant.delta source provider_token
```

改动：

```text
接真实 provider token callback
fallback_final_chunk 只作为降级方案
assistant.completed 做最终 reconcile
```

验收：

```text
长回复边生成边显示
最终 message 与 streaming 内容一致
刷新后历史正确
```

---

## 21. 兼容策略

### 21.1 旧事件兼容

前端必须兼容：

```text
event_type 字段
run.completed 作为 assistant 完成 fallback
item.completed + item_type reflection
assistant.delta + item_type model
status = succeeded
```

### 21.2 历史消息兼容

assistant message 的 run_id 获取顺序：

```ts
function getMessageRunId(message: ConversationMessage): string | undefined {
  return message.run_id
    || String(message.metadata?.run_id || '')
    || undefined;
}
```

### 21.3 无事件时兼容

如果某个 assistant message 没有 run_events：

```text
只展示 assistant message
不展示执行卡
Trace 入口隐藏或显示“暂无事件”
```

---

## 22. 风险与对策

### 22.1 风险：事件类型改动影响历史回放

对策：

```text
新增事件，不删除旧事件
前端 normalizer 兼容旧字段
run.completed 保持 fallback
```

### 22.2 风险：前端双重展示 assistant message

对策：

```text
用 run_id + assistant_message_id reconcile
streamingAssistantMessage 完成后等待 persisted message 替换
MessageList 去重
```

### 22.3 风险：工具状态消失导致用户以为没执行

对策：

```text
Auto 模式下 tool/capability 默认 InlineStatus
Task 模式下 CompactRunCard
Trace 始终保留完整事件
```

### 22.4 风险：App.tsx 改动过大

对策：

```text
先新增纯函数和类型
P0 只替换事件过滤和模式接线
P1 再拆组件
```

### 22.5 风险：后台 worker 结果与前台 run 状态冲突

对策：

```text
foreground_run.completed 与 worker.completed 分离
TaskEntry 承载后台状态
run.finalized 只进 Trace
```

---

## 23. Definition of Done

本次“完整优化对话部分”完成标准：

```text
[ ] 后端发出 assistant.completed
[ ] 后端发出 foreground_run.completed
[ ] 前端不再依赖 run.completed 判断 assistant 完成
[ ] Auto/Chat/Task/Bg 真正传 input_mode
[ ] 前端存在 runEventNormalizer
[ ] 前端存在 eventVisibility
[ ] 前端存在 conversationProjector
[ ] MessageList 渲染 ConversationRenderItem，而不是 raw events
[ ] reflection 默认不进入主聊天
[ ] policy/workflow/raw JSON 默认不进入主聊天
[ ] 单工具调用显示 InlineStatus
[ ] 多步骤任务显示 CompactRunCard
[ ] 后台任务显示 TaskEntry
[ ] Trace 面板可查看完整 run_events
[ ] 历史 run_events 可回放
[ ] 普通问答无 Run 大卡片
[ ] 图中“Run completed 但 Assistant response 正在执行”的冲突消失
```

---

## 24. 推荐当天先做的三个 Commit

### Commit 1

```text
feat(runtime): add assistant.completed and foreground_run.completed events
```

内容：

```text
新增 assistant.completed
新增 foreground_run.completed
保留 run.completed 兼容
```

### Commit 2

```text
feat(desktop): wire composer input mode to sendChat
```

内容：

```text
新增 inputMode state
Auto/Chat/Task/Bg 真正传参
```

### Commit 3

```text
feat(chat): add run event visibility filter
```

内容：

```text
新增 normalizeRunEvent
新增 getEventVisibility
reflection/policy/workflow 默认 trace only
```

完成这三个 commit 后，当前最刺眼的问题会先消失：

```text
Run completed 和 Assistant response 状态冲突
会话反思进入主聊天
模式按钮不生效
```

---

## 25. 附录：推荐文件变更清单

```text
frontend/src/App.tsx
  - 接入 inputMode
  - 接入 runEventsByRunId
  - dispatchExecutionEvent 使用 normalizeRunEvent
  - 逐步移除 raw ExecutionActionFlow 插入逻辑

frontend/src/api/desktop.ts
  - 补充新事件类型 type union，可选

frontend/src/features/chat/types.ts
  - 新增 ConversationRenderItem 等类型

frontend/src/features/chat/runEventNormalizer.ts
  - 事件字段兼容与状态归一

frontend/src/features/chat/eventVisibility.ts
  - 主聊天/执行层/Trace 可见性规则

frontend/src/features/chat/conversationProjector.ts
  - messages + run_events => renderItems

frontend/src/features/chat/executionSummary.ts
  - 工具与事件摘要文案

frontend/src/features/chat/components/*
  - MessageBubble
  - InlineStatus
  - CompactRunCard
  - TaskEntry
  - TraceDrawer

services/orchestrator-core/internal/appcore/appcore.go
  - assistant.completed
  - foreground_run.completed
  - run.finalized
  - reflection 异步化预留

services/orchestrator-core/internal/appcore/execution_events.go
  - 事件类型常量，若项目风格允许
```

---

## 26. 附录：最小代码落地片段

### 26.1 eventVisibility.ts

```ts
import type { InputMode } from '../../api/desktop';
import type { NormalizedRunEvent } from './types';

export type EventVisibility =
  | 'chat'
  | 'inline'
  | 'compact'
  | 'task'
  | 'approval'
  | 'artifact'
  | 'trace_only'
  | 'hidden';

export function getEventVisibility(event: NormalizedRunEvent, mode: InputMode): EventVisibility {
  const type = event.type;
  const itemType = event.itemType;

  if (type === 'assistant.delta' || type === 'assistant.completed') return 'chat';
  if (type === 'approval.required') return 'approval';
  if (type === 'artifact.created') return 'artifact';

  if (itemType === 'reflection') return 'trace_only';
  if (itemType === 'policy' || itemType === 'workflow' || itemType === 'memory') return 'trace_only';

  if (type === 'run.started' || type === 'foreground_run.completed' || type === 'run.finalized') {
    return 'hidden';
  }

  if (itemType === 'worker') {
    if (mode === 'background_task') return 'task';
    if (mode === 'serious_task') return 'compact';
    if (mode === 'chat_assist') return 'trace_only';
    return 'inline';
  }

  if (itemType === 'tool' || itemType === 'capability' || itemType === 'node') {
    if (mode === 'chat_assist') return 'trace_only';
    if (mode === 'serious_task') return 'compact';
    return 'inline';
  }

  return 'trace_only';
}
```

### 26.2 inputMode 接线

```tsx
const [inputMode, setInputMode] = useState<InputMode>('auto');

const result = await desktopApi.sendChat({
  conversation_id: currentConversationID || undefined,
  channel: 'desktop',
  user_id: 'desktop_user',
  message: prompt,
  preferred_node: routing.preferredNode,
  allow_worker: routing.allowWorker,
  model_name: modelName,
  input_mode: inputMode,
  product_task_id: activeProductTaskID || undefined,
});
```

### 26.3 assistant.completed 处理

```ts
if (event.type === 'assistant.completed') {
  setStreamingAssistantMessage((current) => (
    current ? { ...current, complete: true } : current
  ));
  return;
}

// Backward compatibility for old runs
if (event.type === 'run.completed') {
  setStreamingAssistantMessage((current) => (
    current ? { ...current, complete: true } : current
  ));
  return;
}
```

---

## 27. 最终结论

Joi 当前对话部分不需要先大改数据库，也不需要先做复杂 UI 设计。最优先的是补上这条链路：

```text
清晰事件语义
      ↓
稳定前端投影
      ↓
分层 UI 展示
      ↓
真实 token streaming
```

第一阶段只要完成：

```text
assistant.completed / foreground_run.completed
inputMode 接线
eventVisibility 过滤
conversationProjector 雏形
```

当前截图中的核心问题就能被系统性修复。之后再拆组件、做样式、接真实 token stream，才不会变成一边补漏一边扩建的前端危房工程。人类建软件已经够像违章建筑了，这次至少把地基先打一下。
