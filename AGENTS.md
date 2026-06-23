# AI 编码助手开发规约

本文件给 Claude Code、Cursor、Codex 或其他 AI 编码助手读取。任何代码实现都必须遵守。

## Joi 项目本地规则

以下规则只适用于 `/Users/hao/project/Joi`，不要作为全局偏好使用。

- 当前真实仓库是 `/Users/hao/project/Joi`。
- `/Users/hao/Documents/Joi` 是旧残留路径；不要把它当作源码、构建或验证入口。
- 如果线程 cwd 仍显示旧路径，先确认它是否已经是指向 `/Users/hao/project/Joi` 的 symlink；否则切换到真实仓库。
- 本地状态、安装包和旧残留处理记录见 `docs/54_LOCAL_REPO_AND_APP_STATE.md`。

- 每次需要重新构建 Joi app 并进行验证时，必须先确认新构建的功能正确；确认后自动删除旧的 app 包。
- 清理旧 app 包时，只删除已被新验证版本替代的旧构建产物；不得删除源码、当前验证通过的 app 包，或用户明确要求保留的产物。

## 开发顺序

1. 先确认真实仓库、安装 app 和当前本机状态。
2. 保持 Electron Desktop 能构建、安装、打开、关闭窗口后重新打开。
3. 保持 SQLite store、Run Trace、Memory OS 和 tool-calling runtime 可验证。
4. 保持 Desktop UI 与 `window.joi` preload contract 一致。
5. 保持 Telegram/iMessage/Worker Gateway 作为可选外部入口，不阻塞本地 Desktop 启动。
6. Server Mode / Web Console / Docker / Postgres / NATS 只在明确任务需要时处理。

## 回复要求

- 不使用固定收尾模板，不强制输出“已完成 / 修改文件 / 如何运行 / 如何测试 / 剩余问题”这类分段。
- 按任务实际情况自然回复；简单任务用一两句话即可，复杂任务只保留必要的改动、验证和剩余风险。
- 涉及代码或本机状态时，说明关键事实和验证结果；不要为了凑格式重复信息。

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
