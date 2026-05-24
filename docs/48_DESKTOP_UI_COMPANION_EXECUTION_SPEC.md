# 48 桌面 UI 规格：伙伴理解 + 任务执行

## 1. 目标

当前 Desktop UI 已有 Chat Workbench、Trace、Memory、Capability、Nodes、Settings 等能力，但主体验偏工程控制台。下一阶段要把这些能力组织成：

```text
左栏：会话 / 任务 / 重要片段
中间：聊天主界面
右栏：伙伴理解 / 任务执行 / 交付结果
```

设置中心保留，但降级为高级管理入口。用户每天面对的核心界面应该是：

```text
和 Joi 聊
让 Joi 记住你
让 Joi 做任务
看 Joi 做到哪了
拿到交付物
让 Joi 下次更懂你
```

## 2. 主布局

```text
AppShell
  ├─ LeftRail
  │   ├─ RecentConversations
  │   ├─ ActiveTasks
  │   └─ ImportantArtifacts
  ├─ MainChat
  │   ├─ MessageTimeline
  │   ├─ TaskCards
  │   ├─ ArtifactSummaries
  │   └─ Composer
  └─ RightPanel
      ├─ CompanionInsightPanel
      ├─ TaskExecutionPanel
      ├─ ArtifactPanel
      └─ TraceDrawerLink
```

桌面宽度不足时：

```text
>= 1200px: 三栏
900-1199px: 左栏窄化，中间 + 右栏
< 900px: 右栏变抽屉，左栏可折叠
```

## 3. 左栏

### 3.1 Recent Conversations

字段：

- title
- last_message
- latest_run status
- updated_at
- channel badge

操作：

- 新会话
- 搜索会话
- 选择会话

### 3.2 Active Tasks

展示 `product_tasks.status in planning/running/waiting_confirmation/blocked`。

卡片字段：

```text
title
status
current_step
progress_percent
deliverable_count
waiting_confirmation badge
updated_at
```

点击后：

- 中间聊天切到来源 conversation。
- 右侧显示 TaskExecutionPanel。

### 3.3 Important Artifacts

展示最近 pinned 或 task deliverable artifacts。

字段：

```text
type
title
source task
updated_at
```

## 4. 中间聊天

### 4.1 Message Timeline

消息类型：

```text
user_message
assistant_message
task_card
artifact_summary
confirmation_card
tool_status_inline
memory_proposal_inline
```

聊天中不得把所有执行细节塞进长回复。详细步骤归右侧 TaskExecutionPanel，聊天只显示关键节点。

### 4.2 Task Card

严肃任务创建后插入：

```text
任务：重构 Joi 的平衡方案
状态：执行中
目标：给出伙伴 + 任务执行兼顾的产品方案
计划：5 步
当前步骤：正在整理开发 spec
交付物：方案报告
风险：只读分析，无需确认
```

可展开区域：

```text
计划
步骤
工具
交付物
Trace
成本
```

按钮：

- 打开详情
- 暂停
- 继续
- 取消
- 查看 Trace

MVP 可只实现“打开详情 / 查看 Trace”。

### 4.3 Composer

输入框旁边提供轻量模式：

```text
自动判断
聊聊
认真执行
后台任务
```

辅助控件：

- 附件
- 选择节点
- 允许 worker
- 发送

不要把模型、Agent、节点、Workflow 全部堆在输入框旁。高级选项放到折叠菜单。

## 5. 右栏默认：Joi 对你的理解

默认无 active task 时显示 CompanionInsightPanel。

结构：

```text
Joi 对你的理解

最近记住
- ...

当前关注
- ...

待确认
- ...

未完成话题
- ...

准备提醒你的事
- ...
```

每条 memory/open loop/proactive candidate 都必须有操作：

```text
准确
不准确
很重要
别记
以后少提
查看来源
```

禁止文案：

- “用户画像”
- “心理评估”
- “人格标签”

推荐文案：

- “我最近记住了这些”
- “我可能理解错了这些”
- “我准备之后提醒你这些”

## 6. 右栏任务态：Task Execution Panel

当 active product task 存在时右栏切换：

```text
任务标题
状态
目标
计划
执行记录
交付物
技术细节
```

### 6.1 Header

字段：

- title
- status badge
- mode
- risk_level
- progress_percent
- latest_run_id

### 6.2 Plan

读取 `product_task_steps`，按 `sort_order` 展示：

```text
1. 读取当前项目报告
2. 对比 Alma 差距
3. 拆解伙伴层与执行层
4. 给出开发优先级
5. 输出交付方案
```

状态图标：

```text
pending
running
done
failed
waiting_confirmation
skipped
```

### 6.3 Execution Records

每个步骤展示：

```text
步骤 2：搜索 Joi 工作区
工具：workspace_search_v1
状态：完成
结果：找到 18 个相关文件
风险：只读
耗时：1.2s
```

数据来源：

- `product_task_steps`
- `tool_runs`
- `run_steps`
- `tasks` / `task_attempts` worker queue

### 6.4 Deliverables

展示 `product_task_deliverables`：

```text
交付物
- 平衡方案报告
- UI 改造清单
- 架构改造清单
- 4 周路线图
```

操作：

- 打开
- 继续修改
- 导出
- 查看来源
- 关联记忆

MVP 操作：

- 打开
- 查看来源

### 6.5 Technical Details

折叠显示：

- Run Trace
- Tool Runs
- Prompt Assembly
- Model Call
- Memory Context Pack
- Worker assignment
- Cost / token usage

这些是高级详情，不作为主视觉中心。

## 7. Artifact Viewer

Artifact 打开后使用右侧或中间 overlay。

字段：

- title
- type
- content_format
- version
- source task
- source run
- linked memories
- updated_at

操作：

```text
继续修改
导出
查看来源
复制内容
创建新版本
```

MVP：

- Markdown render
- source links
- version number
- copy content

## 8. “Joi 想提醒你的事”

主动候选队列不叫“确认队列”。

分组：

```text
伙伴提醒
任务进度
记忆确认
系统提醒
```

卡片：

```text
title
body
reason
source
score
channel
expires_at
```

操作：

```text
发送
忽略
有用
太烦
不准确
以后别这样
```

Telegram 发送必须从这里批准。

## 9. 设置页降级

以下保留，但移入高级设置或任务详情：

```text
常规设置
系统状态
节点细节
成本总览
备份恢复
高级 Trace
Capability Console
```

保留理由：

- 这些是 Joi 的治理能力，不是日常主体验。
- 需要时必须能打开，不能删除。
- 但默认不应像管理员后台一样压住聊天和任务体验。

## 10. 前端类型新增

在 `apps/joi-desktop/frontend/src/api/desktop.ts` 增加：

```ts
export type ProductTask = { ... };
export type ProductTaskStep = { ... };
export type ArtifactSummary = { ... };
export type ArtifactDetail = { ... };
export type OpenLoop = { ... };
export type ProactiveMessage = { ... };
export type ReflectionResult = { ... };
```

新增 API：

```ts
desktopApi.listProductTasks()
desktopApi.getProductTask(id)
desktopApi.listArtifacts()
desktopApi.getArtifact(id)
desktopApi.listOpenLoops()
desktopApi.listProactiveMessages()
desktopApi.decideProactiveMessage(id, action, feedback)
```

## 11. 空状态

Memory 空：

```text
我还没有确认过长期记忆。
当你让我记住偏好、项目方向或重要决定时，我会先放到这里等你确认。
```

Task 空：

```text
还没有进行中的任务。
你可以直接说“帮我分析...”或“给我整理一份...”。
```

Artifact 空：

```text
还没有交付物。
严肃任务完成后，报告、方案、摘要和 diff 会出现在这里。
```

Proactive 空：

```text
现在没有准备提醒你的事。
```

## 12. UI 验收

必须验证：

- 普通聊天右栏显示 CompanionInsightPanel。
- serious task 创建后聊天中出现 Task Card。
- 选择 active task 后右栏显示 TaskExecutionPanel。
- task step 状态变化不会导致布局跳动。
- artifact 可打开并看到 source run。
- Memory candidate 可确认、禁用、反馈。
- proactive draft 可 dismiss 和反馈。
- 设置中心仍可进入 Capability/Nodes/Trace/Backup 等高级页面。
