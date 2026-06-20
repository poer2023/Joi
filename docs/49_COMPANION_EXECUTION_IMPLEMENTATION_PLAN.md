# 49 实施计划与验收规格

## 1. 总体顺序

不要按“继续扩设置页”的顺序开发。按产品闭环开发：

```text
P0：Task + Memory 的共同闭环
P1：主界面任务卡片 + 伙伴理解
P2：Artifact 交付物系统
P3：主动触达审核模式
P4：本地上下文补强
P5：Provider / Model Capability
```

前 2 周只追一个目标：

```text
用户能自然聊天 → Joi 记住方向 → 创建任务 → 展示步骤 → 产出 Artifact → 下次能接着继续。
```

## 2. P0：数据闭环

### 2.1 交付内容

新增：

```text
product_tasks
product_task_steps
product_task_deliverables
artifacts
open_loops
proactive_messages
Reflection service
AppCore DTO/API
SendChat input_mode
SendChat product_task_id
```

改造：

```text
SendChat serious_task 自动创建 Product Task
Run metadata 写 product_task_id
Capability/tool_run 完成后同步 product_task_steps
Memory candidate 写入 memories.status=pending
Reflection 输出 open loop 和 proactive draft
```

### 2.2 后端实现步骤

1. 新增 SQLite/Postgres migration。
2. 在 AppCore schema 初始化中注册新表。
3. 新增 store 层查询方法。
4. 新增 AppCore methods：

```text
ListProductTasks
GetProductTask
CreateProductTask
UpdateProductTaskStatus
ListArtifacts
GetArtifact
ListOpenLoops
ListProactiveMessages
DecideProactiveMessage
RunConversationReflection
```

5. 扩展 `SendChat` request/response DTO。
6. 在 runtime loop 中识别 serious task。
7. 在 capability execution path 中关联 product task step。
8. 在 run 结束后触发 Reflection。

### 2.3 验收

输入：

```text
Joi 不是个人工作流，我要伙伴 + 执行能力。
```

期望：

- 生成 pending memory。
- 生成 open loop。
- 生成 proactive draft。
- 不创建 serious Product Task，除非模式为认真执行。

输入：

```text
帮我分析 Alma 和 Joi 的差距，并给出下一步。
```

期望：

- 创建 product_task。
- 至少 3 个 product_task_steps。
- latest_run_id 指向当前 run。
- run metadata 含 product_task_id。
- 生成 report artifact。

## 3. P1：主界面改造

### 3.1 交付内容

新增组件：

```text
AppShellV2
LeftRail
ActiveTaskList
ImportantArtifactList
TaskCard
CompanionInsightPanel
TaskExecutionPanel
ArtifactViewer
ProactiveQueuePanel
```

改造：

```text
ChatPanel 支持 task_card / artifact_summary
Composer 支持 input_mode
TracePanel 从主体验降级到详情入口
MemoryPanel 文案改为“Joi 对你的理解”
```

### 3.2 UI 验收

- 启动后默认进入聊天，不进入设置中心。
- 无 active task 时右侧显示 Joi 对你的理解。
- 创建 serious task 后中间出现 task card。
- 选择 task 后右侧显示计划、步骤、工具、交付物。
- artifact 可打开。
- trace 仍可从任务详情进入。
- Capability/Nodes/Backup 等高级页面仍可进入。

## 4. P2：Artifact 系统

### 4.1 交付内容

```text
artifact store
artifact viewer
artifact linked to product_task
artifact linked to run/tool_run
artifact version
artifact export v0
```

MVP 支持类型：

```text
report
plan
summary
diff
```

### 4.2 写入规则

- serious task 的最终结构化结果写 artifact。
- 如果模型输出是普通聊天，不强行 artifact 化。
- report/plan/summary 使用 markdown。
- diff 使用 fenced diff 或 patch metadata。
- artifact 必须有 source run 或 source conversation。

### 4.3 验收

用户要求“给我一份报告”时：

- 聊天中有简短总结。
- 右栏有 report artifact。
- Artifact Viewer 可打开完整报告。
- Artifact 可回溯 source task 和 source run。

## 5. P3：主动触达审核模式

### 5.1 交付内容

```text
proactive scoring
desktop review queue
feedback buttons
telegram send after approval
quiet hours
daily cap
same-topic suppression
```

### 5.2 审核流程

```text
draft
→ 用户点击发送
→ queued
→ delivery adapter 发送
→ sent / failed
```

用户点击忽略：

```text
draft
→ dismissed
→ metadata.feedback_reason
```

用户点击“以后别这样”：

```text
draft
→ suppressed
→ 创建 suppression rule metadata
```

### 5.3 验收

- 主动消息默认不自动发送。
- 每条 proactive message 有 reason。
- Telegram 发送必须经过桌面批准。
- 同一 open loop 24 小时内不重复提醒。
- 用户负反馈会降低同类提醒 score。

## 6. P4：本地上下文补强

优先级：

```text
1. workspace indexing
2. 文件 / 附件 ingest
3. 浏览器只读页面
4. 登录态读取，严格授权
5. 可选 OCR / activity
```

约束：

- 不做默认全局 OCR/activity。
- 不读取 secret、Keychain、浏览器 profile、`.env`。
- 只读上下文也必须进入 path boundary 和 redaction。
- 每次上下文使用都写 Run Trace。

MVP 只做 workspace indexing 和附件 ingest。

## 7. P5：Provider / Model Capability

目标不是堆模型列表，而是让 Joi 知道不同任务该用什么模型：

```text
聊天模型
记忆反思模型
工具调用模型
长文档分析模型
视觉模型
embedding 模型
低成本后台任务模型
```

新增能力：

```text
provider registry
model capability cache
tool calling support flag
vision support flag
embedding support flag
reasoning support flag
context window
max output tokens
cost
health check
```

验收：

- 模型设置页能显示 capability flags。
- Reflection 可使用 cheap/reasoning 配置。
- serious task 可按 task type 选择模型。
- model_calls 继续写 provider/model/token/latency/fallback。

## 8. 测试计划

### 8.1 单元测试

新增：

```text
reflection parser
memory candidate sanitizer
task classifier
proactive scorer
product task store
artifact store
```

### 8.2 集成测试

新增 desktop eval cases：

```text
companion_direction_reflection
serious_task_creates_product_task
artifact_created_from_report_task
proactive_message_requires_review
memory_candidate_can_be_confirmed
tool_run_links_product_task_step
```

### 8.3 回归命令

每阶段必须跑：

```text
cd services/orchestrator-core && go test ./...
cd services/worker-runtime && go test ./...
cd services/telegram-gateway && go test ./...
pnpm test:store
pnpm eval:desktop:ts
```

前端改造后增加：

```text
cd apps/joi-desktop/frontend && npm run build
pnpm build:electron
```

桌面打包验收使用 `./scripts/package_desktop_macos.sh`。

## 9. 2 周开发拆分

### Week 1：Memory + Task 数据闭环

Day 1：

- 新增 migrations。
- 新增 DTO。
- 新增 Product Task store。

Day 2：

- SendChat 扩展 input_mode。
- serious task 创建 Product Task。
- run metadata 写 product_task_id。

Day 3：

- Reflection service v0。
- memory candidate 写 pending memories。
- open loop 写入。

Day 4：

- proactive draft 写入。
- task step 状态同步。
- artifact store v0。

Day 5：

- backend tests。
- desktop eval cases。
- 修正 schema/trace 边界。

### Week 2：UI + Artifact

Day 1：

- AppShell 三栏结构。
- LeftRail active tasks。

Day 2：

- TaskCard。
- TaskExecutionPanel。

Day 3：

- CompanionInsightPanel。
- Memory 文案和反馈入口。

Day 4：

- ArtifactViewer。
- ProactiveQueuePanel。

Day 5：

- UI polish。
- npm build。
- desktop eval。
- 截图验收。

## 10. 完成定义

一个任务只有同时满足以下条件才算完成：

```text
数据落库
Electron IPC / shared Desktop API 可读写
UI 可见
Run Trace 可追溯
Memory/Artifact/Task 来源可回溯
测试通过
不会破坏现有 Capability/Tool Workflow/Worker Gateway
```

## 11. 第一条端到端验收脚本

手工输入：

```text
我想把 Joi 做成伙伴式前台 + 严肃执行后台，记住这个方向。
```

期望：

```text
Chat 回复自然确认
Memory Inbox 出现 pending memory
Open Loop 出现下一步建议
Proactive Queue 出现 draft
无 Product Task
```

继续输入：

```text
根据这个方向，给我整理一份开发 spec。
```

期望：

```text
创建 Product Task
Task Card 出现在聊天中
右侧显示计划和步骤
Artifact 生成 report
Run Trace 可打开
Reflection 生成新的 memory candidate
下次输入“继续推进”能接上该 task
```
