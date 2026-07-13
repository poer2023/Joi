# Joi Memory OS 优化验收合同

## Scope

- Project: Joi Desktop
- Target: 真实 Memory OS 召回链路；设置 -> 数据与记忆 -> 记忆健康
- User job: 保证记忆不串项目、旧精确记忆仍可找到，并能看懂召回质量和候选积压。

## Information Structure

- Must keep: 待确认、已确认、冲突、搜索、归档、回收站与备份入口。
- Must add: 记忆健康、召回/注入/确认使用、反馈、作用域分布、超期/重复/长期未用提示。
- Must not add: 自动删除、自动停用、未经授权的跨项目召回、外部向量数据库。

## Interaction Rules

- 默认只允许 global、当前 user、当前 room 与当前 project。
- `cross_project` / `multi_project` / `other_project` 只扩展到当前 room 已授权可见项目。
- 每轮写入 `memory.scope_resolved` 与逐条 `memory.recalled`，包含 source、matched terms、scope match。
- FTS 精确候选与治理候选合并 rerank；禁用、删除、过期、已合并记忆在两个候选源都必须过滤。
- 反馈参与 rerank；没有证据时 `used_in_answer` 不得自动标真。

## Visual Rules

- 沿用当前设置页的 `compact-kv`、`row-card` 和密度，不新增仪表盘图表或装饰性卡片。
- Desktop：已安装 Joi.app 标准窗口。
- Narrow：窗口最小宽度下页面仍可滚动，指标文字不重叠。

## Verification

- Store: `pnpm --filter @joi/store test`
- UI contract: `pnpm --filter @joi/desktop-frontend test:settings-completion`
- Build: `pnpm --filter @joi/desktop-frontend build`
- Package: `pnpm package:electron:mac`
- Installed: codesign、app.asar 字符串与 Computer Use 可见 UI。

## Done Means

- [x] 默认与显式跨项目召回都有回归测试。
- [x] room/user/global 优先级有回归测试。
- [x] 超过 60 条后旧精确命中仍在 top 8。
- [x] hard-negative、删除/禁用、feedback rerank 有回归测试。
- [x] usage log、context pack 与 Run Trace 可解释作用域和命中来源。
- [x] 已安装 app 可见真实记忆健康指标。

## Installed Evidence

- `/Applications/Joi.app`：2026-07-13 16:48 安装包，codesign deep/strict 通过。
- 真实 UI：已确认 8、待处理 2、召回/注入 65/65、确认用于回答 49（75%）、未确认使用 16。
- 作用域：全局 1、项目 6、当前用户 1。
- 生命周期：2 条候选超过 7 天；当前无重复候选、无 90 天长期未使用记忆。
- 标准窗口和收窄窗口均能看到标题、指标、作用域分布与生命周期提示。
