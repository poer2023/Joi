# Joi 隐私、安全与支持页精简验收

## Scope

- Project: Joi Desktop 设置页。
- Target app screen: `/Applications/Joi.app` 的“隐私与安全”和“支持”。
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`。
- User job: 只看到当前桌面版需要的安全、凭证和诊断入口；切换横向页签时左侧一级菜单保持当前状态。

## Reference

- Primary reference: 2026-07-15 安装版逐页审计截图。
- Preserve: 本地钥匙串、隐私边界、远端执行确认、待确认高风险操作、脱敏诊断导出。
- Remove from ordinary Settings: 内部 Secret 名称、已结束审批历史、独立诊断脱敏开关、支持页中的运行记录清理、外部入口接续和运行完整性工程指标。

## Information Structure

- “隐私与安全”只保留三个横向页签：安全策略、密钥管理、待确认操作。
- “安全策略”合并本地优先、远端执行和远端确认，不再拆成多个工程设置页。
- “密钥管理”只展示当前桌面入口需要的模型、Telegram 和执行器凭证，并使用用户可读名称。
- “待确认操作”只展示仍待处理的请求，不展示 Run ID、Capability ID、请求参数或历史拒绝项。
- “支持”只保留本机状态、问题数量、诊断保护状态和脱敏诊断包导出。
- 不删除底层数据、审批记录、诊断能力或运行记录；只清理普通设置页的展示结构。

## Visual Rules

- 延续现有单左栏和横向页签样式，不新增第三层导航、装饰卡片或说明堆叠。
- 支持页保持短页面；不再出现需要长滚动的运维报告。
- 左栏宽度与首页一致，灰色标题栏继续贯通。

## Interaction Rules

- 点击任何横向页签只切换右侧内容，不自动折叠或展开左侧一级菜单。
- 左侧折叠按钮仍是唯一主动改变菜单展开状态的入口；窗口窄屏自适应保持原规则。
- 返回、折叠、展开和标题栏拖拽的既有命中区域不变。
- 安全策略保存继续写入现有 workspace settings；待确认操作继续使用原审批接口。

## Verification

- Installed target: `/Applications/Joi.app`。
- Viewport: 当前桌面窗口和窄桌面窗口。
- Required screenshots:
  - 精简后的安全策略页，左栏展开。
  - 切换到密钥管理或待确认操作后，左栏仍展开。
  - 精简后的支持页。
- Required checks:
  - 隐私页只存在 3 个页签。
  - 支持页不再渲染清理运行记录、最近运行完整性或外部入口接续。
  - 密钥页不再显示 Photon、Admin、Node、OAuth 状态等内部项。
  - 真实鼠标点击横向页签后“折叠设置菜单”按钮与完整一级菜单仍可见。
  - 安装包签名和 SQLite `quick_check` 通过。

## Done Means

- [x] 两页的信息结构只保留当前桌面版可理解且可操作的内容。
- [x] 横向页签不会改变左侧菜单展开状态。
- [x] 返回和菜单按钮未回归；标题栏结构与拖拽区域未改动。
- [x] 构建、安装版、签名和本地数据完整性验证通过。

## Evidence

- Installed privacy: “隐私与安全”只显示“安全策略 / 密钥管理 / 待确认操作”；默认进入安全策略。
- Installed secrets: 只显示模型服务密钥、Telegram 机器人令牌和执行器连接凭证；Photon、Admin、Node、OAuth 等内部项不再出现。
- Installed pending actions: 只显示 2 条 pending 请求；已拒绝历史、Run ID、Capability ID 和请求参数均不展示；`Execute apply_patch` 转为“修改工作区文件”。
- Installed tab behavior: 在左栏展开状态下，用真实坐标点击“密钥管理”和“待确认操作”后，完整一级菜单及“折叠设置菜单”按钮持续可见。
- Installed support: 只保留本地数据、待处理问题、诊断保护和脱敏诊断导出；不再渲染清理运行记录、最近运行完整性或外部入口接续。
- Installed controls: 真实坐标点击折叠 `(204, 22)`、展开 `(115, 22)`、返回 `(170, 22)` 均通过。
- Visual evidence: `docs/specs/evidence/joi-settings-privacy-support-audit-2026-07-15/04-privacy-after.jpeg`、`05-privacy-tab-left-rail-after.jpeg`、`06-pending-actions-after.jpeg`、`07-support-after.jpeg`。
- Same-input comparisons: `08-privacy-before-after.jpeg` 与 `09-support-before-after.jpeg`；两组均为本轮同一安装版窗口尺寸下的左旧右新对比。
- Build: canonical frontend build and detached worktree TypeScript check passed; `git diff --check` passed.
- Installed bundle: release and `/Applications/Joi.app` `app.asar` SHA-256 both equal `b70437f822d8dd00f24acd94581a7043fe61f15e0cc2688223a5156e3de21bb9`; strict codesign verification passed.
- Data: `~/Library/Application Support/Joi/joi.db` remains present and SQLite `quick_check` returned `ok`.
- Cleanup: removed only this task's verified 2026-07-15 replacement archives; preserved the three pre-existing 2026-07-14 archives.
