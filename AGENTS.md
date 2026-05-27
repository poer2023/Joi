# AI 编码助手开发规约

本文件给 Claude Code、Cursor、Codex 或其他 AI 编码助手读取。任何代码实现都必须遵守。

## Joi 项目本地规则

以下规则只适用于 `/Users/hao/Documents/Joi`，不要作为全局偏好使用。

- 每次需要重新构建 Joi app 并进行验证时，必须先确认新构建的功能正确；确认后自动删除旧的 app 包。
- 清理旧 app 包时，只删除已被新验证版本替代的旧构建产物；不得删除源码、当前验证通过的 app 包，或用户明确要求保留的产物。

## 开发顺序

1. 初始化仓库和 Docker Compose。
2. 建立 PostgreSQL schema。
3. 实现 Orchestrator Core 最小链路。
4. 实现 Run Trace 写入。
5. 实现 Agent Registry。
6. 实现 Router v0。
7. 实现 Memory OS v0。
8. 实现 Capability Request schema。
9. 实现 Tool Compiler v0。
10. 实现 Node Pool v0。
11. 实现 Web Console。
12. 接入 Telegram Gateway。

## 代码输出要求

每次完成任务后输出：

```text
已完成：
- xxx

修改文件：
- path

如何运行：
- command

如何测试：
- command

剩余问题：
- xxx
```

## API 响应格式

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "trace_id": "run_xxx"
}
```

错误：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "POLICY_DENIED",
    "message": "This capability requires confirmation",
    "details": {}
  },
  "trace_id": "run_xxx"
}
```

## 推荐目录

```text
agent-os/
  apps/
    console-web/
    telegram-gateway/
  services/
    orchestrator-core/
    agent-runtime/
    memory-service/
    worker-runtime/
    model-gateway/
  packages/
    shared-types/
    api-client/
  database/
    migrations/
  infra/
  configs/
  docs/
  prompts/
  tasks/
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
