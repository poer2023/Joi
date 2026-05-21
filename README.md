# Local-first Personal Agent OS 工程文档包 v0.4

版本日期：2026-05-21

这是一套可直接交给 AI 编码助手开工的工程文档包。它包含 PRD、MVP 范围、系统架构、数据模型、Memory OS、Capability/Tool 协议、Node Pool、Agent Router、模型路由、安全权限、前端 UI、API、部署、Trace、测试、实施路线图、Prompt 模板、配置样例、SQL 初始 schema 和开发任务清单。

## 一句话定位

这是一个运行在 Mac / Linux 主控节点上的 **Local-first Personal Agent OS**：

- 单入口，多 Agent 自动路由。
- 多模型统一接入，但不存在全局主模型。
- 主控节点具备完整能力，Worker 节点只是弹性执行资源。
- 工具能力属于平台，不属于模型。
- 模型只提出 Capability Request，系统编译、校验、执行。
- 长期记忆是 Memory OS，不是简单向量库。
- Web Console 是控制台，不是装饰后台。
- 所有执行链路必须可追溯。

## 给 AI 编码助手的阅读顺序

1. `AI_START_HERE.md`
2. `AGENTS.md`
3. `docs/01_MVP_SCOPE_AND_ACCEPTANCE.md`
4. `docs/02_SYSTEM_ARCHITECTURE.md`
5. `docs/04_DATA_MODEL_AND_SQL.md`
6. `docs/05_MEMORY_OS_SPEC.md`
7. `docs/06_CAPABILITY_TOOL_PROTOCOL.md`
8. `docs/11_FRONTEND_UI_SPEC.md`
9. `tasks/00_BOOTSTRAP_TASKS.md`

## 包结构

```text
agent-os-spec-pack-v0.4/
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
