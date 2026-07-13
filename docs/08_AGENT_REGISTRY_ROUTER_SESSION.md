# 08 Agent Registry、Router 与 Session

## 1. Agent Card

```json
{
  "id": "devops_agent",
  "name": "运维 Agent",
  "description": "负责服务器、Docker、日志、部署。",
  "models": {
    "default": "model_default",
    "fallback": "model_fallback",
    "cheap": "model_cheap"
  },
  "allowed_capabilities": ["memory_search", "server_diagnose"],
  "memory_scope_rules": {
    "default_scopes": ["global", "project", "agent:devops_agent"]
  },
  "tool_policy": {
    "read_only": "auto",
    "write_candidate": "confirm",
    "state_change": "confirm",
    "destructive": "deny"
  },
  "route_hints": {
    "keywords": ["docker", "nginx", "cloudflared", "日志", "部署"]
  },
  "enabled": true
}
```

`allowed_capabilities` 是 runtime 的硬约束，不是 Prompt 提示。模型只会收到 allowlist 与当前 permission profile 的交集；未接入的 planned capability 和兼容 alias 只保留在能力清单中，默认不暴露给模型。

## 2. Router 输入

```json
{
  "message": "帮我看看 cloudflared 是不是挂了",
  "channel": "web",
  "session": {
    "active_agent": null,
    "active_project": "agent_os"
  },
  "available_agents": ["general_agent", "devops_agent"]
}
```

## 3. Router 输出

```json
{
  "intent": "server_diagnosis",
  "route_mode": "single",
  "lead_agent": "devops_agent",
  "support_agents": [],
  "capabilities": ["server_diagnose", "memory_search"],
  "memory_scopes": ["global", "project:infra"],
  "confidence": 0.91,
  "reason": "用户请求检查服务状态。"
}
```

## 4. 路由层级

1. 房间路由：项目人格房间绑定的 executor 优先。
2. 显式路由：`@devops_agent`、`@research_agent` 或 Agent 名称。
3. 规则路由：读取 Agent Card 的 `route_hints.keywords`。
4. 会话粘性：无显式或规则命中时沿用 active_agent。
5. 低置信度回退到 `general_agent`；后续可接结构化分类器，但分类器不得生成最终回复。

## 5. 规则示例

| 输入特征 | Agent |
|---|---|
| docker / nginx / cloudflared / 日志 / 部署 | devops_agent |
| PRD / 产品 / 页面 / 交互 | product_agent |
| 搜 / 查 / 最新 / 厂商 / 调研 | research_agent |
| 记住 / 以后 / 偏好 / 不要再 | memory_agent |

## 6. Session

```json
{
  "session_id": "sess_xxx",
  "active_agent": "devops_agent",
  "active_project": "agent_os",
  "topic": "cloudflared diagnosis",
  "expires_at": "..."
}
```

默认 30 分钟无消息后过期。
