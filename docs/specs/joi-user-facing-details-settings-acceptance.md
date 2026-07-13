# Joi 普通用户详情与设置页验收合同

## Scope

- Project: Joi Desktop
- Target: 桌面端所有设置对象页，以及对话中的成员、任务、运行、工具、日志、资产与备份详情页
- Primary files: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/features/chat/components/TraceDrawer.tsx`, `apps/joi-desktop/frontend/src/styles.css`
- User job: 普通用户能看懂当前状态、结果、风险与下一步操作，不需要理解数据库结构、内部事件或 JSON

## Current-state evidence

- 2026-07-11 浏览器只读盘点覆盖 9 个设置分类、52 个对象入口。
- “能力与工具”8 个入口重复渲染同一 Capability Console，并在预览数据下产生 13 个原始数据块。
- “高级”暴露原始数据、Prompt Assembly、Memory Context Pack、Tool I/O；聊天入口、记忆、本地数据、备份和自动化触发也包含 JSON 折叠块。
- 运行详情仍显示运行 ID、提示词缓存键、哈希、原始事件和工具输入输出。

## Information Structure

- Must keep: 连接状态、启用状态、风险等级、执行结果、用量、记忆内容、备份操作、诊断导出、可恢复错误和用户可执行的下一步。
- Must convert: 枚举值、技术状态和嵌套对象转换为中文状态、摘要卡片、字段列表、计数、时间线或用户动作。
- Must hide: 原始 JSON、payload、metadata、schema、prompt/hash/cache key、内部 run/node/task/item ID、完整日志正文和无法稳定解释的底层字段。
- Must remove: 重复指向同一详情的设置对象；普通用户没有直接任务的开发者页。
- Must not remove: 底层存储、Run Trace 写入、诊断导出、日志保留/清理能力或运行时 API。

## Visual Rules

- Layout density: 延续现有三栏设置布局；摘要卡保持紧凑，详情默认一屏可扫读。
- Typography: 中文标题和用户语言优先，产品名与必要模型名可保留英文。
- Color: 状态色只表达正常、提醒、失败和风险，不给内部数据单独加视觉权重。
- Borders/shadows: 沿用现有卡片与分隔线，不新增浮层式调试器。

## Interaction Rules

- Required: 详情页默认只显示摘要；诊断导出仍可用；危险清理/恢复继续沿用确认流程。
- Advanced disclosure: 只允许展示已经过字段筛选和中文化的补充信息；没有可解释字段时整块不渲染。
- Empty/loading/error: 用“暂无记录 / 尚未配置 / 可重试”表达，不显示空对象、堆栈或内部错误码。
- Logs: 普通设置页改为“运行记录”，展示时间、来源、结果和一句摘要；完整日志只进入导出的诊断包。

## Verification

- Browser target: `http://127.0.0.1:5173/`
- Viewports: desktop 1440x900；narrow 960x760
- Required screenshots: 设置导航、运行与用量、能力概览、诊断与支持、运行详情。
- Required DOM checks:
  - 设置详情区域不存在可见原始 JSON `<pre>`。
  - 普通设置导航不存在“原始数据 / Prompt Assembly / Memory Context Pack / Tool I/O”。
  - “能力与工具”不再出现 8 个重复对象入口。
  - 运行记录没有原始 payload、metadata、内部 ID 或完整事件对象。
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
pnpm --dir apps/joi-desktop/frontend test:execution-actions
pnpm --dir apps/joi-desktop/frontend test:chat-projection
```

## Done Means

- [ ] 所有设置对象重新盘点，普通用户页面不直接暴露原始 JSON 或日志正文。
- [ ] 可解释内容已转换为 GUI 摘要，不可解释内容已从普通入口隐藏。
- [ ] 详情页保留状态、风险、结果和下一步操作。
- [ ] 浏览器与 `/Applications/Joi.app` 均有可见验证证据。
