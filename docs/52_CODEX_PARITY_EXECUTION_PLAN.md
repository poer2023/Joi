# Codex Parity 三大优化点执行手册

日期：2026-06-04

目标：把 `docs/51_CODEX_PARITY_GAP_ANALYSIS.md` 里的 3 个优化点拆成可以直接执行的工程计划。执行本手册后，Joi 的 GPT 接入应从“模型输出 JSON 字符串”升级为“模型可原生调用 capability 工具、工具结果回灌模型、本地执行有权限边界、运行过程可中断可恢复”的 Codex-like runtime。

适用仓库：`/Users/hao/project/Joi`

## 总执行原则

1. 不要推翻现有 Joi 架构红线。
   - Orchestrator Core 仍然是代码。
   - Agent 仍然是岗位，模型仍然是执行引擎。
   - 模型不能直接执行 raw shell / SQL / file_write。
   - 模型只能请求 Capability；Capability 仍然必须过 Tool Compiler。
2. 不要一次性替换 `sendSQLiteChat`。
   - 先保留 legacy JSON runtime。
   - 新增 `tool_calling` runtime mode。
   - 只有测试和 dogfood 明确启用新 runtime。
3. 不要只改 prompt。
   - prompt 只是辅助。
   - 主改动必须在模型协议、turn loop、tool router、tool runtime、run state。
4. 所有新能力必须写 trace。
   - `turn_items`：给模型重放历史。
   - `run_events`：给 UI 实时流。
   - `run_steps`：给人类看执行概览。
   - `tool_runs`：给工具执行审计。
5. 每个阶段必须有测试，不能靠手动点 UI 验收。

推荐执行分支：

```bash
cd /Users/hao/project/Joi
git checkout -b codex-parity-runtime
```

基础验证命令：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/store ./internal/appcore
go run ./cmd/sqlite-migration-check

cd /Users/hao/project/Joi/apps/joi-desktop/frontend
npm run build
npm run test:execution-actions

cd /Users/hao/project/Joi
pnpm test:store
pnpm test:electron-contract
pnpm build:electron
```

## 优化点 1：GPT Tool-Calling Turn Runtime

### 目标

把 Joi 当前的 Runtime v0：

```text
模型输出 JSON 字符串
  -> parseDesktopAgentOutput
  -> capability_request 分支
  -> 后端执行 capability
  -> 直接 final 或拼 dynamicContext
```

升级为：

```text
模型原生 tool call
  -> ToolRouter 转成 CapabilityRequest
  -> semantic gate
  -> Tool Compiler
  -> Tool Runtime
  -> tool output item 回灌模型
  -> 模型继续推理
  -> final answer
```

### 实施顺序总览

按这个顺序做，不要跳：

1. 增加 DB 表：`turns`、`turn_items`、`run_events`。
2. 增加 runtime mode 开关。
3. 定义 model/tool/turn 的内部类型。
4. 构建 model-visible capability tool specs。
5. 实现 mock tool-calling model client。
6. 实现 Chat Completions tool_calls client。
7. 实现 OpenAI Responses client。
8. 实现 ToolRouter.Dispatch。
9. 实现 `RunToolCallingTurn` 主循环。
10. 把 `sendSQLiteChat` 接到新 runtime，但默认仍可 legacy。
11. 补测试。

### 1.1 增加 DB 表

修改文件：

- `/Users/hao/project/Joi/database/sqlite/001_init_schema.sql`
- `/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/sqlite_schema.sql`

如果 `internal/appcore/sqlite_schema.sql` 是从 `database/sqlite/001_init_schema.sql` 复制来的，改完后保持两份一致。

新增表：

```sql
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  active_model_call_id TEXT,
  cancellation_key TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE(run_id, turn_index)
);

CREATE TABLE IF NOT EXISTS turn_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
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
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, seq)
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_turns_run_id ON turns(run_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_turn_items_run_id ON turn_items(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_turn_items_call_id ON turn_items(call_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, seq);
```

完成定义：

- `go run ./cmd/sqlite-migration-check` 通过。
- 重复 apply schema 不报错。
- `GetRunTrace` 旧接口不受影响。

### 1.2 增加 runtime mode 开关

修改文件：

- `/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go`
- `/Users/hao/project/Joi/apps/joi-electron/src/main/ipc.ts`
- `/Users/hao/project/Joi/apps/joi-desktop/frontend/src/api/desktop.ts`

`ChatRequest` 增加字段：

```go
RuntimeMode string `json:"runtime_mode"`
```

合法值：

```text
legacy_json
tool_calling
```

选择规则：

```go
func normalizedRuntimeMode(req ChatRequest, cfg Config) string {
    if req.RuntimeMode == "tool_calling" {
        return "tool_calling"
    }
    if req.RuntimeMode == "legacy_json" {
        return "legacy_json"
    }
    if os.Getenv("JOI_RUNTIME_MODE") == "tool_calling" {
        return "tool_calling"
    }
    return "legacy_json"
}
```

完成定义：

- 默认行为仍走 legacy。
- 测试能通过 `ChatRequest{RuntimeMode:"tool_calling"}` 启用新 runtime。
- 桌面 UI 暂时不必暴露开关，但 API 类型要保留字段。

### 1.3 定义内部类型

新增目录：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/
```

新增文件：

```text
types.go
model_client.go
tool_router.go
history_store.go
event_store.go
runtime.go
```

`types.go`：

```go
package turnruntime

type TurnInput struct {
    RunID          string
    ConversationID string
    UserMessageID  string
    AgentID        string
    Message        string
    ModelID        string
    ModelName      string
    Provider       string
    CacheablePrefix string
    DynamicTail     string
    PromptCacheKey  string
    EventSink       func(string, map[string]any)
}

type ToolSpec struct {
    Name        string         `json:"name"`
    Description string         `json:"description"`
    Parameters  map[string]any `json:"parameters"`
    Risk        string         `json:"risk"`
    Capability  string         `json:"capability"`
}

type ModelEvent struct {
    Type      string
    TextDelta string
    Message   string
    ToolCall  *ToolCall
    Usage     *TokenUsage
    Raw       map[string]any
}

type ToolCall struct {
    ID        string
    Name      string
    Arguments map[string]any
}

type ToolResult struct {
    CallID string
    Name   string
    Output map[string]any
    Error  string
}

type TurnResult struct {
    FinalMessage string
    ModelCallIDs []string
    ToolRunIDs   []string
}
```

命名原则：

- `ToolCall.Name` 使用 model-visible tool name。
- 对 Joi 来说 tool name 和 capability name 可以一致，例如 `workspace_search`。
- 不要把 raw shell 暴露成无约束工具；即使叫 `shell_command`，也必须是受控 capability。

### 1.4 构建 model-visible capability tool specs

新增文件：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/tool_spec_builder.go
```

输入：

- `agents.capabilities`
- `capabilities.input_schema`
- `capabilities.description`
- `tool_workflows.enabled`
- `tools.enabled`

输出：

```go
func BuildToolSpecs(ctx context.Context, tx *sql.Tx, agentID string) ([]ToolSpec, error)
```

第一阶段只暴露 read-only capabilities：

```text
memory_search
workspace_search
file_analyze
web_research
system_health_check
```

不要第一阶段暴露：

```text
shell_command
apply_patch
file_write
browser_click
computer_click
```

每个 tool spec 要有 JSON schema。示例：

```go
ToolSpec{
    Name: "workspace_search",
    Description: "Search authorized workspace files and return file paths, line numbers, snippets, and truncation metadata.",
    Parameters: map[string]any{
        "type": "object",
        "properties": map[string]any{
            "query": map[string]any{"type": "string"},
            "root": map[string]any{"type": "string"},
            "glob": map[string]any{"type": "string"},
            "max_results": map[string]any{"type": "integer"},
        },
        "required": []string{"query"},
        "additionalProperties": false,
    },
    Risk: "read_only",
    Capability: "workspace_search",
}
```

完成定义：

- 单测能断言 `workspace_search`、`file_analyze` 工具 schema 可生成。
- disabled workflow/tool 不会出现在 model-visible specs。
- agent 没有声明的 capability 不会暴露。

测试文件：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/tool_spec_builder_test.go
```

### 1.5 实现 mock tool-calling model client

先写 mock，再写真实 OpenAI 客户端。原因：先用确定性事件验证 turn loop。

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/mock_model_client.go
```

接口：

```go
type ModelClient interface {
    StreamTurn(ctx context.Context, req ModelTurnRequest) (<-chan ModelEvent, error)
}

type ModelTurnRequest struct {
    ModelName string
    Instructions string
    Items []TurnItem
    Tools []ToolSpec
}
```

mock 行为：

- 如果用户消息包含 `SendChat`，先发 tool call `workspace_search`。
- 如果收到 `workspace_search` tool output，继续发 tool call `file_analyze`。
- 如果收到 `file_analyze` tool output，发 assistant final。
- 如果工具 output 有 error，发 assistant 解释错误并追问/修正。

完成定义：

- 不依赖真实 API。
- 能覆盖 tool call -> tool output -> final answer。

### 1.6 实现 Chat Completions tool_calls client

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/chat_completions_client.go
```

不要直接改坏 `store/model.go` 的 legacy path。建议新 runtime 单独实现 client；等稳定后再合并。

请求体：

```json
{
  "model": "...",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "workspace_search",
        "description": "...",
        "parameters": {}
      }
    }
  ],
  "tool_choice": "auto",
  "stream": true
}
```

必须解析：

- assistant text delta
- tool_calls delta
- final tool_calls
- usage
- provider error

如果某些 OpenAI-compatible provider 不支持 streaming tool_calls，允许先 fallback 非流式，但内部必须仍返回 `ModelEvent`。

完成定义：

- 能从非流式 response 解析：

```json
choices[0].message.tool_calls
```

- 能从 streaming chunks 聚合完整 arguments。
- `tool_calls` 不再被当成 `content missing` 错误。

### 1.7 实现 OpenAI Responses client

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/responses_client.go
```

目标是靠近 Codex，但可以作为第二个客户端。

请求形态：

```json
{
  "model": "...",
  "instructions": "...",
  "input": [...],
  "tools": [...],
  "tool_choice": "auto",
  "parallel_tool_calls": true,
  "stream": true
}
```

注意：

- Responses API 的 item 格式和 Chat Completions 不一样。
- `turn_items` 要存 Joi 内部统一格式，不要把 provider 格式直接散落到业务代码里。
- provider raw response 可以放 `metadata` 或 `model_calls.raw_response`。

完成定义：

- 新 runtime 可以通过 provider 配置选择 `responses` 或 `chat_completions_tools`。
- 同一个 turn loop 不关心底层 provider 协议。

### 1.8 实现 ToolRouter.Dispatch

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/joi_tool_router.go
```

接口：

```go
type CapabilityExecutor interface {
    ExecuteCapability(ctx context.Context, tx *sql.Tx, req store.CapabilityRequest) (*store.CapabilityExecutionResult, error)
}
```

AppCore 可以实现这个接口，内部复用现有：

```go
executeAndRecordSQLiteCapability(ctx, tx, request)
```

Dispatch 流程：

```text
ToolCall
  -> CanonicalCapabilityName
  -> build store.CapabilityRequest
  -> ValidateCapabilityRequestWithRegistry
  -> CompileCapability
  -> ScheduleWorkerNode
  -> execute local or enqueue worker
  -> ToolResult
```

错误处理：

- `ErrPolicyDenied` 不是 fatal；返回 tool output：

```json
{
  "status": "blocked",
  "error_code": "POLICY_DENIED",
  "message": "...",
  "capability": "..."
}
```

- `ErrMissingArgument` 返回 tool output，让模型下一轮补参数或追问。
- 只有 DB 写失败、provider 崩溃、context canceled 这类 runtime error 才终止 run。

完成定义：

- 工具错误会变成 tool output item。
- 模型下一轮能看到错误，而不是 runtime 直接 final。

### 1.9 实现 RunToolCallingTurn 主循环

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/runtime.go
```

伪代码：

```go
func (r *Runtime) RunTurn(ctx context.Context, input TurnInput) (*TurnResult, error) {
    turnID := createTurn(status=running)
    history := loadInitialItems(input)
    tools := BuildToolSpecs(...)

    for step := 0; step < maxModelSteps; step++ {
        modelEvents := client.StreamTurn(ctx, ModelTurnRequest{
            Instructions: input.CacheablePrefix,
            Items: history,
            Tools: tools,
        })

        var toolCalls []ToolCall
        var assistantText strings.Builder

        for event := range modelEvents {
            storeRunEvent(event)
            emitEvent(event)
            if event.TextDelta != "" { assistantText.WriteString(event.TextDelta) }
            if event.ToolCall != nil { toolCalls = append(toolCalls, *event.ToolCall) }
        }

        if len(toolCalls) == 0 {
            storeAssistantItem(assistantText.String())
            return final(assistantText.String())
        }

        for _, call := range toolCalls {
            storeToolCallItem(call)
            result := router.Dispatch(ctx, call)
            storeToolOutputItem(result)
            history = append(history, callItem, outputItem)
        }
    }

    return nil, ErrMaxTurns
}
```

限制：

- 第一阶段 `maxModelSteps = 6`。
- 第一阶段禁用 parallel tool calls，或者串行执行多个 tool calls。
- 不要在一个 DB transaction 里包完整 streaming turn。长事务会锁 SQLite。每个事件/step 单独短事务写入。

完成定义：

- 同一个 run 内至少能完成 `model -> tool -> model -> final`。
- tool output 存在 `turn_items`。
- UI 能收到 `assistant.delta` 和 `tool.*` 事件。

### 1.10 接入 sendSQLiteChat

修改：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go
```

当前 `sendSQLiteChat` 在创建 run 时直接写 `succeeded`。新 runtime 下要改：

```go
status := "succeeded"
finishedAt := "datetime('now')"
if runtimeMode == "tool_calling" {
    status = "running"
    finishedAt = "NULL"
}
```

更实际的 SQL 写法是分两条 insert，避免动态 SQL 复杂化。

接入点：

```go
if runtimeMode == "tool_calling" {
    runtimeResult, err = a.runSQLiteToolCallingRuntime(ctx, input)
} else {
    runtimeResult, err = a.runSQLiteAgentRuntime(ctx, tx, input)
}
```

注意：

- 新 runtime 不应该长时间持有 `sendSQLiteChat` 的原事务。
- 可以先把 conversation/user message/run 创建提交，再启动 tool-calling runtime。
- legacy path 保持原行为。

完成定义：

- legacy tests 继续通过。
- 新 tests 用 `RuntimeMode:"tool_calling"`。

### 1.11 测试清单

新增测试：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/tool_calling_runtime_test.go
```

测试 1：工具调用闭环

```go
func TestToolCallingRuntimeWorkspaceSearchFileAnalyzeFinalAnswer(t *testing.T)
```

断言：

- run.status = succeeded。
- run_steps 包含 `prompt_assembled`、`model_call_finished`、`capability_requested`、`tool_finished`、`response_generated`。
- turn_items 包含 `tool_call` 和 `tool_output`。
- response 不包含 `parse_failed`。

测试 2：工具错误回灌模型

```go
func TestToolCallingRuntimeToolErrorFeedsBackToModel(t *testing.T)
```

用例：

- mock model 请求 `file_analyze` 但不给 path。
- ToolRouter 返回 `MISSING_ARGUMENT` tool output。
- mock model 下一轮 final 追问 path。
- run 不应是 failed。

测试 3：legacy 不受影响

```go
func TestLegacyJSONRuntimeStillWorks(t *testing.T)
```

测试 4：disabled capability 不暴露

```go
func TestToolSpecBuilderHidesDisabledWorkflow(t *testing.T)
```

测试命令：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/turnruntime ./internal/appcore
```

## 优化点 2：本地执行底座、沙箱与审批

### 目标

让 GPT 能像 Codex 一样完成本地开发闭环：

```text
搜代码 -> 读文件 -> 改文件 -> 跑测试 -> 看错误 -> 再改 -> 总结
```

但仍然遵守 Joi 红线：

```text
模型只请求 Capability
Tool Compiler 决定能否执行
Tool Runtime 执行
权限/沙箱/审批兜底
```

### 实施顺序总览

1. 扩展 capability registry：`file_read`、`apply_patch`、`shell_command`、`test_command`。
2. 增加 permission profile。
3. 实现 `file_read`。
4. 优化 `workspace_search` 使用 `rg`。
5. 实现 `apply_patch`。
6. 实现 `shell_command` read-only profile。
7. 实现 workspace-write sandbox。
8. 实现 approval pause/resume。
9. 实现 browser/computer 真实能力。

### 2.1 扩展 capabilities/tools/workflows seed

修改：

- `/Users/hao/project/Joi/database/sqlite/001_init_schema.sql`
- `/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/sqlite_schema.sql`
- 可能还有 `/Users/hao/project/Joi/services/orchestrator-core/internal/store/tool_registry_v1.go`

新增 capability：

```text
file_read
apply_patch
shell_command
test_command
browser_observe
computer_observe_real
```

第一阶段风险：

```text
file_read: read_only
shell_command: read_only
test_command: read_only
apply_patch: workspace_write
browser_observe: read_only
computer_observe_real: private_read
```

新增 workflow：

```text
file_read_v1 -> file_read_bounded
shell_command_v1 -> shell_exec_sandboxed
test_command_v1 -> shell_exec_sandboxed
apply_patch_v1 -> patch_apply_workspace
browser_observe_v1 -> browser_snapshot
computer_observe_v2 -> computer_snapshot
```

完成定义：

- Console capability list 能看到新 capability。
- disabled workflow 不会被 tool spec builder 暴露。

### 2.2 Permission Profile

新增类型：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/permission_profile.go
```

类型：

```go
type PermissionProfile string

const (
    PermissionReadOnly PermissionProfile = "read_only"
    PermissionWorkspaceWrite PermissionProfile = "workspace_write"
    PermissionDangerFullAccess PermissionProfile = "danger_full_access"
)
```

规则：

```text
read_only:
  - 文件只读
  - shell 默认只能执行 read-only allowlist
  - 禁止 apply_patch

workspace_write:
  - 可以 apply_patch
  - 可以写 allowed writable roots
  - .git、.codex、.env、.ssh、Keychain、浏览器 profile 禁止或只读

danger_full_access:
  - 只允许用户明确选择或批准
  - 仍然必须写 run trace
```

配置来源：

1. `ChatRequest.PermissionProfile`，后续再加。
2. `desktop_settings["runtime.permission_profile"]`。
3. 默认 `read_only`。

完成定义：

- `apply_patch` 在 read_only 下返回 `confirmation_required` 或 `policy_blocked`。
- `file_read` 在 read_only 下可用。

### 2.3 实现 file_read

新增文件：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/file_read_capability.go
```

输入：

```json
{
  "path": "services/orchestrator-core/internal/store/model.go",
  "start_line": 1,
  "end_line": 120,
  "max_bytes": 65536
}
```

行为：

- 用 `ResolveWorkspacePath`。
- 拒绝 forbidden path。
- 拒绝目录。
- 支持任意文本扩展名，第一版可沿用 allowed ext。
- 返回：

```json
{
  "status": "completed",
  "path": "...",
  "start_line": 1,
  "end_line": 120,
  "content": "...",
  "truncated": false,
  "mode": "file_read_v1_bounded"
}
```

完成定义：

- 能读取当前仓库 Go/TS/MD 文件。
- 不能读取 `.env`、`~/.ssh`、workspace 外路径、symlink escape。

测试：

```go
func TestSQLiteFileReadCapabilityReadsLineRange(t *testing.T)
func TestSQLiteFileReadRejectsForbiddenPath(t *testing.T)
func TestSQLiteFileReadRejectsSymlinkEscape(t *testing.T)
```

### 2.4 优化 workspace_search 使用 rg

修改：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/workspace_capabilities.go
```

当前实现 Go WalkDir 可保留 fallback。新增路径：

```go
if rgAvailable() {
    return executeWorkspaceSearchWithRG(...)
}
return executeWorkspaceSearchWithWalkDir(...)
```

`rg` 命令建议：

```bash
rg --line-number --with-filename --no-heading --color never --hidden --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '<glob>' '<query>' '<root>'
```

注意：

- 不要用 shell 拼字符串；用 `exec.CommandContext(ctx, "rg", args...)`。
- root 必须先 `ResolveWorkspacePath`。
- 输出仍转成原来的 `results` schema，避免 UI 破坏。

完成定义：

- 有 `rg` 时 metadata.mode = `workspace_search_v2_rg`。
- 没 `rg` 时 fallback `workspace_search_v1_go_walk`。
- 测试不依赖机器必须安装 rg，可以用 dependency injection 或只断言 fallback。

### 2.5 实现 apply_patch

新增文件：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/apply_patch_capability.go
```

输入：

```json
{
  "patch": "*** Begin Patch\n*** Update File: ...\n...\n*** End Patch\n",
  "reason": "..."
}
```

策略：

- 只允许 workspace_write。
- patch 中每个文件路径必须：
  - 是相对路径或 allowed root 内绝对路径。
  - 通过 `ResolveWorkspacePath`。
  - 不在 forbidden path。
  - 不在 `.git`、`.codex`、`node_modules`。
- 第一版可以支持：
  - Add File
  - Update File
  - Delete File 先不开放，或者需要 confirmation。
- 每次 patch 前后记录：
  - changed_files
  - added_files
  - updated_files
  - rejected_files
  - diff_summary

实现建议：

第一版不要手写复杂 diff parser。可以：

1. 复用一个最小 patch parser，只解析 Codex apply_patch grammar 的文件头和变更块。
2. 用 Go 读写目标文件并应用 hunk。
3. 或者把 patch 转成临时文件，使用 `git apply --check` + `git apply`，但必须确认路径不会越界。

更稳妥的第一版：

- 只支持 simple update/add。
- 不支持 rename/delete。
- 不支持二进制。
- patch 失败返回 structured error 给模型。

完成定义：

- GPT 能通过 tool call 修改一个测试 fixture 文件。
- read_only 下被拒绝。
- workspace 外 path 被拒绝。
- patch 失败不会部分写入。
- `tool_runs.output.changed_files` 有值。

测试：

```go
func TestApplyPatchCapabilityUpdatesWorkspaceFile(t *testing.T)
func TestApplyPatchCapabilityRejectsReadOnlyProfile(t *testing.T)
func TestApplyPatchCapabilityRejectsPathEscape(t *testing.T)
func TestApplyPatchCapabilityIsAtomicOnFailure(t *testing.T)
```

### 2.6 实现 shell_command

新增文件：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/shell_command_capability.go
```

输入：

```json
{
  "cmd": ["go", "test", "./internal/appcore"],
  "cwd": "/Users/hao/project/Joi/services/orchestrator-core",
  "yield_time_ms": 1000,
  "max_output_bytes": 120000,
  "purpose": "run tests"
}
```

不要让模型传 raw string shell 第一版执行。第一版要求 `cmd` 是数组，避免 shell injection。后续如果要支持 raw shell，必须单独 `shell_string_command` 且高风险。

read_only allowlist：

```text
pwd
ls
find
rg
grep
sed
cat
git status
git diff
git log
go test
go test ./...
npm test
npm run build
npm run test:*
```

禁止：

```text
rm
mv
chmod
chown
sudo
curl | sh
brew install
npm install
git reset
git checkout --
docker rm
docker compose down -v
```

输出：

```json
{
  "status": "completed",
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "truncated": false,
  "duration_ms": 1234,
  "mode": "shell_command_v1_exec_context"
}
```

事件：

```text
tool.started
shell.output.delta
tool.finished
```

完成定义：

- `go test ./internal/appcore` 能执行并返回输出。
- context cancel 后进程停止。
- 禁止命令返回 `policy_blocked` tool output。

测试：

```go
func TestShellCommandRunsReadOnlyTestCommand(t *testing.T)
func TestShellCommandRejectsForbiddenCommand(t *testing.T)
func TestShellCommandCancellationMarksAborted(t *testing.T)
```

### 2.7 workspace-write sandbox

第一版可以分两层：

#### 2.7.1 Runtime 逻辑边界

先确保 Joi 自己的工具不越界：

- `file_read`
- `apply_patch`
- `workspace_search`
- `shell_command.cwd`

都必须走 `ResolveWorkspacePath`。

#### 2.7.2 OS sandbox

macOS 用 `sandbox-exec`。新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/sandbox_macos.go
```

接口：

```go
type SandboxRunner interface {
    Run(ctx context.Context, req SandboxExecRequest) (*SandboxExecResult, error)
}
```

read_only profile：

- allowed roots read-only。
- temp dir 可写。
- network 默认关闭，除非 capability 需要。

workspace_write profile：

- workspace writable roots 可写。
- `.git`、`.codex`、secret paths 只读或禁止。
- temp dir 可写。

完成定义：

- shell_command 在 sandbox 下不能写 workspace 外文件。
- workspace_write 下可以写测试临时 workspace 文件。
- `.git/config` 写入失败。

这一步复杂，可以作为独立 PR。不要阻塞 `file_read/apply_patch` 的逻辑边界测试。

### 2.8 approval pause/resume

先在优化点 3 的 turn 状态机完成后再做完整 resume。这里先定义工具层契约：

如果工具需要确认，ToolRouter 返回：

```json
{
  "status": "waiting_confirmation",
  "confirmation_id": "confirm_xxx",
  "call_id": "call_xxx",
  "capability": "apply_patch",
  "risk": "workspace_write"
}
```

不要直接 final answer。

完成定义：

- `apply_patch` 在 read_only profile 下创建 confirmation_request。
- run.status = `waiting_confirmation`。
- UI 能显示待确认。
- 批准后由优化点 3 的 resume 继续执行。

### 2.9 真实 browser/computer 能力

当前用户本地规则是：检查浏览器或本地内容时，优先 browser use 或 computer use，解决不了再 Chrome 插件，最后 Playwright。

实现顺序：

1. `browser_observe`
   - 先只读当前 browser snapshot。
   - 返回 title、url、visible text、screenshot ref 可选。
2. `browser_navigate`
   - 只允许 http/https。
   - localhost/private host 走 allowlist。
3. `computer_observe`
   - 替换当前静态 `executeComputerObserve`。
   - 第一版只读屏幕/窗口，不点击。
4. `browser_click` / `browser_type`
   - 需要 confirmation 或 interaction permission。

完成定义：

- 动态网页不能被 `web_research` 假装读取。
- browser 工具失败时能 fallback 到 computer 或返回明确错误。
- 不默认使用 Playwright。

## 优化点 3：Turn 生命周期、实时事件与可恢复状态机

### 目标

把 Joi 从“同步函数执行后写 trace”升级成“active run/turn 状态机”。

当前问题：

- `runs` 创建时就可能是 `succeeded`。
- `run_steps` 默认都是 `succeeded`。
- assistant delta 是后处理假流式。
- 没有 active turn cancellation。
- confirmation 不能恢复原工具。
- worker queued 不能自然回灌同一个模型 turn。

### 实施顺序总览

1. 修正新 runtime 下 run 创建状态。
2. 新增 `RunEventStore`。
3. 新增 `TurnManager`。
4. 新增 cancellation registry。
5. 所有 model/tool 事件写 `run_events`。
6. 桌面事件流读取真实事件。
7. 实现 interrupt。
8. 实现 confirmation resume。
9. 实现 worker result resume。

### 3.1 新 runtime 下 run 状态必须真实

legacy path 可暂时不动。tool_calling path 必须：

```text
创建 run: pending/running
模型调用中: running
工具执行中: waiting_tool 或 running
等确认: waiting_confirmation
完成: succeeded
失败: failed
取消: aborted
```

改动点：

- `/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/appcore.go`

新 runtime 不使用这条旧 insert：

```sql
INSERT INTO runs (...) VALUES (..., 'succeeded', ..., finished_at=datetime('now'), duration_ms=0)
```

而是：

```sql
INSERT INTO runs (..., status, ..., finished_at, duration_ms)
VALUES (..., 'running', ..., NULL, NULL)
```

完成定义：

- tool_calling runtime 执行中查询 run 是 `running`。
- 结束后才是 `succeeded`。
- 失败时是 `failed` 并写 error_code/error_message。

### 3.2 RunEventStore

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/turnruntime/event_store.go
```

接口：

```go
type EventStore interface {
    AppendRunEvent(ctx context.Context, runID string, turnID string, eventType string, payload map[string]any) error
    ListRunEvents(ctx context.Context, runID string, afterSeq int) ([]RunEvent, error)
}
```

实现要求：

- 每个 run 的 seq 单调递增。
- 事件写 DB 后再发 EventSink。
- EventSink 失败不影响 DB 写入。

事件最小集合：

```text
run.started
turn.started
prompt.assembled
model.started
assistant.delta
model.completed
tool.call.started
tool.started
tool.output.delta
tool.finished
tool.failed
approval.requested
approval.resolved
turn.completed
turn.aborted
run.completed
run.failed
```

完成定义：

- `run_events` 可重放 UI 事件。
- 桌面当前 EventSink 仍能收到事件。

### 3.3 TurnManager 与 cancellation registry

新增：

```text
/Users/hao/project/Joi/services/orchestrator-core/internal/appcore/turn_manager.go
```

结构：

```go
type ActiveTurn struct {
    RunID string
    TurnID string
    ConversationID string
    Cancel context.CancelFunc
    StartedAt time.Time
}

type TurnManager struct {
    mu sync.Mutex
    active map[string]*ActiveTurn // key can be conversationID or runID
}
```

方法：

```go
Start(runID, turnID, conversationID string, cancel context.CancelFunc) error
Interrupt(runID string, reason string) bool
Finish(runID string)
Get(runID string) (*ActiveTurn, bool)
```

Electron IPC / shared Desktop API 暴露：

```ts
InterruptRun(req: { run_id: string; reason?: string; scope?: 'run' | 'task' }): Promise<void>
```

完成定义：

- shell_command 长任务执行时可以 cancel。
- cancel 后 run.status = `aborted`。
- 前端收到 `run.failed` 或 `turn.aborted`，状态停止 loading。

### 3.4 Confirmation resume

扩展表：

```sql
ALTER TABLE confirmation_requests ADD COLUMN call_id TEXT;
ALTER TABLE confirmation_requests ADD COLUMN turn_id TEXT;
ALTER TABLE confirmation_requests ADD COLUMN approval_scope TEXT NOT NULL DEFAULT 'once';
ALTER TABLE confirmation_requests ADD COLUMN approval_key TEXT NOT NULL DEFAULT '';
ALTER TABLE confirmation_requests ADD COLUMN resumed_at TEXT;
```

如果 SQLite bootstrap schema 直接全量建表，就把字段加进 `CREATE TABLE`。

流程：

```text
ToolRouter.Dispatch detects workspace_write/state_change needs approval
  -> create confirmation_request(call_id, turn_id)
  -> store turn_item status=waiting_confirmation
  -> run.status=waiting_confirmation
  -> emit approval.requested
  -> return pause signal
```

新增 API：

```go
func (a *AppCore) ApproveConfirmation(ctx context.Context, confirmationID string, reason string) error
func (a *AppCore) RejectConfirmation(ctx context.Context, confirmationID string, reason string) error
func (a *AppCore) ResumeRun(ctx context.Context, runID string) error
```

批准后：

```text
load waiting tool call by call_id
mark confirmation approved
run.status=running
execute original tool call
store tool output
continue model turn
```

第一版可以限制：

- 只支持恢复 `apply_patch`。
- 不支持跨进程重启恢复。
- app 重启后显示 waiting_confirmation，但需要用户重新触发 resume。

完成定义：

- 一个 `apply_patch` 请求进入 waiting_confirmation。
- 用户 approve 后同一个 run 继续，不创建新 run。
- 工具输出回灌模型，最终 assistant 回答。

### 3.5 Worker result resume

当前 worker queued 会返回“已交给执行后台处理”。Codex-like 行为应该是：

```text
worker task queued
  -> run.status=queued or waiting_tool
worker completed
  -> append tool_output item
  -> continue model turn
  -> final answer
```

第一版可以做成后台 resume：

1. worker completion 写 `tool_runs`。
2. 找到 `tasks.run_id`。
3. 写 `turn_items` tool_output。
4. 调 `ResumeRun(runID)`。

完成定义：

- queued worker 完成后同一个 run trace 有 worker result。
- 如果 resume 失败，run.status = `waiting_user` 或 `failed`，不要静默丢。

### 3.6 前端事件接入

已有前端处理：

- `run.started`
- `action.started`
- `assistant.delta`
- `run.completed`
- `run.failed`

位置：

- `/Users/hao/project/Joi/apps/joi-desktop/frontend/src/App.tsx`

新增处理：

```text
tool.call.started
tool.started
tool.output.delta
tool.finished
tool.failed
approval.requested
approval.resolved
turn.aborted
```

复用 `activeExecutionActions`，不要大改 UI。

新增 action 映射：

```text
tool.call.started -> running action
tool.finished -> completed action
tool.failed -> failed action
approval.requested -> waiting action
```

完成定义：

- 执行 workspace_search 时 UI 出现 action。
- 工具完成后 action completed。
- approval requested 时 UI 不显示成 completed。

测试：

```bash
cd /Users/hao/project/Joi/apps/joi-desktop/frontend
npm run test:execution-actions
npm run build
```

## 推荐 PR 拆分

不要一个 PR 做完全部。按下面拆：

### PR 1：DB 与 runtime mode 骨架

范围：

- `turns`、`turn_items`、`run_events`
- runtime mode
- EventStore
- skeleton types
- legacy tests 不变

验收：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go run ./cmd/sqlite-migration-check
go test ./internal/appcore
```

### PR 2：mock tool-calling loop + read-only capabilities

范围：

- mock model client
- tool spec builder
- ToolRouter dispatch existing capabilities
- RunToolCallingTurn
- tests for `workspace_search -> file_analyze -> final`

验收：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/turnruntime ./internal/appcore -run ToolCalling
```

### PR 3：real provider tool calls

范围：

- Chat Completions tool_calls client
- Responses client
- `supports_tool_calling` 正确写入
- model_calls raw_response 存 tool_calls

验收：

- mock tests 全过。
- 在有测试 API key 的环境跑一个真实 GPT tool call dogfood。

### PR 4：file_read + rg workspace_search

范围：

- `file_read`
- `workspace_search_v2_rg`
- path/symlink/forbidden tests

验收：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/appcore -run 'FileRead|WorkspaceSearch'
```

### PR 5：apply_patch + shell_command

范围：

- permission profile
- apply_patch
- shell_command
- cancellation basics

验收：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/appcore -run 'ApplyPatch|ShellCommand'
```

### PR 6：approval resume + turn interrupt

范围：

- confirmation call_id/turn_id
- Approve/Reject/Resume APIs
- InterruptRun
- frontend event handling

验收：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/appcore -run 'Confirmation|Interrupt|Resume'

cd /Users/hao/project/Joi/apps/joi-desktop/frontend
npm run test:execution-actions
npm run build

cd /Users/hao/project/Joi
pnpm test:electron-contract
pnpm test:store
```

### PR 7：browser/computer real observe

范围：

- browser_observe
- computer_observe real snapshot
- fallback policy
- UI display

验收：

- 本地 browser/computer read-only snapshot 可用。
- 不把动态网页当 HTTP fetch。
- Playwright 只作为最后兜底。

## 最终验收场景

全部完成后，用同一个 Joi 对话执行：

```text
请在当前 Joi 仓库里：
1. 找到模型调用和 agent runtime 的实现。
2. 修改它，让 OpenAI-compatible provider 支持 tool calls。
3. 加一个单元测试覆盖 tool call -> capability execution -> tool output -> final answer。
4. 跑测试。
5. 如果失败，继续修到通过。
6. 最后总结改了哪些文件、为什么。
```

通过标准：

- GPT 自己调用 workspace/file 工具找代码。
- GPT 自己调用 apply_patch 修改代码。
- GPT 自己调用 shell/test 工具跑测试。
- 测试失败时，工具错误回灌模型，模型继续修。
- run trace 里有 model call、tool call、tool output、patch diff、test output。
- 用户可中断。
- 需要审批时可暂停并恢复。
- 最终回答基于真实 tool output，不是 hallucination。

## 每天执行检查单

每天开工前：

```bash
cd /Users/hao/project/Joi
git status --short
```

确认没有不相关改动。

每完成一个 PR 阶段：

```bash
cd /Users/hao/project/Joi/services/orchestrator-core
go test ./internal/store ./internal/appcore
go run ./cmd/sqlite-migration-check
```

涉及桌面：

```bash
cd /Users/hao/project/Joi/apps/joi-desktop/frontend
npm run build
npm run test:execution-actions

cd /Users/hao/project/Joi
pnpm test:store
pnpm test:electron-contract
pnpm build:electron
```

每次提交前必须确认：

- legacy runtime 没坏。
- tool_calling runtime 有新增测试覆盖。
- 新 capability 默认不开高风险权限。
- 所有工具结果都写 `tool_runs`。
- 模型可见工具没有 raw destructive 能力。
- run 失败/取消不会留下 `running` 卡死状态。
