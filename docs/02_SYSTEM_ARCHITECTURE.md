# 02 系统架构设计

当前默认形态是 Desktop Mode。Server Mode 保留为高级部署形态，但不是本机日常入口。当前本机状态见 `docs/54_LOCAL_REPO_AND_APP_STATE.md`，模式边界见 `docs/40_MODE_MATRIX.md`。

## 1. 总体架构

```text
Desktop UI / Telegram / iMessage / optional Web Console
          ↓
Electron Main + Controlled Preload IPC
          ↓
┌─────────────────────────────────────────────┐
│ Local Desktop Runtime                       │
│ - SQLite Store                              │
│ - Settings / Keychain adapter               │
│ - Tool-calling turn loop                    │
│ - Prompt / Memory assembly                  │
│ - Capability executors                      │
│ - Policy / confirmation handling            │
│ - Run Trace / events                        │
│ - Telegram / iMessage inbound services      │
│ - Worker Gateway                            │
└─────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────┐
│ Optional Remote Worker Pool                 │
│ - worker-runtime / sidecars                 │
│ - minimal task payloads                     │
│ - no full memory database                   │
└─────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────┐
│ Storage                                     │
│ - Desktop: local SQLite                     │
│ - Secrets: macOS Keychain                   │
│ - Server Mode: optional Postgres/NATS       │
└─────────────────────────────────────────────┘
```

## 2. 主要模块

### apps/joi-electron

Electron-native 桌面壳。负责 main/preload/renderer、窗口生命周期、单实例恢复、受控 IPC、Keychain 加载、外部入口服务和 Worker Gateway。

### apps/joi-desktop/frontend

共享 React renderer。当前嵌入 Electron Desktop，也可作为浏览器预览/Server Mode UI 的基础。

### packages/store

TypeScript SQLite store。负责 conversation、message、run、run events、settings、memories、product tasks、artifacts、open loops、diagnostics、backup/restore 和 schema 初始化。

### packages/runtime

TypeScript runtime。负责 model provider、tool-calling turn loop、capability executors、workspace/file/web/exec/browser/computer/desktop-app/diagnostics capability，以及 Worker Gateway。

### packages/secrets

本机 secret adapter。macOS 默认使用 Keychain，环境变量只作为开发 fallback。

### Server Mode / Historical Services

以下服务属于 Server Mode 或历史 Go-first 架构，不是 Desktop Mode 启动前提：

- `apps/console-web`：Server Mode Web Console。
- `apps/telegram-gateway`：历史独立 Telegram gateway；当前 Desktop 也有本机 Telegram inbound。
- `services/orchestrator-core`：Go control plane / historical server path。
- `services/worker-runtime`：独立 Worker 执行节点。

## 3. 核心流程

### 普通聊天

```text
Desktop message
  ↓
SQLite conversation / message / run
  ↓
Prompt + Memory assembly
  ↓
Tool-calling runtime
  ↓
Model response and optional tool calls
  ↓
Capability executor
  ↓
Tool result回灌模型
  ↓
Final response + Run Trace
```

### 工具调用

```text
Model tool call
  ↓
validate schema
  ↓
permission / confirmation check
  ↓
capability executor
  ↓
result normalize
  ↓
persist tool_runs / run events
  ↓
feed tool result back to model
```

### 记忆写入

```text
raw event → candidate → normalize → conflict check → policy check → pending/confirmed
```

### 可选 Worker 派发

```text
Desktop Worker Gateway → worker register/heartbeat → claim → execute minimal task → ack/fail → trace
```

## 4. 技术选型

| 层 | Desktop Mode 技术 | Server Mode / 历史技术 |
|---|---|---|
| 前端 | Electron + React renderer | Web Console / Next.js |
| 控制平面 | Electron main + TypeScript runtime/store | Go orchestrator-core |
| AI 运行层 | TypeScript tool-calling runtime | Python/Go historical services |
| 数据库 | SQLite WAL | PostgreSQL |
| 检索 | SQLite FTS / local memory search | pgvector/Qdrant optional |
| 队列 | SQLiteTaskQueue / Worker Gateway | NATS JetStream optional |
| 部署 | `/Applications/Joi.app` | Docker Compose optional |
| 节点网络 | Worker Gateway；Worker 不直连 SQLite | SSH tunnel / server queue |

## 5. 关键边界

- Router 不生成最终回复。
- Capability executor 不调用 LLM，除非它本身被建模为受控 model capability。
- Policy Engine 只处理结构化决策。
- Memory OS 不做通用聊天。
- Worker 不保存主库，不接收完整长期记忆。
- 模型不能绕过 runtime 直接执行 shell、文件写入或浏览器操作。
- Desktop Mode 不要求 Docker、Postgres、NATS 或 localhost Web Console 才能启动。
