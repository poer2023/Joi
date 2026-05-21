# 00 Bootstrap Tasks

## Task 0：先复述架构约束

读取：

- AI_START_HERE.md
- AGENTS.md
- docs/01_MVP_SCOPE_AND_ACCEPTANCE.md
- docs/02_SYSTEM_ARCHITECTURE.md

输出理解，不写代码。

## Task 1：初始化仓库

创建目录结构，复制 docs、configs、prompts、database、infra。

## Task 2：数据库

执行 `database/001_init_schema.sql`，确认所有表存在。

## Task 3：Orchestrator health

实现：

- GET /health
- GET /ready

## Task 4：Chat mock 链路

实现 POST /api/chat/send：

- 创建 conversation
- 创建 message
- 创建 run
- 创建 run_steps
- 返回 mock response

## Task 5：Run Trace API

实现：

- GET /api/runs/:id
- GET /api/runs/:id/steps

## Task 6：Console Web

实现：

- Chat Workbench
- Run Trace Detail

## Task 7：Agent Registry

导入 agents.example.json，实现 GET /api/agents。

## Task 8：Router v0

实现：

- @agent
- keyword rules
- session active_agent

## Task 9：Memory OS v0

实现：

- GET /api/memories
- POST /api/memories/search
- POST /api/memories/propose

## Task 10：Capability v0

实现：

- capability_request schema
- server_diagnose_v1 compiler
- tool_runs
