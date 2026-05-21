# 18 Provider Cache Strategy

## 1. 目标

Phase 1.5 开始，所有模型调用必须先经过 Prompt Assembly Service。系统不得把零散 prompt 直接发给模型 provider。

Prompt Assembly 的目标：

- 明确区分可缓存稳定前缀和每轮动态尾部。
- 让 provider prompt cache 命中率可观测。
- 让 Run Trace 能还原本轮 Agent 看到的结构化上下文。
- 避免“全局主模型”概念，模型只作为 Agent 的执行引擎。

## 2. Prompt 分段

每一次 `ModelRequest` 必须包含：

```json
{
  "cacheable_prefix": "...",
  "dynamic_tail": "...",
  "prompt_cache_key": "agent:model:prefix_hash:memory_profile_version:tool_schema_version",
  "metadata": {}
}
```

### cacheable_prefix

稳定且适合 provider cache 的内容：

- Agent identity 与职责边界。
- Orchestrator/Policy/Tool Compiler 规则。
- Agent 输出 schema。
- Capability schema 摘要。
- Stable Memory Profile。
- Tool schema version。

### dynamic_tail

每轮变化内容：

- 当前用户消息。
- 当前 conversation/run id。
- 本轮 dynamic memory retrieval。
- 上一轮 capability/tool result。
- 本轮输出要求。

## 3. Hash 与版本

必须记录：

- `prefix_hash`: `sha256(cacheable_prefix)`。
- `dynamic_tail_hash`: `sha256(dynamic_tail)`。
- `memory_profile_version`: 稳定记忆 profile 的版本号，内容变化时更新。
- `tool_schema_version`: capability/tool schema 的版本号，MVP 固定为 `tool_schema_v1`。
- `prompt_cache_key`: 由 agent、model、prefix hash、memory profile version、tool schema version 组成。

## 4. 数据表

新增表：

- `prompt_templates`: Prompt 模板与版本。
- `prompt_assemblies`: 每次 run 的 prompt assembly 产物。
- `provider_cache_stats`: provider cache 命中统计。
- `memory_context_packs`: 本轮 Stable Profile + Dynamic Retrieval 的上下文包。

扩展 `model_calls`：

- `prompt_assembly_id`
- `prompt_cache_key`
- `prefix_hash`
- `dynamic_tail_hash`
- `cacheable_prefix_tokens`
- `dynamic_tail_tokens`
- `cached_input_tokens`
- `raw_response`

## 5. Provider Cache 统计

`provider_cache_stats` 必须按 provider/model/cache key 记录：

- input tokens
- cached input tokens
- hit ratio
- observed latency

如果 provider 不返回 cached token 信息，`cached_input_tokens` 记 0，`metadata.provider_cache_supported=false`。

## 6. Run Trace 要求

Run Trace API 必须返回：

- `prompt_assemblies`
- `model_calls`
- `memory_context_packs`

Trace Detail UI 应至少展示：

- prefix hash
- dynamic tail hash
- prompt cache key
- memory profile version
- model latency/tokens/cache tokens

## 7. 禁止事项

- 禁止跳过 Prompt Assembly 直接调用模型。
- 禁止模型直接执行底层工具。
- 禁止引入 `global_master_model`、`master_agent`、`root_agent`。
- 禁止把 private/secret 记忆放进 Worker 上下文或云模型 prompt。
