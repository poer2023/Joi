# Joi 三项关键闭环验收合同（2026-07-17）

## Objective

让 Joi 在不改变现有 UI 视觉语言的前提下，同时闭合三条产品主线：严肃任务可恢复、可验收、可撤销；长期关系只沉淀有意义且可追溯的真实信息；多个任务可独立推进并以可审阅交付物结束。

## Gate 0：当前事实与边界

### Required evidence

- `/Applications/Joi.app` 的真实界面，而不是仅看源码或预览。
- 当前 `runs`、`product_tasks`、Memory OS、artifact、approval 与聊天投影实现。
- 当前工作树已有交互优化改动，后续实现不得覆盖或回退这些用户改动。

### Deliverables

- 本验收合同。
- 三条闭环的当前失败样本：重启后 runtime lost、技术验收指令进入待确认记忆、任务与交付状态分散。

### Stop condition

- 只有当前安装版、源码边界和现有改动都已确认，才进入实现。

## Gate 1：可信执行闭环

### Done means

- 非终态 run 在 App 重启后进入 `needs_recovery`，不会被伪装成普通失败或已完成。
- 用户可以明确选择“从安全点重试”或“放弃”；重试创建有父子链路的新 run，旧 run 不会重复执行副作用。
- `max_steps_exceeded`、未处理工具失败或缺少独立状态证据时，严肃任务不能进入 completed。
- 工作区写入生成本地 ChangeSet：包含 before/after hash、可审阅 diff、来源 run/task；只有文件仍处于该 ChangeSet 的 after 状态时才允许安全撤销。
- 权限决定与 ChangeSet、run、能力和作用域关联，并保留审计记录。

### Verification

- Store 恢复分类、恢复/放弃、验收失败与 ChangeSet 回滚测试。
- Runtime apply-patch ChangeSet 测试。
- Electron contract 与 TypeScript build。

## Gate 2：长期关系与成熟交付闭环

### Done means

- 明显的测试、基准、工具操作说明和一次性执行指令会进入可追溯的 quarantine，不会成为待确认长期记忆，也不会参与召回。
- Memory maintenance 能回溯隔离历史噪声，但不删除或改写已确认的真实用户记忆。
- 现有个人助理工作台提供“今日关注”聚合：待确认、需恢复任务、活跃任务、未尽事项和主动候选；沿用现有组件与样式。
- 不同会话可独立提交任务；同一会话仍保持顺序一致性，普通聊天不会被其他会话的运行状态锁住。
- 严肃任务完成后显示可打开的交付物与验证状态；原始 JSON、工具参数和调试细节继续留在检查器/原始调用中。

### Verification

- Memory quarantine 与 maintenance 回归测试。
- 多会话提交状态、聊天投影、任务交付动作测试。
- 安装版可见验证：今日关注、恢复入口、交付物入口；确认没有新增视觉样式或无内容状态行。

## UI acceptance

### Scope

- Project: Joi Desktop
- Target screens: 主聊天、运行恢复状态、数据与记忆 → 个人助理、任务交付物
- User job: 在不理解内部 runtime 的情况下判断“现在发生什么、是否需要我、结果是否可信、能否撤销”。

### Information structure

- Must keep: 现有侧栏、聊天主线、右侧检查器、设置页分组、现有字体/颜色/间距/圆角。
- Must remove: 无内容、不可展开、没有用户决策价值的能力数量或内部完成状态行。
- Must not add: 新仪表盘风格、Git-first 全局导航、能力计数炫耀、普通聊天中的原始 JSON。

### Interaction rules

- 恢复、放弃、撤销均必须有明确状态与失败原因；不得静默重复副作用。
- 今日关注空状态保持简短，不制造提醒噪声。
- 新增入口复用现有按钮、卡片、标签和抽屉交互，不新增 CSS 视觉 token。
- macOS Desktop 为唯一目标；移动端不适用。

### Required visual evidence

- 安装版主聊天中的恢复/交付状态。
- 安装版个人助理中的今日关注。
- 安装版待确认记忆不再出现测试指令。

## Explicit non-goals

- 不重做 UI 样式、布局系统或品牌视觉。
- 不引入云端队列、Docker、Postgres、NATS 或新的外部服务。
- 不把 Git、PR、worktree 变成 Joi 的全局产品语义。
- 不删除 `~/Library/Application Support/Joi`，不改写已确认人格宪法或真实用户记忆。
- 不降低现有数据源覆盖、自动化频率、权限阈值或外部渠道能力。

## First action

先在独立测试数据库里实现和证明恢复、真实验收与记忆 quarantine；通过后再接 UI、构建并安装验证。
