# Joi ACP structured error normalization — 2026-07-11

## Failure evidence

Telegram run `run_mrff11ordw69dq` routed correctly to `acp_codex_cli` and `gpt-5.6-terra[medium]`. Its trace then recorded:

1. `assistant.delta`: `You've hit your usage limit... try again at 6:28 AM.`
2. `runtime.error`: `[object Object]`
3. `assistant.completed`: `运行失败：[object Object]`

The failure layer was ACP runtime error normalization, not Telegram routing or delivery. A structured SDK rejection reached `safeACPErrorMessage`, where `String(object)` discarded all useful fields; the already streamed provider notice was also ignored by the catch path.

## Contract

- Unknown errors are inspected without invoking getters.
- Extraction priority is `message`, nested `error.message`, `code`, then bounded JSON.
- Traversal is cycle-safe, limited to four levels, 24 object keys, 16 array items, 2,048 characters per string, and 4,096 output characters.
- Secret-bearing keys and values are redacted. Raw `stderr` fields are replaced wholesale and never returned.
- If the ACP agent has already streamed a recognizable usage/rate-limit notice, that notice takes priority over the lower-level structured rejection so reset time and recovery guidance survive through Run Trace and Telegram failure formatting.

Regression coverage in `packages/runtime/scripts/test-acp-runtime.mjs` includes direct and nested object messages, code-only errors, bounded/circular JSON fallback, getter avoidance, secret/raw-stderr redaction, and an integrated fake ACP turn that streams the exact usage-limit wording before throwing a structured object.
