# AI 编码助手从这里开始

你要实现的不是聊天壳，而是 Local-first Personal Agent OS。

## 当前本地入口

先读：

```text
docs/54_LOCAL_REPO_AND_APP_STATE.md
docs/55_PROJECT_OVERVIEW.md
docs/36_DESKTOP_INSTALLATION.md
docs/53_ELECTRON_NATIVE_REFACTOR.md
```

当前真实仓库是 `/Users/hao/project/Joi`。旧路径 `/Users/hao/Documents/Joi` 是残留路径，不是当前源码。当前默认产品入口是 `/Applications/Joi.app`，Electron-native Desktop 是默认运行形态。

## 目标系统

用户可以在 Desktop / Telegram / iMessage / 可选 Server Mode Web Console 入口里发送一句话，系统内部完成：

```text
Desktop UI / External Entrance
  ↓
Electron Main + Controlled Preload IPC
  ↓
SQLite Store
  ↓
Prompt + Memory Assembly
  ↓
Tool-calling Runtime
  ↓
Policy / Confirmation Boundary
  ↓
Capability Executor
  ↓
Optional Worker Gateway
  ↓
Run Trace
  ↓
Response
```

## 第一条必须跑通的链路

```text
Desktop Chat 输入
  ↓
创建 conversation / message / run
  ↓
Router 选择 general_agent
  ↓
Memory Search 返回 Context Pack
  ↓
Tool-calling runtime 返回确定性 eval 回复或真实模型回复
  ↓
Run Trace 记录每一步
  ↓
Desktop UI 展示回复和 Trace
```

## 第二条必须跑通的链路

```text
用户：帮我检查 cloudflared 是否正常
  ↓
Router 选择 devops_agent
  ↓
模型产生受控 tool call: server_diagnose
  ↓
Policy Engine 判断 read_only 允许
  ↓
Desktop runtime 或用户指定 Worker 执行
  ↓
Tool Runtime 执行只读诊断
  ↓
Agent 解释结构化结果
  ↓
Run Trace 展示完整链路
```

## 第一阶段禁止做

- 不做微信深度接入。
- 不做 Kubernetes。
- 不做多租户 SaaS。
- 不把 Server Mode 作为本机默认入口。
- 不做浏览器全自动 Agent。
- 不做多 Agent 群聊。
- 不做高风险自动执行。
- 不做全局主模型。


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
