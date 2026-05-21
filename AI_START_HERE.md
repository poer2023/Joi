# AI 编码助手从这里开始

你要实现的不是聊天壳，而是 Local-first Personal Agent OS。

## 目标系统

用户可以在 Web / Telegram / 后续微信入口里发送一句话，系统内部完成：

```text
Gateway
  ↓
Orchestrator Core
  ↓
Session Manager
  ↓
Router
  ↓
Policy Engine
  ↓
Memory OS
  ↓
Agent Runtime
  ↓
Capability Request
  ↓
Tool Compiler
  ↓
Node Scheduler
  ↓
Tool Runtime / Worker Runtime
  ↓
Run Trace
  ↓
Response
```

## 第一条必须跑通的链路

```text
Web Chat 输入
  ↓
创建 conversation / message / run
  ↓
Router 选择 general_agent
  ↓
Memory Search 返回 Context Pack
  ↓
Agent Runtime 返回 mock 或真实回复
  ↓
Run Trace 记录每一步
  ↓
Web Console 展示回复和 Trace
```

## 第二条必须跑通的链路

```text
用户：帮我检查 cloudflared 是否正常
  ↓
Router 选择 devops_agent
  ↓
Agent 产生 capability_request: server_diagnose
  ↓
Tool Compiler 编译 server_diagnose_v1
  ↓
Policy Engine 判断 read_only 允许
  ↓
Node Scheduler 选择 main-node 或用户指定 Worker
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
- 不做完整桌面端。
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
5. Agent 只能请求 Capability，Tool Compiler 再把 Capability 编译成固定 Tool Workflow。
6. 主控节点 main-node 必须具备完整任务能力。Worker 节点只是弹性执行资源。
7. Worker 不固定分工，不存在 Worker A 专做抓取、Worker B 专做模型代理这种硬拆。
8. Worker 通过 capabilities 注册能力，任务可以手动指定节点，也可以高峰期自动派发。
9. Worker 不默认接收完整长期记忆，不接收 secret，只拿最小必要上下文。
10. 长期记忆必须可追溯、可编辑、可禁用、可删除、可反馈、可迭代。
11. Web Console 是 MVP 核心，不是后补后台。
12. 每一次消息、路由、记忆召回、模型调用、工具执行、节点派发都必须写入 Run Trace。
13. 高风险工具默认需要确认，破坏性操作默认禁止。
14. 敏感内容不得经过不适合的模型链路，不能用严格模型做所有内容的中转。
