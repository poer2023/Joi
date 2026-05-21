# 09 模型路由策略

## 1. 原则

- 没有全局主模型。
- 每个 Agent 独立配置 default / fallback / cheap 模型。
- Router 可用轻量模型分类，但不是主模型。
- 敏感内容不经过不适合的模型链路。
- 工具能力不绑定模型。
- 模型调用必须记录成本、延迟、错误。

## 2. 禁止链路

```text
用户 → GPT 主模型 → Grok Agent → GPT 总结 → 用户
```

这种链路会让 GPT 看到所有输入和输出，导致策略边界污染其他模型。

## 3. 推荐链路

```text
用户 → Orchestrator / Router / Policy → 目标 Agent → 目标模型 → Response
```

## 4. Model Config

```json
{
  "id": "model_default",
  "provider": "openai_compatible",
  "model_name": "replace",
  "display_name": "Default Model",
  "base_url_env": "MODEL_DEFAULT_BASE_URL",
  "api_key_env": "MODEL_DEFAULT_API_KEY",
  "supports_json_mode": true,
  "supports_tool_calling": false,
  "enabled": true
}
```

## 5. Fallback 规则

可 fallback：

- 超时。
- 网络错误。
- provider 临时失败。
- JSON 输出失败。

不可自动 fallback：

- 内容策略拒绝。
- 隐私策略不允许。
- 用户明确指定模型。

## 6. 成本记录

每次 model_call 记录：

- run_id
- agent_id
- model_id
- provider
- input_tokens
- output_tokens
- cost_estimate
- latency_ms
- status
- error_code
