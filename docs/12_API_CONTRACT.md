# 12 API Contract

## 1. 通用响应

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
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": {}
  },
  "trace_id": "run_xxx"
}
```

## 2. Chat

### POST /api/chat/send

```json
{
  "conversation_id": "conv_xxx",
  "channel": "web",
  "message": "帮我看看 cloudflared 是否正常",
  "options": {
    "explicit_agent": null,
    "preferred_node": "auto",
    "allow_tools": true
  }
}
```

## 3. Runs

- GET /api/runs
- GET /api/runs/:id
- GET /api/runs/:id/steps
- POST /api/runs/:id/cancel

## 4. Agents

- GET /api/agents
- POST /api/agents
- GET /api/agents/:id
- PATCH /api/agents/:id
- POST /api/agents/:id/enable
- POST /api/agents/:id/disable
- POST /api/agents/:id/test-route

## 5. Memories

- GET /api/memories
- POST /api/memories/search
- POST /api/memories/propose
- PATCH /api/memories/:id
- POST /api/memories/:id/confirm
- POST /api/memories/:id/disable
- POST /api/memories/:id/archive
- DELETE /api/memories/:id
- GET /api/memories/:id/usage
- POST /api/memories/:id/feedback

## 6. Nodes

- GET /api/nodes
- GET /api/nodes/:id
- POST /api/nodes/register
- POST /api/nodes/:id/heartbeat
- PATCH /api/nodes/:id
- POST /api/nodes/:id/enable
- POST /api/nodes/:id/disable
- POST /api/nodes/:id/test

## 7. Capabilities

- GET /api/capabilities
- GET /api/capabilities/:id
- POST /api/capabilities/:id/test

## 8. Tasks

- GET /api/tasks
- GET /api/tasks/:id
- POST /api/tasks/:id/cancel
- POST /api/tasks/:id/retry
- POST /api/tasks/:id/reassign

## 9. Models

- GET /api/models
- POST /api/models
- PATCH /api/models/:id
- POST /api/models/:id/test
- POST /api/models/:id/disable

## 10. Confirmations

- GET /api/confirmations/:id
- POST /api/confirmations/:id/approve
- POST /api/confirmations/:id/deny
