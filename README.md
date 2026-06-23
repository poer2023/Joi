# Joi Local-first Personal Agent OS

Current local status: 2026-06-23

The active repository on this Mac is `/Users/hao/project/Joi`. The installed desktop app is `/Applications/Joi.app`. The stale `/Users/hao/Documents/Joi` path is not a source tree and must not be used for new work; see `docs/54_LOCAL_REPO_AND_APP_STATE.md`.

This repo contains the Joi Electron-native Desktop app, local SQLite runtime/store, Memory OS, tool-calling runtime, Worker Gateway, Telegram/iMessage ingress, and supporting product/architecture documentation.

## 一句话定位

这是一个运行在 Mac / Linux 主控节点上的 **Local-first Personal Agent OS**。当前默认产品入口是本机 Electron Desktop：

- 单入口，多 Agent 自动路由。
- 多模型统一接入，但不存在全局主模型。
- 主控节点具备完整能力，Worker 节点只是弹性执行资源。
- 工具能力属于平台，不属于模型。
- 模型只通过 tool-calling runtime 提出受控能力调用，系统校验、确认、执行并记录。
- 长期记忆是 Memory OS，不是简单向量库。
- Desktop UI 是默认控制台；Web Console 属于 Server Mode。
- 所有执行链路必须可追溯。
- Desktop 默认不依赖 Docker、Postgres、NATS 或浏览器 localhost 控制台。

## 给 AI 编码助手的阅读顺序

1. `AI_START_HERE.md`
2. `AGENTS.md`
3. `docs/55_PROJECT_OVERVIEW.md`
4. `docs/54_LOCAL_REPO_AND_APP_STATE.md`
5. `docs/36_DESKTOP_INSTALLATION.md`
6. `docs/53_ELECTRON_NATIVE_REFACTOR.md`
7. `docs/01_MVP_SCOPE_AND_ACCEPTANCE.md`
8. `docs/02_SYSTEM_ARCHITECTURE.md`
9. `docs/04_DATA_MODEL_AND_SQL.md`
10. `docs/05_MEMORY_OS_SPEC.md`
11. `docs/06_CAPABILITY_TOOL_PROTOCOL.md`
12. `docs/11_FRONTEND_UI_SPEC.md`
13. `tasks/00_BOOTSTRAP_TASKS.md`

## 包结构

```text
Joi/
  README.md
  AGENTS.md
  AI_START_HERE.md
  docs/
  configs/
  database/
  infra/
  prompts/
  tasks/
  apps/
  services/
  packages/
```


## 架构红线

以下内容在任何实现阶段都不能违反：

1. 不允许存在全局主模型，禁止 `global_master_model`、`master_agent`、`root_agent` 这类概念。
2. 控制系统必须是代码实现的 Orchestrator Core，不是某个 LLM。
3. Agent 是岗位，模型是执行引擎。Agent 可以换模型，模型不能拥有 Agent 的职责边界。
4. 模型不得直接执行底层工具，不得直接输出 shell / SQL / file_write / service_restart 并由系统执行。
5. 模型只能通过 tool-calling runtime 请求受控 capability，由 runtime 校验、确认、执行并记录结果。
6. 主控节点 main-node 必须具备完整任务能力。Worker 节点只是弹性执行资源。
7. Worker 不固定分工，不存在 Worker A 专做抓取、Worker B 专做模型代理这种硬拆。
8. Worker 通过 capabilities 注册能力，任务可以手动指定节点，也可以高峰期自动派发。
9. Worker 不默认接收完整长期记忆，不接收 secret，只拿最小必要上下文。
10. 长期记忆必须可追溯、可编辑、可禁用、可删除、可反馈、可迭代。
11. Desktop UI 是当前 MVP 核心，Web Console 是 Server Mode 控制台。
12. 每一次消息、路由、记忆召回、模型调用、工具执行、节点派发都必须写入 Run Trace。
13. 高风险工具默认需要确认，破坏性操作默认禁止。
14. 敏感内容不得经过不适合的模型链路，不能用严格模型做所有内容的中转。
