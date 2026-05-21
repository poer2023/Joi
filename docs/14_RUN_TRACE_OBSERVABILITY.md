# 14 Run Trace 与可观测性

## 1. Run Trace 要回答的问题

- 用户输入是什么？
- Router 选了哪个 Agent？
- 为什么选？
- 召回了哪些记忆？
- 调用了哪个模型？
- 请求了哪个 capability？
- 编译成哪些工具步骤？
- 在哪个节点执行？
- 哪一步失败？
- 最终回答从哪里来？

## 2. Run Step 类型

```text
input_received
session_resolved
router_started
router_selected
memory_search_started
memory_search_finished
agent_call_started
agent_call_finished
capability_requested
policy_checked
tool_compiled
node_selected
task_dispatched
tool_started
tool_finished
response_generated
memory_proposed
error
```

## 3. 必须记录

- Router input/output
- selected_agent
- selected_model
- retrieved_memory_ids
- memory scores
- capability_request
- policy decision
- workflow steps
- selected_node
- tool_runs
- model_calls
- final_response

## 4. UI 展示

Run Trace Detail 使用时间线展示：

```text
Input → Router → Memory → Agent → Capability → Policy → Tool → Node → Response
```

## 5. 指标

- total_runs
- failed_runs
- avg_run_duration
- avg_memory_search_duration
- avg_agent_latency
- tool_success_rate
- node_task_success_rate
- model_cost_estimate
