# Telegram Gateway v0

This gateway is intentionally thin. It only accepts Telegram private text messages and calls the Orchestrator API.

Environment:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
ORCHESTRATOR_URL=http://localhost:8080
CONSOLE_BASE_URL=http://localhost:3000
```

Scope:

- Private text messages only.
- Explicit agent routing through message aliases such as `@devops`, `@devops_agent`, `@memory`, or `@memory_agent`.
- Optional `TELEGRAM_ALLOWED_USER_IDS` whitelist. Non-whitelisted users are rejected when the list is configured.
- Replies with selected agent, selected node, final result, and a Trace link.
- Does not access Agent Runtime, Memory, Tool Runtime, or Task Queue directly.

Out of scope for v0:

- Group chat permissions.
- Images, files, voice, buttons, or WeChat.
- Public Trace URL or tunnel configuration.
