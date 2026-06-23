# 00 产品 PRD：Joi Local-first Personal Agent OS

## 1. 产品定位

Joi 是一个运行在用户自有 Mac / Linux 主控节点上的 Local-first Personal Agent OS。当前默认产品形态是 Electron-native Desktop App：用户打开 `/Applications/Joi.app` 后，通过本地 UI 使用聊天、任务执行、长期记忆、工具调用、运行追踪和外部入口接续能力。

Server Mode 和 Web Console 仍然保留为高级部署形态，但不再是本机日常使用的默认入口。当前真实仓库、安装包和本机状态见 `docs/54_LOCAL_REPO_AND_APP_STATE.md`。

它不是普通多模型聊天客户端，不是单模型套壳，不是让多个 Agent 坐在一起群聊的演示项目。它是一个可长期运行、可观察、可干预、可治理的个人 AI 控制平面。

## 2. 用户核心需求

用户希望：

1. 在一个聊天通道里完成不同类型任务，不必频繁切换 Agent。
2. 配置多个 Agent，每个 Agent 可用不同模型。
3. 拥有长期、详细、可有效召回、可迭代的个人记忆。
4. Mac 或 Linux 主控具备完整能力，两台或多台 VPS 作为弹性节点。
5. 可以通过 Desktop UI 查看对话、执行过程、记忆、节点、工具、任务、模型路由和诊断状态。
6. 不希望所有消息被一个严格模型中转。
7. 不希望模型直接乱调工具。
8. 能手动指定任务在哪个节点执行，也能让系统高峰期自动派发。

## 3. 产品核心设计理念

### 3.1 控制系统，不是主 Agent

系统主控是 Orchestrator Core，由代码、状态机、规则、Policy、Router 和 Scheduler 组成。模型可以辅助分类和生成，但不能成为全局主控。

### 3.2 Agent 是岗位，模型是执行引擎

Agent 定义职责、能力、记忆范围、工具权限和输出风格。模型只是 Agent 的运行引擎。一个 Agent 可以有 default_model、fallback_model 和 cheap_model。

### 3.3 工具是平台能力

模型只请求 capability，例如 `server_diagnose`、`workspace_search`、`file_read`、`web_research` 或 `apply_patch`。系统把 capability 映射到受控执行器、权限边界、确认流程和 Run Trace。模型不能绕过 runtime 直接执行 shell、文件写入或浏览器操作。

### 3.4 Memory OS，不是向量库

长期记忆不是 top_k 相似度搜索。它必须记录事实、偏好、过程、结果、方法、反模式、决策和未解决问题，并通过使用反馈持续迭代。

### 3.5 主控完整，Worker 弹性

main-node 必须有完整任务能力。Worker 不固定工种，只通过 capability 注册能力。任务可以手动指定节点，也可以自动派发。

### 3.6 UI 是核心产品

没有 UI，用户只能相信黑箱。当前核心 UI 是 Electron Desktop：Chat、Run Trace、Memory、Product Tasks、Artifacts、Open Loops、Settings、Diagnostics 和外部入口状态都必须可检查。Web Console 是 Server Mode 的控制台，不是本机默认入口。

## 4. 核心模块

| 模块 | 说明 |
|---|---|
| Desktop App | Electron main/preload/renderer，本机默认产品入口 |
| Gateway | Desktop / Telegram / iMessage / Server Mode Web Console 等入口 |
| Runtime Core | 本地 TypeScript store/runtime、tool-calling loop、IPC 和外部入口服务 |
| Session Manager | 管理 active_agent、active_project、会话粘性 |
| Router | 显式路由、规则路由、小模型分类 |
| Agent Registry | Agent Card 配置 |
| Model Router | Agent 级模型选择与 fallback |
| Memory OS | 长期记忆存储、召回、治理、反馈 |
| Capability Layer | 模型可请求的高层能力 |
| Tool Runtime | Capability 转受控执行器并写入工具结果 |
| Policy Engine | 权限、安全、隐私、确认机制 |
| Worker Gateway | Desktop 内嵌远程 worker 协议，Worker 是可选执行节点 |
| Run Trace | 全链路追踪 |
| Server Mode | 高级 Web Console / orchestrator 部署形态 |

## 5. MVP 目标

当前 Desktop-first MVP 要跑通 5 条链路：

1. Desktop Chat 普通问答。
2. Desktop Chat 触发 Memory Search / Memory Write Proposal。
3. Tool-calling runtime 执行只读 capability，并把结果回灌给模型继续生成。
4. Telegram / iMessage 等外部入口进入稳定会话，并在 Desktop 可见。
5. 可选 Worker 通过 Worker Gateway 执行 web_research 或只读任务。

## 6. 非目标

第一阶段不做：

- 微信深度接入。
- 多租户。
- Kubernetes。
- 高风险自动执行。
- 无边界浏览器自动化通用 Agent。
- 插件市场。
- 多 Agent 群聊。

## 7. 成功指标

| 指标 | MVP 目标 |
|---|---|
| Run Trace 覆盖率 | 100% |
| Router 准确率 | ≥ 80% |
| Memory 召回有用率 | ≥ 70% |
| Tool Workflow 成功率 | ≥ 85% |
| 高风险误执行 | 0 |
| Worker 上下文泄露 | 0 |


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
11. Desktop UI 是当前 MVP 核心，Web Console 是 Server Mode 控制台，不是本机默认入口。
12. 每一次消息、路由、记忆召回、模型调用、工具执行、节点派发都必须写入 Run Trace。
13. 高风险工具默认需要确认，破坏性操作默认禁止。
14. 敏感内容不得经过不适合的模型链路，不能用严格模型做所有内容的中转。
