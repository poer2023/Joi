# 16 实施路线图

## Phase 0：仓库初始化

- 初始化 monorepo。
- 建立 Docker Compose。
- 建立 PostgreSQL 和 NATS。
- 加入 migration。
- 写 health API。

## Phase 1：Orchestrator + Run Trace

- POST /api/chat/send。
- 创建 conversation / message / run。
- 写 run_steps。
- 返回 mock response。
- 前端能展示 Trace。

## Phase 2：Agent Registry + Router v0

- 导入 agents seed。
- GET /api/agents。
- 显式路由。
- 关键词路由。
- session 粘性。
- route trace。

## Phase 3：Agent Runtime + Model Adapter

- provider interface。
- mock provider。
- OpenAI-compatible provider。
- model_calls logging。
- structured output parser。

## Phase 4：Memory OS v0

- memories。
- memory_embeddings。
- memory_search。
- memory_write_proposal。
- context pack。
- Memory Studio。

## Phase 5：Capability + Tool Compiler

- capability_request schema。
- server_diagnose_v1。
- Policy Engine。
- tool_runs。
- Trace 展示 workflow。

## Phase 6：Node Pool

- nodes。
- worker register。
- heartbeat。
- Node Console。
- manual dispatch。
- NATS task dispatch。

## Phase 7：Telegram Gateway

- Bot 接入。
- 消息转发 Orchestrator。
- 回复用户。
- Run Trace 关联。

## Phase 8：安全增强

- confirmations。
- state_change confirm。
- private main-node only。
- secret redaction。
