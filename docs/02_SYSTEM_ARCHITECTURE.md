# 02 系统架构设计

## 1. 总体架构

```text
Web / Telegram / 后续微信 / CLI
          ↓
Gateway Layer
          ↓
Orchestrator Core
          ↓
┌─────────────────────────────────────────────┐
│ Control Plane                               │
│ - Session Manager                           │
│ - Intent Router                             │
│ - Agent Registry                            │
│ - Model Router                              │
│ - Policy Engine                             │
│ - Memory Orchestrator                       │
│ - Capability Manager                        │
│ - Tool Compiler                             │
│ - Node Scheduler                            │
│ - Run Trace Logger                          │
└─────────────────────────────────────────────┘
          ↓
Runtime Layer
          ↓
┌─────────────────────────────────────────────┐
│ - Agent Runtime                             │
│ - Tool Runtime                              │
│ - Memory Extractor                          │
│ - Embedding Service                         │
│ - Model Provider Adapter                    │
└─────────────────────────────────────────────┘
          ↓
NATS JetStream
          ↓
Node Pool
          ↓
┌─────────────────────────────────────────────┐
│ main-node                                   │
│ node-vps-la                                 │
│ node-vps-hk                                 │
│ other-worker                                │
└─────────────────────────────────────────────┘
          ↓
Storage
          ↓
PostgreSQL + pgvector / 后续 Qdrant
```

## 2. 服务拆分

### apps/console-web

Next.js 前端。包含 Chat Workbench、Run Trace、Memory Studio、Agent Registry、Node Console、Capability Console、Model Routing Console、Settings。

### apps/telegram-gateway

Telegram 入口，负责接收消息、转换为内部事件、调用 Orchestrator、发送回复。

### services/orchestrator-core

Go 实现。系统控制平面，负责 run、router、policy、memory、agent、capability、node、trace 的编排。

### services/agent-runtime

Python 实现。负责加载 Agent Card、构造 prompt、调用 model provider、解析 final_answer 或 capability_request。

### services/memory-service

Python 实现。负责 memory search、memory extraction、context pack、embedding、conflict、feedback。

### services/worker-runtime

Go + Python tools。负责节点注册、心跳、任务消费、工具执行、结果回传。

### services/model-gateway

MVP 可内嵌在 agent-runtime，后续独立。负责 provider adapter、fallback、成本记录、超时和重试。

## 3. 核心流程

### 普通聊天

```text
Message → create run → resolve session → router → memory search → agent runtime → response → trace
```

### 工具调用

```text
Agent capability_request
  ↓
validate schema
  ↓
policy check
  ↓
tool compiler
  ↓
workflow
  ↓
node scheduler
  ↓
tool runtime
  ↓
result normalize
  ↓
agent interpret
```

### 记忆写入

```text
raw event → extractor → candidate → normalize → conflict check → policy check → pending/confirmed
```

### 节点派发

```text
workflow → scheduler → task → NATS → worker → result → trace
```

## 4. 技术选型

| 层 | 技术 |
|---|---|
| 前端 | Next.js + React + TanStack Query + Tailwind |
| 控制平面 | Go |
| AI 运行层 | Python |
| 数据库 | PostgreSQL |
| 向量 | MVP pgvector，后续 Qdrant |
| 队列 | NATS JetStream |
| 部署 | Docker Compose |
| 节点网络 | 公网 SSH 反向隧道；PostgreSQL / NATS 不公网裸露 |

## 5. 关键边界

- Router 不生成最终回复。
- Tool Compiler 不调用 LLM。
- Policy Engine 只处理结构化决策。
- Memory Service 不做通用聊天。
- Worker 不保存主库。
- Agent Runtime 不直接执行工具。
