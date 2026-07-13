# Joi 设置 Runtime 完整性验收合同

## Objective

复查设置中心全部路由，不只验证页面存在，还要求每个可编辑项被真实 Runtime、连接测试或持久化流程消费；无法作为核心功能成立的预留入口必须从菜单移除。

## Gate 0：审计结论

| 设置项 | 当前问题 | 本轮处理 |
| --- | --- | --- |
| 微信 Claw | 只有配置存储，无已定义桥接协议或入站 Runtime | 从核心入口菜单移除，后续由 Plugin 提供 |
| CLI | 只有 socket 路径存储，无监听器或客户端契约 | 从核心入口菜单移除，后续由 Plugin 提供 |
| Webhook | 假启用开关与假路径；真实实现位于自动化 Hook | 改为真实 Hook 列表与创建入口 |
| 桌面通知 | 只有本地通知测试 | 收窄页面承诺，只配置和测试 macOS 通知 |
| 节点分配策略 | 已保存，但 Desktop Chat 固定 main-node | 接入 Desktop 请求路由；隐私策略优先 |
| 隐私策略 | 本地优先与远端确认只保存不执行 | 接入节点路由；破坏性操作改为不可关闭的 Runtime 红线 |
| GitHub | Token/仓库可保存，但无法验证连接 | 增加真实 GitHub API 连接测试 |
| MCP Registry | 默认插入无命令的占位 Server | 不再 seed，并清理旧占位记录 |
| 模型温度 | 高级字段未写入模型配置 | 移除重复假字段，保留真实的逐模型配置 |

## Gate 1：实现要求

- 菜单不出现没有核心 Runtime 的微信 Claw、CLI。
- Webhook 页面只展示真实 automation Hook，不保留无消费者开关。
- Desktop Chat 的 `preferred_node` / `allow_worker` 来自节点与隐私设置。
- 本地优先必须强制 main-node；远端确认开启时不得自动派发。
- GitHub 测试必须读取 Keychain Token，并请求配置的 API。
- MCP 列表不再用 `local_mcp_registry` 冒充已配置 Server。
- 设置页无无事件按钮、无非受控 checkbox、无未保存字段。

## Gate 2：验证

- 全路由静态契约与设置消费者审计通过。
- Store、Secrets、Preload、Electron、Frontend 测试与构建通过。
- `/Applications/Joi.app` 可见菜单、Webhook、GitHub、节点策略、隐私策略符合合同。
- 安装版与候选 `app.asar` 一致，codesign 与 SQLite integrity 通过。

## Non-goals

- 不虚构未知的微信桥接协议。
- 不自动安装第三方 Plugin、MCP 或发送外部消息。
- 不开放破坏性能力。

## Done Means

- [x] 无剩余“保存但不消费”的可见设置项。
- [x] 无核心菜单占位入口。
- [x] 安装版完成可见验证。

## Evidence（2026-07-10）

- 聊天入口安装版只显示 Telegram、iMessage、桌面通知、Webhook。
- Webhook 安装版展示真实 Automation Hook 数量与创建入口。
- MCP 历史占位记录清理后数量为 0，空态不再冒充 Server。
- GitHub 页面提供 Keychain Token、默认仓库与真实 API 连接测试；未在验收中发送 Token。
- Desktop Chat 路由已由本地优先、远端执行、分配策略和远端确认共同决定，路由矩阵测试通过。
- `test:settings-completion`、Store、Frontend、Electron、133 项 Preload contract 均通过。
- `/Applications/Joi.app` codesign、SQLite integrity 通过，安装版与候选 `app.asar` SHA-256 一致。
