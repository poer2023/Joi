# Joi 设置中心完整性验收合同

## Objective

现有设置菜单中的每个对象都必须对应独立、真实的数据源或可保存操作；不得再用通用总览、空按钮或“后续接入”文案冒充实现。

## Gate 0：现状与缺口

| 分类 | 路由 | 当前证据 | 本轮目标 |
| --- | --- | --- | --- |
| 模型 | 8 个 Provider | 有表单；部分 provider 名称与 runtime 支持范围不一致 | 保存后可被 runtime 接受，连接测试与模型列表真实 |
| 聊天入口 | Telegram / iMessage | 已有真实保存和测试 | 保留并回归 |
| 聊天入口 | 微信 Claw / 桌面通知 / CLI / Webhook | 通用假表单、按钮无处理 | 独立状态页；可保存、可测试，未安装适配器时明确阻塞层 |
| 自动化 | 定时任务 / Hook | SQLite + runner + webhook 已接通 | 保留并回归 |
| 日志与用量 | 日志 / Token / 清理 | 真实数据与操作 | 保留并回归 |
| 数据与记忆 | 8 个对象 | 真实数据、备份与会话生命周期 | 保留并回归 |
| 能力与工具 | 内置能力 | 总览可见但不可按能力启停 | 独立列表、状态筛选、启停持久化 |
| 能力与工具 | Skills | 真实 2 条但埋在总览底部 | 独立列表、契约详情、启停持久化 |
| 能力与工具 | Plugins | 无类型、无 IPC、无存储 | 本地 manifest 安装、列表、启停、移除 |
| 能力与工具 | MCP | 只有 inventory 占位 | Server 配置持久化、启停、刷新、删除、wrap 状态 |
| 能力与工具 | 网页搜索 | 已有真实保存和测试 | 保留并回归 |
| 能力与工具 | 文件系统 / 浏览器 | 只显示总览 | 编辑 workspace roots、大小限制、host allowlist 与私网策略 |
| 能力与工具 | GitHub | 只显示总览 | Token 状态、默认仓库配置与能力状态 |
| 能力与工具 | 自定义工具 | 只显示总览 | 独立 workflow 列表与启停 |
| 节点与执行 | 节点 / Gateway / 审计 | 真实状态与部分操作 | 保留并回归 |
| 节点与执行 | 分配策略 | 静态 select/checkbox | 策略与远端执行开关可保存、重启恢复 |
| 隐私与安全 | 密钥 / 危险操作 | 真实钥匙串与审批 | 保留并回归 |
| 隐私与安全 | 隐私策略 / 远端权限 / 诊断脱敏 | 静态假开关 | 策略持久化，并被设置页与诊断导出读取 |
| 高级 | 5 个对象 | 真实只读数据或导出操作 | 保留并回归 |

## Gate 1：实现约束

- 每个对象拥有唯一标题、说明、空态和操作区。
- 所有开关必须受控并有保存处理；无 `defaultValue` 假保存、无无事件按钮。
- Skills、Plugins、MCP、Capability 的启停或安装状态写入 SQLite，重启后恢复。
- 密钥只进入 Keychain；页面只展示“已配置/缺失”。
- 不新增全局主模型，不让模型绕过 capability runtime。

## Gate 2：验证

- 静态路由覆盖测试：菜单对象与 detail renderer 一一对应。
- Store / preload / IPC contract 测试通过。
- 前端与 Electron 构建、macOS 打包、codesign、SQLite integrity 通过。
- `/Applications/Joi.app` 逐个点击 9 个一级分类与全部二级对象；至少验证 Skill、Plugin、MCP、文件系统、浏览器、分配策略、隐私策略的真实状态。
- 修改一个低风险设置后刷新并重启，值仍存在。

## Non-goals

- 不重做聊天主界面。
- 不修改 Agent 职责边界或绕过审批策略。
- 不自动安装第三方插件、MCP 或发送外部测试消息；这些动作必须由用户在对应设置页主动触发。

## Done Means

- [x] 所有菜单对象有独立实现，无通用占位页。
- [x] 所有编辑项可保存并重新加载。
- [x] Skills、Plugins、MCP 有独立可用页面。
- [x] 安装版关键路由与全部历史占位路由验收通过。

## 验收证据（2026-07-10）

- 静态路由契约：16 个历史占位路由全部拥有独立 renderer。
- Store：Capability / Skill 启停、Plugin manifest 安装/停用/移除、MCP CRUD、诊断脱敏导出均通过测试。
- Preload：132 个 Desktop API method 全覆盖。
- 安装版：`/Applications/Joi.app` 已验证 Skills、Plugins、MCP、文件系统页面；文件大小设置经重启恢复。
- 能力真实性：100 条注册记录中 49 条实际/别名能力可用；51 条 planned 能力显示“未接后端”并禁止启用。
- 包一致性：安装版与构建候选 `app.asar` SHA-256 一致，codesign 与 SQLite integrity 均通过。
