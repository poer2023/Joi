# Joi 与 OpenAI Codex 的核心差距分析

分析日期：2026-06-04

源码快照：

- Codex：`openai/codex` `main`，`2d5c264ebc26c276ca6cc312389abde453ca69aa`，提交时间 `2026-06-03T18:29:36Z`，本地路径 `/Users/hao/project/Joi/reference/openai-codex`
- Joi：`poer2023/Joi` `main`，`f7c20e7619ff0201a85e41a1890944fd99dd2f13`，提交时间 `2026-06-02T13:48:16+08:00`，本地路径 `/Users/hao/project/Joi`

本地说明：`reference/openai-codex` 是可按需重新拉取的外部参考快照，不属于 Joi 源码。不要使用旧的 `/Users/hao/Documents/Joi/reference` 路径；参考快照恢复方式见 `reference/README.md`。

## 一句话结论

Joi 现在离 Codex 最大的差距不是“有没有接 GPT”，而是“GPT 有没有被放进一个原生 tool-calling、可中断、可审计、可安全执行的 turn runtime”。Joi 已经有很好的产品底座：Memory OS、Capability Compiler、Run Trace、Product Task、Worker Gateway、Artifact/Proactive schema 都比一个普通聊天壳强很多。但它当前把模型当成“输出 JSON 字符串的文本生成器”，而 Codex 把模型放在“事件流 + 工具调用 + 工具结果回灌 + 沙箱/审批 + turn 生命周期”的闭环里。

要做到“接入 GPT 后用起来跟 Codex 差不太多”，最重要的 3 件事是：

1. 把 Runtime v0 的 JSON 字符串协议升级成 Codex 式 GPT Tool-Calling Turn Runtime。
2. 补齐本地主节点执行底座：shell、apply_patch、真实文件编辑、浏览器/电脑观察与操作、MCP 动态工具，以及与之配套的沙箱/审批/权限。
3. 把 run/turn 生命周期、实时事件、取消/继续/确认恢复、trace 从“事后记录”升级成“运行时状态机”。

这 3 点不做，单纯优化 prompt、换更强 GPT、加更多 agent 或美化 UI，都不会让 Joi 像 Codex。

## Codex 的核心工作方式

### 1. Codex 是多次采样的 turn loop，不是一次模型调用

Codex 在 `run_turn` 里明确写了核心规则：模型如果请求 function call，就执行工具，并把输出发回下一次 sampling request；只有当模型只返回 assistant message 时才认为 turn 结束。源码证据：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/session/turn.rs:130`。

关键结构：

- 每个 turn 先做 pre-sampling compaction、上下文注入、skills/plugins 注入、hooks，再进入循环。见 `/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/session/turn.rs:135` 到 `221`。
- 每轮都从 history 构造 `Vec<ResponseItem>`，调用 `run_sampling_request`。见 `/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/session/turn.rs:235` 到 `256`。
- sampling 后会判断 `model_needs_follow_up`、pending input、token limit，并可能 mid-turn auto-compact 后继续。见 `/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/session/turn.rs:258` 到 `323`。

这意味着 Codex 的“智能”不只在模型里，而是在这个 turn loop 里：工具结果、用户中途输入、上下文压缩、钩子阻断、重试都能改变下一次模型请求。

### 2. Codex 把工具 schema 原生传给模型

Codex 构建 Prompt 时会把 `router.model_visible_specs()` 放进 `tools`，并带上 `parallel_tool_calls`。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/session/turn.rs:957`。

真正发给 OpenAI Responses API 的请求包含：

- `tools`
- `tool_choice: "auto"`
- `parallel_tool_calls`
- `stream: true`
- reasoning / output schema / prompt cache key

源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/client.rs:737` 到 `787`。

所以 Codex 不是用 prompt 让模型“自己吐 JSON 表示想调用工具”，而是让模型用模型协议里的工具调用能力输出结构化 tool call。

### 3. Codex 的工具路由和工具执行是独立层

Codex 的 `ToolRouter` 持有两件事：

- `ToolRegistry`：真正能执行的工具。
- `model_visible_specs`：模型能看到的工具规格。

源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/router.rs:34` 到 `60`。

模型输出的 `ResponseItem::FunctionCall`、`ToolSearchCall`、`CustomToolCall` 会被统一转成 `ToolCall`。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/router.rs:96` 到 `142`。

工具执行时会进入 `ToolRegistry.dispatch_any_with_terminal_outcome`，这里会：

- 记录 active turn 的 tool call 数。
- 找工具是否存在。
- 检查 payload 类型。
- 通知 tool start。
- 执行 pre-tool hooks，可以阻断或改写输入。
- 执行工具并写遥测、trace、hook 结果。

源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/registry.rs:408` 到 `535`。

并发工具调用由 `ToolCallRuntime` 控制：支持并发的工具拿 read lock，不支持并发的工具拿 write lock；工具错误会转成模型可见的 tool output，fatal 才终止。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/parallel.rs:63` 到 `133`。

### 4. Codex 的执行安全不是只靠 prompt，而是靠运行时沙箱和审批

Codex 在 core README 里说明 macOS 依赖 `/usr/bin/sandbox-exec`；workspace-write 允许写入配置的 writable roots，同时保持 `.git`、resolved gitdir、`.codex` 只读；网络和读写根由 `SandboxPolicy` 控制。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/README.md:9` 到 `18`。

审批层有 `ApprovalStore` 和 `with_cached_approval`，支持 session 内缓存批准。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/sandboxing.rs:40` 到 `116`。

exec 工具会基于 approval policy 和 filesystem sandbox policy 得到 `ExecApprovalRequirement`，可能是 skip、needs approval 或 forbidden。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/sandboxing.rs:158` 到 `235`。

shell 执行入口还会处理：

- sandbox override 是否允许。
- additional permissions 是否已经被批准。
- `apply_patch` 拦截。
- command output streaming。
- network 与 sandbox permissions。

源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:145` 到 `285`。

这就是 Codex 可以让模型执行本地开发任务的核心原因：模型能请求工具，但执行权、文件系统边界、网络边界、审批边界由 runtime 控制。

### 5. Codex 有完整 active turn 生命周期

Codex session 同一时间只有一个 running task，可以被用户输入中断。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/session/session.rs:20`。

启动 task 时会：

- abort 旧 task。
- 建立 cancellation token。
- 记录 token baseline。
- 发 turn start lifecycle。
- 维护 active turn 和 pending input。

源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tasks/mod.rs:305` 到 `365`。

结束时会：

- 处理 pending input。
- 计算 turn token usage。
- 发 TurnComplete。
- 清理 active turn。

源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tasks/mod.rs:574` 到 `785`。

中断路径会取消 task，清理 pending input，并在 interrupted 时启动后续 pending work。源码：`/Users/hao/project/Joi/reference/openai-codex/codex-rs/core/src/tasks/mod.rs:488` 到 `571`。

## Joi 当前工作方式

### 1. Joi 有很好的 Agent OS 产品底座

`AI_START_HERE.md` 的目标链路是：

`Gateway -> Orchestrator Core -> Session Manager -> Router -> Policy Engine -> Memory OS -> Agent Runtime -> Capability Request -> Tool Compiler -> Node Scheduler -> Tool Runtime / Worker Runtime -> Run Trace -> Response`

源码：`/Users/hao/project/Joi/AI_START_HERE.md:9` 到 `35`。

架构红线很清楚：

- Orchestrator Core 是代码，不是 LLM。
- Agent 是岗位，模型是执行引擎。
- 模型不得直接执行底层工具。
- Agent 只能请求 Capability，Tool Compiler 再编译成固定 Tool Workflow。
- 每一次消息、路由、记忆召回、模型调用、工具执行、节点派发都必须写入 Run Trace。

源码：`/Users/hao/project/Joi/AI_START_HERE.md:89` 到 `105`，以及 `/Users/hao/project/Joi/AGENTS.md:100` 到 `117`。

这些方向是对的，不需要推翻。要做的是把 Codex 式 runtime 接到这套底座上。

### 2. Joi 的 schema 已经很完整

Joi SQLite schema 已经有：

- `models`，包含 `supports_json_mode`、`supports_tool_calling`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:16` 到 `33`。
- `agents`、`capabilities`、`tools`、`tool_workflows`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:35` 到 `92`。
- `mcp_servers`、`mcp_inventory_items`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:94` 到 `128`。
- `skill_definitions`、`skill_runs`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:130` 到 `157`。
- `runs`、`run_steps`、`prompt_assemblies`、`model_calls`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:212` 到 `318`。
- `nodes`、`tasks`、`task_attempts`、`tool_runs`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:336` 到 `424`。
- `product_tasks`、`artifacts`、`open_loops`、`proactive_messages`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:426` 到 `534`。
- `memories`、`memory_fts`、`memory_usage_logs`、`memory_feedback`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:544` 到 `618`。
- `confirmations`、`confirmation_requests`。源码：`/Users/hao/project/Joi/database/sqlite/001_init_schema.sql:620` 到 `646`。

这是 Joi 的优势。Codex 更像 coding-agent runtime，Joi 更像 Personal Agent OS。Joi 不应该照抄 Codex 的产品边界，而应该吸收 Codex 的 runtime 能力。

### 3. Joi 当前桌面 runtime 是 JSON 文本协议

`sendSQLiteChat` 会创建 conversation/message/run，然后调用 `runSQLiteAgentRuntime`。但当前代码在 run 创建时直接把 `runs.status` 写成 `succeeded`，`finished_at=datetime('now')`，`duration_ms=0`。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:1383` 到 `1398`。

`runSQLiteAgentRuntime` 的模型循环只有 3 个 turn、最多 2 次 capability、最多 3 次 model call。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:1607` 到 `1615`。

每轮流程是：

1. `insertSQLitePromptAssembly`
2. `invokeAndRecordSQLiteModel`
3. `parseDesktopAgentOutput(modelResponse.Content)`
4. switch `output_type`
5. 如果是 `capability_request`，后端执行白名单 capability
6. 工具结果有时直接变成 final answer，有时拼成 `DYNAMIC_CONTEXT` 后继续下一轮

源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2009` 到 `2312`。

模型输出失败时会直接终止：`模型输出不是 Runtime v0 允许的 JSON 结构，本轮已停止。` 源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2057` 到 `2074`。

assistant “流式”是最终文本按 14 个 rune 切块再 sleep 8ms，不是模型 SSE。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2345` 到 `2395`。

### 4. Joi 当前模型调用没有 tool calling

Joi `callOpenAICompatibleOnce` 调用 `/v1/chat/completions`，请求体只有：

- `model`
- `messages`
- `temperature`
- 可选 `response_format: json_object`

没有 `tools`、没有 `tool_choice`、没有 streaming。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/store/model.go:345` 到 `365`。

响应读取只取 `choices[0].message.content` 字符串。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/store/model.go:587` 到 `604`。

桌面 runtime 写入模型时还把 `supports_tool_calling` 固定写成 0。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2622` 到 `2637`。

这就是 GPT 接入后不像 Codex 的根因：GPT 的工具调用能力没有进入协议层，Joi 只是要求 GPT 按 prompt 吐 JSON。

### 5. Joi 当前 Capability Compiler 值得保留，但执行面太窄

`CompileCapability` 已经做了非常正确的事情：

- canonical capability。
- semantic registry 校验。
- destructive/unsafe 拒绝。
- state_change 创建 confirmation 并拒绝本轮执行。
- 检查 capability、workflow、tool 是否 enabled。
- 检查风险是否超过请求范围。

源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/store/capability_compiler.go:18` 到 `76`。

这是 Joi 的安全优势。但执行能力当前主要是：

- `server_diagnose`
- `web_research` / `browser_read`，实际都是 HTTP fetch。
- `system_health_check`
- `desktop_app_list` / `desktop_app_inspect`
- `computer_observe`
- `workspace_search`
- `file_analyze`

源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/store/capability.go:208` 到 `227`，以及 `/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2741` 到 `2749`。

其中 `computer_observe` 只是返回 Joi 当前窗口的静态元数据，不真正观察屏幕，也不操作电脑。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/store/capability.go:230` 到 `262`。

`workspace_search` 是 Go `WalkDir` + 文本匹配，`file_analyze` 是受限扩展名的 bounded read，不支持编辑。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/workspace_capabilities.go:39` 到 `190`。

Worker scheduler 目前只允许 `web_research` 和 `system_health_check` 上 worker。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/store/node_scheduler.go:177` 到 `184`。

## 差距矩阵

| 维度 | Codex | Joi 当前 | 差距判断 |
| --- | --- | --- | --- |
| 模型协议 | Responses API stream + native tools + `tool_choice:auto` + `parallel_tool_calls` | Chat Completions 文本 content + JSON mode | P0，最大差距 |
| Turn loop | 多次 sampling，工具结果作为 response item 回灌，pending input/compact/retry | 最多 3 次模型调用，工具结果拼 dynamicContext 或直接 final | P0 |
| 工具路由 | ToolRouter + ToolRegistry + model-visible specs + dynamic/MCP/deferred tools | Capability whitelist + compiler，模型看不到原生 tool specs | P0 |
| 本地执行 | shell、apply_patch、MCP、browser/computer 等 runtime，并有沙箱/审批 | 只读诊断、HTTP fetch、workspace search、bounded read | P0/P1 |
| 沙箱/审批 | OS sandbox、permission profile、approval cache、hooks | risk 字段、confirmation request、path allowlist | P1，安全模型不够接近 Codex |
| 实时体验 | SSE/WebSocket 事件、工具卡、输出 delta、token/turn diff | 最终文本切块模拟 delta，run_steps 多为事后 succeeded | P1 |
| 中断/继续 | active turn、cancel token、pending input、interrupt API | 缺少真实 active turn 状态机 | P1 |
| Memory OS | Codex 有记忆/上下文机制，但不是 Personal OS 核心 | Joi 有 memories、FTS、usage、feedback、context pack | Joi 优势，保留 |
| Product Task/Artifact | Codex 不以此为主 | Joi schema 和流程更强 | Joi 优势，保留 |
| Worker/Node | Codex 本地/云/worktree 更偏 coding agent | Joi 有 worker gateway 和 node scheduler | Joi 方向正确，但不是当前最短板 |

## 最重要优化点 1：GPT Tool-Calling Turn Runtime

### 当前问题

Joi 现在的模型协议是 Runtime v0：

```text
Prompt 要求模型输出 JSON
  ↓
后端读 choices[0].message.content
  ↓
parseDesktopAgentOutput
  ↓
按 output_type 分支
```

这个协议在 mock/demo 下能跑，但接入真实 GPT 后会有几个硬问题：

1. 模型不知道真实工具 schema，只知道 prompt 里描述的字符串协议。它不会像 Codex 那样由协议层约束参数类型、call_id、tool output。
2. JSON 稍微不合规就会 parse_failed 并终止；Codex 的工具错误会回给模型，让模型修正下一步。
3. 工具结果不是统一的 tool output item，而是后端决定“直接 final answer”或拼进 dynamicContext。这样 GPT 不能稳定地基于工具结果继续推理。
4. `supports_tool_calling` 在桌面 runtime 被写成 0，即使模型本身支持工具调用，Joi 也不会启用。
5. 没有真实 streaming，用户无法看到模型正在思考/调用哪个工具/工具参数是什么。

### 要优化成什么

新增一个 Codex-like `TurnRuntime`，但保持 Joi 的架构红线：模型不能直接执行底层工具，模型只能请求 Capability。最推荐的形态是“Capability-as-Tool”：

- 模型可见工具不是 raw shell、raw SQL、raw file write。
- 模型可见工具是 capability 级函数，例如：
  - `workspace_search`
  - `file_analyze`
  - `web_research`
  - `browser_observe`
  - `computer_observe`
  - `shell_command`，但作为受控 capability，不是任意 raw execution 权限
  - `apply_patch`，作为 workspace-write capability
  - `memory_search`
  - `memory_write_proposal`
- 每个 tool call 到后端后，仍然必须走 `ValidateCapabilityRequestWithRegistry -> CompileCapability -> ScheduleWorkerNode -> ToolRuntime`。

这样既能使用 GPT 原生 tool calling，又不违反 Joi 的“模型只能请求 Capability”红线。

### 需要新增/改造的模块

建议新增：

```text
services/orchestrator-core/internal/runtime/
  turn_runtime.go
  model_client.go
  openai_responses_client.go
  chat_completions_tools_client.go
  tool_router.go
  tool_spec_builder.go
  turn_history.go
  event_sink.go
```

核心接口：

```go
type TurnRuntime interface {
    RunTurn(ctx context.Context, input TurnInput) (*TurnResult, error)
    Interrupt(turnID string, reason string) error
    AppendUserInput(turnID string, message string) error
}

type ModelClient interface {
    StreamTurn(ctx context.Context, req ModelTurnRequest) (<-chan ModelEvent, error)
}

type ToolRouter interface {
    ModelVisibleTools(ctx context.Context, runID string, agentID string) ([]ToolSpec, error)
    Dispatch(ctx context.Context, call ToolCall) (*ToolResult, error)
}
```

`ModelClient` 要支持两种协议：

1. OpenAI official / GPT 优先：Responses API。
2. OpenAI-compatible fallback：Chat Completions `tools` / `tool_calls`。

JSON mode 只保留为 legacy fallback，不再作为主 runtime。

### 数据结构怎么接

Joi 现有 `prompt_assemblies`、`model_calls`、`run_steps` 都可以保留，但需要补 turn item 级别的结构。建议新增：

```sql
CREATE TABLE turn_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  role TEXT,
  call_id TEXT,
  tool_name TEXT,
  arguments TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed',
  provider_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

为什么不能只用 `run_steps`：

- `run_steps` 是面向 UI trace 的概览。
- `turn_items` 是面向模型下一次请求的精确历史。
- Codex 的 loop 能成立，是因为 history 里保存的是模型协议项：message、reasoning、tool call、tool output，而不是只有人类可读 trace。

### 新 runtime 的主循环

目标流程：

```text
create run(status=running)
  ↓
resolve route + memory context + active context
  ↓
build model-visible capability tools
  ↓
stream model events
  ↓
assistant delta -> emit event + store turn item delta
tool call -> store call item -> ToolRouter.Dispatch
  ↓
ToolRouter -> semantic gate -> CompileCapability -> permission/scheduler -> ToolRuntime
  ↓
store tool output item
  ↓
continue model request with previous items + tool output
  ↓
final assistant message
  ↓
finalize run(status=succeeded)
```

模型输出工具调用时，不要像现在一样立刻转成最终回答。除非某些 capability 明确是 terminal tool，否则工具结果都应该作为 tool output 回灌给模型，让 GPT 自己综合结果、处理错误、决定下一步。

### 验收标准

P0 验收用例：

1. 用户说：“在当前仓库里找 SendChat 的实现，然后说明它怎么调模型。”
   - GPT 必须先调用 `workspace_search`。
   - 再调用 `file_analyze`。
   - 最终回答必须引用工具返回的文件/行号。
   - 不能出现 `parse_failed`。
2. 用户说：“读 README，然后告诉我启动方式。”
   - 不能走硬编码 deterministic README path。
   - 必须由模型 tool call 触发 `file_analyze`。
3. 工具参数缺失时：
   - 工具返回 structured error。
   - GPT 下一轮应追问或修正参数。
   - 不能由 runtime 直接用固定中文终止。
4. GPT 输出普通回答时：
   - 没有 tool call 也能 final。
   - `model_calls.raw_response` 里保留原始 tool call / assistant item。
5. OpenAI GPT 能跑 Responses API。
6. 兼容 OpenAI-compatible 的 Chat Completions tool calls。
7. mock provider 能模拟 tool call，用于单元测试。

### 不要做的方向

- 不要继续堆 prompt 让模型“更严格输出 JSON”。这只能缓解，不能达到 Codex 的稳定性。
- 不要让模型直接输出 shell/SQL/file_write 并执行。要通过 capability-as-tool。
- 不要把所有工具结果都后端总结成 final answer。工具结果必须能回灌给模型。

## 最重要优化点 2：本地执行底座、沙箱与审批

### 当前问题

Joi 当前能力偏“只读业务工具”，不够像 Codex 的本地 coding agent：

- `workspace_search` 是有限文本搜索，不是通用 repo exploration。
- `file_analyze` 只能读有限扩展名和片段，不能编辑。
- `web_research` / `browser_read` 实际是 HTTP fetch，不是浏览器上下文。
- `computer_observe` 是静态占位，不是真实桌面观察。
- 没有 `shell_command`。
- 没有 `apply_patch`。
- 没有测试命令执行、构建命令执行、长进程管理、输出增量。
- 没有 Codex 式 workspace-write sandbox。

这会导致 GPT 即使能 tool call，也只能做“问答/读取/摘要”，做不了 Codex 最核心的工作：读代码、改代码、跑测试、看失败、再改。

### 要补的能力

按优先级补本地主节点能力：

#### P0 能力

1. `workspace_search`
   - 继续保留安全 allow roots。
   - 内部优先用 `rg`，没有 `rg` 再 fallback Go WalkDir。
   - 返回文件、行号、snippet、truncated、command metadata。
2. `file_read`
   - 比 `file_analyze` 更底层，支持按行范围读取。
   - 仍受 allowed roots、forbidden path、max bytes 限制。
3. `apply_patch`
   - 结构化 patch 工具。
   - 只能在 workspace-write roots 里改。
   - 记录 diff、changed files、失败原因。
4. `shell_command`
   - 支持短命令和长命令。
   - 支持 cwd、yield、max output tokens。
   - 支持 cancel。
   - 默认 read-only 或 workspace-write sandbox。
5. `test_command`
   - 可以先作为 shell_command 的 policy profile，不一定独立工具。
   - 识别 repo 常见命令：`go test`、`npm test`、`npm run build`、`cargo test`。

#### P1 能力

6. `browser_observe` / `browser_navigate` / `browser_click` / `browser_type`
   - 针对浏览器或本地内容检查，遵守本地规则：优先 browser use 或 computer use，Chrome 插件兜底，Playwright 最后。
   - 不能把当前 `browser_read` 等同于 HTTP fetch。
7. `computer_observe`
   - 从静态占位升级为真实 UI snapshot。
   - P1 先只读观察；P2 再加点击/输入。
8. `mcp_tool_call`
   - Joi 已有 MCP inventory 表，应把 MCP tools 转成 capability wrapper 或动态 model-visible tools。

### 权限模型

建议把 Codex 的权限思想转成 Joi 的 Permission Profile：

```text
read_only
  - 可读 workspace allowed roots
  - 禁止写文件
  - 网络默认按 policy

workspace_write
  - 可读 workspace allowed roots
  - 可写 workspace writable roots
  - .git、.codex、secret paths 默认只读或禁止
  - apply_patch 可用

danger_full_access
  - 只在用户明确切换或批准后使用
  - 所有高风险仍写 trace
```

Joi 已经有 `workspace.allowed_roots` 和 forbidden path。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/workspace_settings.go:14` 到 `18`，`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/workspace_settings.go:98` 到 `122`。

但 allowlist 不是沙箱。接近 Codex 需要至少两层：

1. Runtime policy：Capability Compiler、risk、confirmation、allow roots。
2. OS enforcement：macOS 用 `sandbox-exec` 或等价机制，对 shell/apply_patch/file write 加实际文件系统限制。

### 审批模型

现在 Joi 的 confirmation request 创建后，本轮基本结束，批准不会自然恢复原工具。要改成：

```text
tool call needs approval
  ↓
run.status = waiting_confirmation
turn item status = waiting_confirmation
confirmation_request created with call_id/run_id
  ↓
user approves
  ↓
runtime resumes same tool call
  ↓
tool output stored
  ↓
model gets tool output and continues
```

这和 Codex 的 approval cache 类似：一次批准可以是 one-shot，也可以是 approved_for_session。Joi 可以用 `confirmation_requests` 加字段实现：

- `call_id`
- `approval_scope`：`once | session | workspace`
- `approval_key`
- `resumed_at`
- `expires_at`

### Tool Runtime 的统一事件

每个工具都要统一输出这些事件：

```text
tool.started
tool.args
tool.output.delta
tool.finished
tool.failed
tool.blocked
```

shell 还要支持 stdout/stderr 增量：

```text
shell.output.delta {
  stream: "stdout" | "stderr",
  text: "...",
  truncated: false
}
```

### 验收标准

P0 验收用例：

1. 用户说：“在 Joi 里找到模型调用代码，把它改成支持 tool_calls，然后跑相关测试。”
   - GPT 能搜索代码。
   - GPT 能读文件。
   - GPT 能 apply_patch。
   - GPT 能执行测试命令。
   - 失败时能继续改。
2. `workspace_write` 下不能写出 allowed root。
3. `.env`、`.ssh`、Keychain、浏览器 profile 等 forbidden path 仍被拒绝。
4. `apply_patch` 改动必须写入 `tool_runs` 和 `turn_items`。
5. shell command 被取消后 run/turn 状态正确。
6. 浏览器类请求必须优先走 Browser/Computer 能力，不把动态页面误当普通 HTTP fetch。

### 不要做的方向

- 不要先做远程 worker 扩容。主节点能力还不完整时，worker 只是把不完整的能力分发出去。
- 不要只做 `file_write` 字符串覆盖。Codex 体验依赖 patch、diff、测试反馈闭环。
- 不要用 prompt 安全替代沙箱。模型会犯错，边界必须在 runtime。

## 最重要优化点 3：Turn 生命周期、实时事件与可恢复状态机

### 当前问题

Joi 当前 Run Trace 是强项，但它更像“事后写记录”，不是 Codex 那种 active turn runtime。

具体问题：

1. `sendSQLiteChat` 创建 run 时直接 `status='succeeded'`、`finished_at=now`。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:1397`。
2. `insertSQLiteRunStep` 默认把每个 step 写成 `status='succeeded'`、`finished_at=now`、`duration_ms=0`。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2572` 到 `2580`。
3. assistant delta 是最终 response 的模拟切块。源码：`/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go:2365` 到 `2376`。
4. 没有 active turn、pending input、interrupt、steer、resume 的核心状态。
5. confirmation request 是“创建并拒绝本轮”，不是“暂停并可恢复”。
6. Worker queued 后返回“已交给后台”，但原始 turn 如何恢复、如何把 worker result 回灌给模型，还没有形成 Codex 式闭环。

### 要优化成什么

把 Joi 的 run trace 升级成 runtime 状态机：

```text
runs.status:
  pending
  running
  waiting_tool
  waiting_confirmation
  waiting_user
  queued
  succeeded
  failed
  aborted

turns.status:
  running
  waiting_tool
  waiting_confirmation
  waiting_user
  completed
  aborted
```

建议新增：

```sql
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  active_model_call_id TEXT,
  cancellation_key TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`run_steps` 继续给 UI 展示，`run_events` 给实时事件流，`turn_items` 给模型历史。三者职责不同：

- `turn_items`：模型协议历史。
- `run_events`：实时 UI/event sourcing。
- `run_steps`：人类可读的 trace 概览。

### API 要补什么

建议 AppCore/桌面 API 增加：

```text
StartTurn
AppendTurnInput
InterruptTurn
ResumeTurn
ApproveConfirmation
RejectConfirmation
ListActiveRuns
StreamRunEvents
```

`SendChat` 可以保留为高层入口，但内部不应该是一次同步事务包完整个 agent runtime。它应该创建 run/turn，然后由 runtime 推事件。

### 实时事件最小集合

```text
turn.started
prompt.assembled
model.started
assistant.delta
reasoning.delta
tool.call.started
tool.args.delta
tool.started
tool.output.delta
tool.finished
tool.failed
approval.requested
approval.resolved
token.count
turn.diff
turn.completed
turn.aborted
```

这些事件会让 UI 真正像 Codex：用户能看到 agent 正在调用哪个工具、参数是什么、输出是否还在流、是否等确认、是否被中断。

### 中断与继续

Codex 的 active turn 只允许一个 running task，并能 abort。Joi 需要同等概念：

- 一个 conversation 可有 active run。
- 一个 run 可有 active turn。
- active turn 持有 cancellation token。
- shell/browser/computer/tool runtime 都要接收 context cancel。
- 用户新输入时：
  - 如果只是补充信息，进入 pending input。
  - 如果是打断，abort 当前 tool/model call。
  - 如果是 steer，作为下一次 model request 的 input。

### Confirmation 恢复

state_change 或 workspace_write 请求不应简单结束。应该：

1. 创建 confirmation request。
2. 暂停 turn。
3. UI 显示待确认。
4. 用户批准。
5. 原 call_id 恢复执行。
6. 工具结果回灌给模型。
7. 模型继续 final answer。

这点非常重要，因为 Codex 的用户体验不是“被拒绝后你重新问一遍”，而是“我批准后继续刚才那一步”。

### 验收标准

1. 长命令执行中点击停止，run 变 `aborted`，tool_run 变 `aborted`，UI 不再继续输出。
2. 工具等待确认时，run 变 `waiting_confirmation`，批准后同一个 run 继续，不创建一个断裂的新 run。
3. 工具失败后，错误以 tool output 形式回给 GPT，GPT 能继续修正。
4. 模型 streaming delta 不是最终文本切块，而是 provider 事件。
5. Worker queued 任务完成后，结果能进入同一个 run trace，并可选择让模型继续总结。
6. 每个 run 的 `duration_ms`、step duration、token usage 与真实执行一致。

## 当前不应该优先做的事

以下都重要，但不是“像 Codex”最短路径：

1. 多 Agent 群聊。当前差距在单 agent runtime 闭环，不在 agent 数量。
2. 远程 worker 扩容。主节点还不能完整执行 coding task，先扩 worker 没意义。
3. 更复杂的模型路由。先让一个 GPT 模型在一个 turn runtime 里稳定用工具。
4. UI 大改版。没有 runtime 事件，UI 只能展示假流式和事后 trace。
5. Prompt 大重写。prompt 可以辅助，但不能代替 tool-calling protocol。
6. Proactive/Artifact 新功能。它们是 Joi 长期优势，但不是 Codex parity 的 P0。

## 推荐落地路线

### Milestone 0：保留现状，切出新 runtime 开关

目标：不要把现有桌面可用链路打断。

- 新增 `runtime_mode = legacy_json | tool_calling`。
- 默认仍可 legacy，但 dev/dogfood 使用 tool_calling。
- mock provider 增加 tool-call 模拟。
- 所有新 runtime 写同一套 `runs/run_steps/model_calls/tool_runs`，额外写 `turns/turn_items/run_events`。

### Milestone 1：只让 GPT 原生调用现有 read-only capabilities

目标：先证明 tool-calling loop 成立。

接入：

- `memory_search`
- `workspace_search`
- `file_analyze`
- `web_research`
- `system_health_check`

不要先做 shell/edit。先让 GPT 能“找文件 -> 读文件 -> 总结”。

验收：

- 真实 GPT 能基于 tool output 继续推理。
- 没有 parse_failed。
- `turn_items` 可重放出完整模型历史。

### Milestone 2：加入 apply_patch 与 shell_command

目标：进入 Codex 核心 coding loop。

接入：

- `apply_patch`
- `shell_command`
- `test_command`
- workspace-write permission profile
- approval cache
- command output delta

验收：

- GPT 能做小型代码修改并跑测试。
- 失败后能读错误继续修。
- 所有写操作受 workspace roots 和 sandbox 限制。

### Milestone 3：真实浏览器/电脑能力

目标：接近 Codex app 的本地检查体验。

接入：

- Browser bridge 优先。
- Computer Use 只读观察。
- Chrome fallback。
- Playwright 作为最后兜底。

验收：

- 本地页面/浏览器状态不是 HTTP fetch 伪装。
- 操作前有权限边界。
- UI 事件能展示截图/观察摘要/动作结果。

### Milestone 4：可恢复 turn lifecycle

目标：体验接近 Codex。

接入：

- interrupt
- pending input / steer
- confirmation resume
- worker result resume
- token usage / turn diff

验收：

- 用户可以中断、批准、继续，不丢 trace。
- 同一 run 内能看到完整状态变化。

## 最终 Codex-like 验收任务

当下面任务能在 Joi 里稳定完成，才可以说“接入 GPT 后用起来跟 Codex 差不太多”：

```text
请在当前 Joi 仓库里：
1. 找到模型调用和 agent runtime 的实现。
2. 修改它，让 OpenAI-compatible provider 支持 tool calls。
3. 加一个单元测试覆盖 tool call -> capability execution -> tool output -> final answer。
4. 跑测试。
5. 如果失败，继续修到通过。
6. 最后总结改了哪些文件、为什么。
```

这个任务需要同时覆盖：

- repo search
- file read
- model tool call
- tool dispatch
- apply_patch
- shell/test command
- tool error recovery
- final answer synthesis
- run trace
- interrupt/approval 至少不破坏流程

如果 Joi 做不到这个闭环，它就还不是 Codex-like agent，只是带工具按钮的聊天系统。

## 总结

Joi 的方向不是错的，甚至产品底座比很多 agent demo 更扎实。真正的问题是底层 agent runtime 还停在 Runtime v0：模型用 JSON 字符串表达意图，后端用有限 capability 执行，再用代码或 dynamic context 拼回结果。Codex 的关键不是“有很多工具”，而是工具调用、执行、安全、事件、历史都在同一个 turn runtime 里闭环。

所以最重要的 3 个优化点必须按顺序做：

1. 原生 GPT tool-calling turn loop。
2. 本地执行底座 + 沙箱/审批。
3. active turn 生命周期 + 真实事件流 + 可恢复状态。

先把这 3 点打穿，再做 worker、UI、proactive、artifact，Joi 才会从“Personal Agent OS 的雏形”变成“真正能像 Codex 一样干活的本地 agent”。
