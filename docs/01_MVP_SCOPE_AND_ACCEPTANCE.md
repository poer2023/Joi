# 01 Desktop-first MVP 范围与验收标准

本文件描述当前 Joi Desktop-first MVP。历史 Web Console / Postgres / NATS 方案保留为 Server Mode，不再是本机默认验收路径。

## 1. MVP 必须实现

### P0 核心链路

- Electron Desktop 可发送消息。
- SQLite store 创建 conversation / message / run。
- Run Trace 记录 input、router、memory、model call、tool call、tool result、response。
- Agent Registry 至少有 5 个 Agent。
- Router v0 支持显式路由和规则路由。
- Memory OS v0 支持写入、检索、编辑、禁用、usage log。
- Tool-calling runtime 支持模型原生 tool calls、工具结果回灌、取消和确认恢复。
- Capability executor 支持 `workspace_search`、`file_read`、`file_analyze`、`web_research`、`system_health_check`、`server_diagnose`。
- Policy Engine 支持 read_only allow、state_change confirm、destructive deny。
- Worker Gateway 支持可选 Worker 注册、心跳、claim、ack/fail。
- Telegram/iMessage 外部入口可进入稳定 conversation，并在 Desktop 可见。

## 2. MVP 不做

- 微信深度接入。
- 移动 App。
- Kubernetes。
- 多租户。
- 插件市场。
- 无边界浏览器自动操作。
- 高风险自动执行。
- 多 Agent 群聊。

## 3. 第一批 Agent

| Agent | 职责 | Capability |
|---|---|---|
| general_agent | 默认问答 | memory_search, memory_write_proposal |
| product_agent | PRD、交互、产品设计 | memory_search, file_analyze |
| devops_agent | 本机、服务器、日志、部署 | memory_search, server_diagnose |
| research_agent | 联网研究、资料整理 | memory_search, web_research |
| memory_agent | 记忆抽取、治理、冲突 | memory_search, memory_write_proposal |

## 4. 第一批 Capability

| Capability | 行为 | 风险 |
|---|---|---|
| memory_search | 构建 Memory Context Pack | read_only |
| memory_write_proposal | 生成记忆候选 | write_candidate |
| web_research | 搜索和读取网页 | read_only |
| file_analyze | 分析授权文件 | read_only |
| server_diagnose | 只读服务诊断 | read_only |
| worker_gateway_dispatch | 派发任务到可选 Worker | 取决于任务 |

## 5. 第一批页面

| 页面/区域 | MVP 要求 |
|---|---|
| Chat Workbench | 发送消息、查看当前 run |
| Run Trace | 查看完整执行链路 |
| Memory | 查看、编辑、禁用、删除记忆 |
| Product Tasks | 查看任务、步骤、闭环状态 |
| Artifacts / Open Loops | 查看产物与未闭环事项 |
| External Entrances | 查看 Telegram/iMessage/Worker Gateway 状态 |
| Model Settings | 查看 Agent 模型配置 |
| Settings | 基础配置 |

## 6. 验收链路 A：Desktop 普通聊天

输入：

```text
帮我总结当前 Agent OS 项目定位
```

验收：

- 创建 conversation、message、run。
- Router 选择 general_agent 或 product_agent。
- Memory Search 可执行并写 usage log。
- Tool-calling runtime 或确定性 eval runtime 生成回复。
- Run Trace 可查看全过程。

## 7. 验收链路 B：服务诊断

输入：

```text
帮我检查 cloudflared 服务是否正常
```

验收：

- Router 选择 devops_agent。
- Agent 输出 capability_request。
- Policy Engine 允许 read_only。
- Desktop 本机 runtime 或指定 Worker 执行只读诊断。
- tool_runs 有记录。
- 最终回复解释诊断结果。

## 8. 验收链路 C：记忆写入

输入：

```text
记住：我轻量部署优先 Docker Compose，不要默认推荐 Kubernetes。
```

验收：

- 写入 memories。
- type 为 user_preference / anti_pattern / heuristic 之一。
- status 为 confirmed 或 pending。
- source_event_ids 非空。
- 后续部署问题能召回。

## 9. 验收链路 D：可选 Worker 派发

输入或 UI 选择：

```text
Run on: node-vps-la
```

验收：

- 检查节点在线。
- 检查 capability 匹配。
- 检查 privacy_level。
- Worker 只收到最小上下文。
- Trace 展示 selected_node。
