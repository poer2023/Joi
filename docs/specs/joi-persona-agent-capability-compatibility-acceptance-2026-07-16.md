# Joi 人格宪法与 Agent 全能力兼容验收（2026-07-16）

## Objective

默认 Joi 人格继续使用用户编写的硬人格宪法；默认 `per_joi_desktop` Agent 的工具授权与人格展示能力彻底解耦，并可请求全部已注册、已实现能力。

## Gate 0 — 兼容合同

- 人格宪法仍从 active `persona_constitutions.compiled_prompt` 注入每次工具调用 Prompt。
- `personas.capabilities` 只描述人格/产品层能力，不再覆盖默认 Agent 的执行授权。
- 默认 Agent 的执行授权持久化为 `['*']`；自定义 Agent 的显式能力列表保持收敛。
- “全能力”不改变会话 `permission_profile`，不启用 disabled capability，不暴露 planned/未配置后端。

## Gate 1 — 运行时与安全

- 普通 Joi 会话的 ACP capability bridge 至少包含 `tool_search`、`file_read`、`workspace_search`、`shell_start`、`browser_tabs`、`browser_console`、`browser_network`。
- 默认 `danger_full_access` 普通线程装载 90 项 Joi 原生工具：88 项 `joi_capabilities` 加 2 项独立 `joi_web` 工具。
- `read_only`、`workspace_write`、`danger_full_access` 仍按风险等级裁剪工具。
- workspace write / browser interaction 能力继续进入确认流；破坏性命令仍由 `full_access_blacklist_v1` 拒绝。
- Desktop 私聊子线程必须通过 conversation metadata 解析所属 room；本机 `desktop_user` 可按 room owner 身份审批，guest 仍被拒绝，审批失败必须在 UI 显示错误。
- ACP 工具结果在 Run Trace 中记录 canonical capability、真实风险/副作用、失败原因和非固定零值的耗时。

## Gate 2 — 安装版证据

- 构建并替换 `/Applications/Joi.app`，保留 `~/Library/Application Support/Joi`。
- 安装包签名通过，bundle provenance 指向本次源码。
- 真实普通会话可用 `tool_search` 发现 Joi 工具，并实际完成文件、浏览器、持久终端与安全拒绝压力题。
- SQLite 证据显示 `personas.per_joi_desktop` 的硬人格数据未被能力迁移改写，而 `agents.per_joi_desktop.capabilities=['*']`。

## Non-goals

- 不把 planned capability 冒充为已实现能力。
- 不修改用户编写的人格文本、关系设定或长期记忆。
- 不放宽工作区根目录、MCP token、disabled capability、确认和破坏性命令边界。

## Verification

```bash
pnpm --filter @joi/store test
pnpm --filter @joi/runtime test
pnpm --filter @joi/electron test:contract
pnpm --filter @joi/electron build
codesign --verify --deep --strict /Applications/Joi.app
```

安装版最终验收必须另附普通会话截图、bridge inventory 和 SQLite 查询结果，不能用上述单测替代。
