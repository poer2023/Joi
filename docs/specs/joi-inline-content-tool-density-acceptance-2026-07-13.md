# Joi 内联内容与工具密度验收合同（2026-07-14 修订）

## Scope

- Project: `/Users/hao/project/Joi`
- Target: `/Applications/Joi.app` 聊天消息中的 Markdown 代码块与运行过程工具调用。
- Reference: 用户提供的 `截屏2026-07-13 23.25.54.png`、`截屏2026-07-13 23.26.27.png`，以及安装版运行 `run_mrj9rvq2s0790l`。
- User job: 像 Pi / Codex 一样优先阅读产物与最终结论；工具调用只保留一条紧凑摘要，默认不进入聊天正文的视觉主线。

## Information Structure

- Must keep: 运行状态、总耗时、真实工具调用次数、失败状态、每一次调用的可追溯详情，但这些过程信息默认折叠。
- Must summarize: 连续同类工具调用按用户可理解的能力聚合，并显示次数。
- Must distinguish: `web_search` 显示为“网页搜索”，`web_extract` 显示为“读取网页”。
- Must not hide: 聚合只是展示层折叠，Trace 与单次调用详情仍然可访问。
- Must prioritize: assistant 最终结论、文件、图片和其他产物保持在过程折叠区外并直接可见。
- Must not add: 新页面、新导航、第二套 Trace 或新的设置项。

## Interaction Rules

- 所有运行过程第一次出现时都默认折叠，包括运行中、等待中、已完成和失败；状态变化不得自动展开，也不得在完成时自动收起。
- 用户主动展开过程后，本次挂载期间保持其选择；重新进入对话后再次默认折叠。
- 等待授权时，折叠摘要必须清楚显示“等待确认”；授权按钮在用户展开后可操作，不能丢失。
- 单次工具调用仍可独立展开；连续多个同类调用先显示一个 `名称 × 次数` 聚合行，默认折叠。
- 展开聚合行后完整展示组内各次调用；内容自然撑高，不能出现独立横向或纵向滚动条。
- Markdown 代码块不滚动：短代码完整展示；超过 18 行或 1,200 字符的代码默认折叠，展开后完整换行展示。
- Markdown 表格在消息宽度内换行，不使用内联横向滚动。

## Measurable Acceptance

- SSR 验证运行中、等待确认、已完成、失败四种过程均不包含默认 `open` 状态。
- 安装版新产生的运行中过程只显示紧凑摘要，不自动展示调用明细；最终结论和产物仍直接可见。
- 安装版 `run_mrj9rvq2s0790l` 的历史失败过程初始为关闭状态。
- 展开后，原 14 个相同“网页搜索”行变为两个聚合行：`网页搜索 × 6`、`读取网页 × 8`。
- 聚合与代码详情元素的计算样式满足 `overflow-x != auto/scroll` 且 `overflow-y != auto/scroll`。
- 长代码块初始折叠，展开后全部行存在于 DOM 且没有内部滚动容器。
- 页面主聊天滚动行为保持不变。

## Verification

- 2026-07-14 `pnpm --filter @joi/desktop-frontend test:chat-projection`：通过；新增运行中、等待确认、已完成、失败均默认关闭的 SSR 合同，授权操作仍保留在折叠内容中。
- 2026-07-14 frontend build、execution actions、single-agent workspace、task mini list、automation UI state、settings completion 回归：通过。
- 2026-07-14 Electron contract：通过，preload contract 覆盖 144 项接口；macOS Desktop package：通过。
- 2026-07-14 `/Applications/Joi.app` 安装版实时任务：网页调用进行中只显示 `运行中 1 步`，没有调用详情；完成后只显示 `已完成 2 步`，最终结论直接可见。
- 2026-07-14 安装版手动展开 `已完成 2 步` 后可见 `网页搜索`、`读取网页`，再次收起正常，证明过程可追溯但不抢占默认正文。
- 2026-07-14 安装包与 `/Applications/Joi.app` 的 `app.asar` SHA-256 一致；codesign 严格校验通过；项目实际 `node:sqlite` 驱动返回 `integrity_check=ok`、外键异常 0。
- 2026-07-14 截图证据：[运行中默认折叠](./joi-all-tools-folded-running-installed-2026-07-14.jpeg)、[完成后结论直接可见](./joi-all-tools-folded-conclusion-installed-2026-07-14.jpeg)。
- `pnpm --filter @joi/desktop-frontend test:chat-projection`：通过；覆盖短代码全量展示、20 行代码默认折叠、代码完整保留，以及 6 次搜索 / 8 次读取的聚合输出。
- `pnpm --filter @joi/desktop-frontend build`：通过。
- frontend execution actions、single-agent workspace、task mini list、automation UI state、settings completion 回归：通过。
- Electron contract、Electron build、macOS package：通过。
- `/Applications/Joi.app` 已替换为新构建并启动；`codesign --verify --deep --strict /Applications/Joi.app`：通过。
- 安装版 Computer Use：历史 14 步过程初始折叠；展开后只有 `网页搜索 × 6`、`读取网页 × 8` 两个聚合行，搜索组再展开可见完整 6 条查询。
- 安装版 Computer Use：48 行 TypeScript 代码初始折叠，展开后代码自然撑高且没有代码块内层滚动；主聊天区仍可滚动。
- SQLite `PRAGMA integrity_check`：`ok`；`PRAGMA foreign_key_check`：无异常。
- 截图证据：[工具聚合展开](./joi-inline-tool-clusters-installed-2026-07-13.jpeg)、[长代码展开](./joi-inline-long-code-expanded-installed-2026-07-13.jpeg)。

## Done Means

- [x] 所有状态的工具过程默认折叠，状态更新不再强制展开。
- [x] 最终结论和产物保持在过程折叠区外直接可见。
- [x] 等待授权摘要可见，展开后仍可完成授权操作。
- [x] 同类连续工具调用聚合并保留完整追溯。
- [x] 代码、表格和工具详情没有内联滚动。
- [x] 安装版可见验收通过并保存新截图证据。
