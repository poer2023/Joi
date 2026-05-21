# 13 部署与运维规格

## 1. 部署目标

- main-node 单机部署。
- worker-node 多节点部署。
- Docker Compose 启动。
- 公网 SSH 反向隧道用于第一版远程 worker；PostgreSQL / NATS 不公网裸露。

## 2. 主控服务

main-node 运行：

- postgres
- nats
- orchestrator-core
- agent-runtime
- memory-service
- console-web
- telegram-gateway
- worker-runtime-main

## 3. Worker 服务

worker-node 运行：

- worker-runtime
- optional python tools

Worker 不运行主库，不运行主控，不保存完整记忆。

## 4. 端口

| 服务 | 端口 |
|---|---|
| console-web | 3000 |
| orchestrator-core | 8080 |
| agent-runtime | 8091 |
| memory-service | 8092 |
| worker-runtime | 8093 |
| postgres | 5432 |
| nats | 4222 |

## 5. 环境变量

见 `infra/env.example`。

## 6. 启动顺序

```text
postgres → nats → migrations → orchestrator → memory-service → agent-runtime → console-web → gateway → worker
```

## 7. 健康检查

每个服务提供：

- GET /health
- GET /ready

## 8. 备份

MVP 每日备份：

- PostgreSQL dump
- configs
- uploaded_files

## 9. 故障处理

- PostgreSQL 不可用：拒绝新 run。
- NATS 不可用：Worker 派发暂停，main-node 本地任务继续。
- Worker 离线：自动任务不派发，手动任务提示。
