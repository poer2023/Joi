# 01 MVP 范围与验收标准

## 1. MVP 必须实现

### P0 核心链路

- Web Console 可发送消息。
- Orchestrator 创建 run。
- Run Trace 记录 input、router、memory、agent、response。
- Agent Registry 至少有 5 个 Agent。
- Router v0 支持显式路由和规则路由。
- Memory OS v0 支持写入、检索、编辑、禁用、usage log。
- Capability Request schema 可用。
- Tool Compiler 支持 `server_diagnose_v1`。
- Policy Engine 支持 read_only allow、state_change confirm、destructive deny。
- Node Pool 支持 main-node 注册、Worker 注册、心跳、手动指定。
- Telegram Gateway 可收发消息。

## 2. MVP 不做

- 微信深度接入。
- 移动 App。
- 桌面客户端。
- Kubernetes。
- 多租户。
- 插件市场。
- 完整浏览器自动操作。
- 高风险自动执行。
- 多 Agent 群聊。

## 3. 第一批 Agent

| Agent | 职责 | Capability |
|---|---|---|
| general_agent | 默认问答 | memory_search, memory_write_proposal |
| product_agent | PRD、交互、产品设计 | memory_search, file_analyze |
| devops_agent | Docker、服务器、日志、部署 | memory_search, server_diagnose |
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
| node_dispatch | 派发任务到节点 | 取决于任务 |

## 5. 第一批页面

| 页面 | MVP 要求 |
|---|---|
| Chat Workbench | 发送消息、查看当前 run |
| Run Trace | 查看完整执行链路 |
| Memory Studio | 查看、编辑、禁用、删除记忆 |
| Agent Registry | 查看、启用、禁用 Agent |
| Node Console | 查看节点状态、心跳、能力 |
| Capability Console | 查看 capability 和 workflow |
| Model Routing Console | 查看 Agent 模型配置 |
| Settings | 基础配置 |

## 6. 验收链路 A：普通聊天

输入：

```text
帮我总结当前 Agent OS 项目定位
```

验收：

- 创建 conversation、message、run。
- Router 选择 general_agent 或 product_agent。
- Memory Search 执行并写 usage log。
- Agent 生成回复。
- Run Trace 可查看全过程。

## 7. 验收链路 B：服务诊断

输入：

```text
帮我检查 cloudflared 服务是否正常
```

验收：

- Router 选择 devops_agent。
- Agent 输出 capability_request。
- Tool Compiler 编译 server_diagnose_v1。
- Policy Engine 允许 read_only。
- Node Scheduler 选择 main-node 或指定节点。
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

## 9. 验收链路 D：手动节点派发

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
