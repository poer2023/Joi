# 17 Prompt 模板说明

Prompt 文件在 `prompts/` 下。

## 1. router_intent_classifier.md

用途：规则路由无法判断时，让轻量模型输出 JSON 路由结果。

## 2. memory_extractor.md

用途：从对话中抽取长期有价值的记忆候选。

## 3. memory_context_builder.md

用途：把召回的 memories 压缩为 Memory Context Pack。

## 4. agent_runtime.md

用途：约束 Agent 输出 final_answer 或 capability_request。

## 5. 输出修复

JSON 解析失败时最多 repair 两次，仍失败则返回 STRUCTURED_OUTPUT_FAILED。
