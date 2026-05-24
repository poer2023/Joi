# 47 Conversation Reflection 与主动触达规格

## 1. 目标

Conversation Reflection Job 是 Joi 变得“越来越了解用户”的入口。它不是聊天回复本身，而是一次对话后的结构化反思：

```text
每次关键聊天或任务结束后
→ 判断聊天性质
→ 提取 memory candidates
→ 提取 task candidates
→ 更新 open loops
→ 生成 proactive opportunities
→ 写入可审核状态
```

没有 Reflection，Memory Inbox 会长期为空，Joi 也不会知道什么时候该主动接上未完成话题。

## 2. 触发时机

### 2.1 同步触发

用户消息完成后，如果满足任一条件，立刻运行 Reflection：

- `SendChat` 成功且本轮包含明确产品判断、偏好、任务请求、承诺、长期约束。
- `input_mode` 为 `serious_task` 或 `background_task`。
- run 产生了 artifact。
- run 产生 capability_request 或 tool_run。
- 用户使用“记住这个”“之后提醒我”“下次继续”等表达。

### 2.2 延迟触发

不阻塞聊天响应的场景，写入后台队列：

- 普通闲聊。
- 多轮长对话后批量总结。
- Telegram 入站消息。
- App 启动后发现最近会话未 reflection。

v0 可以在 `SendChat` 后同步执行，但要设置超时：

```text
max_latency_ms = 3000
on_timeout = skip_and_log
```

## 3. 输入

```json
{
  "conversation_id": "conv_xxx",
  "run_id": "run_xxx",
  "latest_messages": [],
  "current_memories": [],
  "active_product_tasks": [],
  "recent_artifacts": [],
  "tool_results": [],
  "channel": "desktop",
  "user_id": "default_user"
}
```

输入裁剪规则：

- latest_messages 默认取最近 12 条。
- current_memories 只取已确认且未 disabled 的相关记忆，最多 20 条。
- tool_results 只传摘要，不传完整敏感内容。
- artifacts 只传标题、类型、摘要和来源，不传大型正文。
- Telegram 触发时不传桌面本地敏感路径，除非该消息显式相关。

## 4. 输出 schema

```json
{
  "conversation_type": "product_direction_correction",
  "importance": "high",
  "should_create_task": true,
  "memory_candidates": [
    {
      "type": "product_goal",
      "content": "用户希望 Joi 同时具备伙伴式聊天和严肃任务执行能力。",
      "summary": "Joi 方向：伙伴前台 + 执行后台",
      "confidence": 0.98,
      "lifetime": "long",
      "scope_type": "project",
      "entities": ["Joi", "Product Direction"],
      "reason": "用户明确修正产品方向。"
    }
  ],
  "task_candidates": [
    {
      "title": "重构 Joi 为伙伴式前台 + 执行式后台",
      "description": "实现 Memory + Task + Artifact 闭环。",
      "priority": "high",
      "mode": "serious_task",
      "suggested_steps": []
    }
  ],
  "open_loops": [
    {
      "topic": "实现 Memory 与 Task 的共同底座",
      "suggested_followup": "下一步先做 Conversation Reflection 和 Task Card。",
      "priority": "high"
    }
  ],
  "proactive_opportunities": [
    {
      "type": "companion",
      "title": "下一步提醒",
      "body": "你刚把方向定成伙伴 + 执行混合体，今天最值得先做 Task 层和 Memory Reflection。",
      "reason": "这是当前产品定位变化后的最短路径。",
      "score": 0.86,
      "send_after": null
    }
  ]
}
```

## 5. Conversation Type

MVP 支持：

```text
ordinary_chat
emotional_support
product_direction
product_direction_correction
implementation_planning
serious_task_request
task_progress_update
memory_instruction
reminder_instruction
system_operation
```

`emotional_support` 只能生成低风险、低主动性的候选，默认不主动推送。

## 6. Memory Candidate 规则

### 6.1 可记内容

允许生成候选：

- 用户明确偏好。
- 产品方向、项目目标、长期约束。
- 已确认的重要决策。
- 反复出现的工作方式。
- 用户明确要求“记住”的内容。
- 任务中沉淀的可复用事实和教训。

### 6.2 不可记内容

不得自动生成候选：

- 一次性情绪判断。
- 没有来源的心理画像。
- 未经用户确认的敏感身份、健康、财务、政治等推断。
- secret、token、密码、私钥。
- 浏览器/本地文件中偶然出现的敏感内容。

### 6.3 写入规则

v0 写入 `memories`：

```text
status = pending
confidence = model confidence
metadata.candidate_source = conversation_reflection
metadata.reason = reason
source_event_ids = [conversation_id, message_id, run_id]
```

去重：

```text
同 type + 高相似 content + 同 scope → 不新增，改为更新已有 pending memory metadata.duplicate_count
已 confirmed 且内容一致 → 不新增，只写 memory_usage_logs
冲突内容 → 新增 pending memory 并设置 conflict_group_id
```

## 7. Task Candidate 规则

Reflection 可以创建 task candidate，但是否立即创建 Product Task 取决于场景：

| 场景 | 行为 |
|---|---|
| 用户明确说“帮我做/整理/分析/实现” | 立即创建 Product Task |
| 用户只是讨论方向 | 生成 task candidate，可显示为建议 |
| 用户说“之后提醒我” | 创建 open loop，不立即创建 Product Task |
| 用户要求后台持续关注 | 创建 background Product Task + proactive candidate |

Product Task 创建后：

- 写 `product_tasks`。
- 根据 suggested_steps 写 `product_task_steps`。
- 当前 run metadata 写 `product_task_id`。
- UI 插入 Task Card。

## 8. Open Loop 规则

Open Loop 表示未完成话题或未来跟进点。

创建条件：

- 用户明确表达“下次继续”“之后提醒我”。
- 严肃任务未完成但有明确下一步。
- Reflection 发现任务结果依赖用户确认。
- Artifact 生成后存在自然后续任务。

关闭条件：

- 用户完成对应任务。
- 用户 dismiss。
- 过期。
- 转换为 Product Task。
- 被 suppression 策略压制。

## 9. Proactive Scoring

每个 proactive candidate 计算 score：

```text
score =
  relevance * 0.35
  + urgency * 0.20
  + user_preference_fit * 0.20
  + freshness * 0.15
  - annoyance_risk * 0.10
```

维度说明：

| 维度 | 含义 |
|---|---|
| relevance | 与当前 confirmed memory / active task 的相关性 |
| urgency | 是否有明确时间、阻塞、确认需求 |
| user_preference_fit | 是否符合用户已确认偏好 |
| freshness | 距离上次同主题提醒的时间 |
| annoyance_risk | 重复、空洞、情绪推断、低信息量风险 |

低于阈值不入队：

```text
draft_threshold = 0.55
queue_threshold = 0.75
```

v0 只生成 `draft`，除非用户显式打开自动队列。

## 10. 主动触达策略

### 10.1 默认审核模式

```text
Reflection 生成候选
→ proactive_messages.status = draft
→ 桌面显示“Joi 想提醒你的事”
→ 用户发送 / 忽略 / 反馈
→ 记录反馈
```

### 10.2 Telegram 发送

Telegram 只发送满足以下条件的消息：

- Telegram gateway enabled。
- 用户已在桌面端批准该 proactive message。
- channel = telegram。
- allowlist 命中。
- 当前不在 quiet hours。
- 未超过 daily cap。

### 10.3 限流

默认：

```text
daily_cap_all = 2
daily_cap_companion = 1
daily_cap_task = 2
same_topic_cooldown_hours = 24
quiet_hours = 23:00-08:00
```

任务确认类消息优先级高于伙伴闲聊类消息。

## 11. Prompt 约束

Reflection prompt 必须明确：

```text
你不是在回复用户。
你是在生成可审核的结构化候选。
不要做无来源心理推断。
不要编造用户偏好。
不要提取 secret。
高风险操作只能生成确认需求，不能生成执行指令。
输出必须是 JSON。
```

## 12. Trace

每次 Reflection 必须写入：

- `run_steps.step_type = conversation_reflection`
- 输入摘要，不写完整敏感内容。
- 输出 counts：memory_candidates、task_candidates、open_loops、proactive_candidates。
- 如果创建 Product Task，写 `task_created` step。
- 如果创建 proactive draft，写 `proactive_candidate_created` step。

## 13. 验收用例

### 13.1 产品方向对话

输入：

```text
Joi 不是个人工作流，我要伙伴 + 执行能力。
```

期望：

- 生成 pending memory：伙伴前台 + 执行后台。
- 生成 task candidate：实现 Memory + Task + Artifact 闭环。
- 生成 open loop：下一步做 Task Card 和 Reflection。
- 生成 proactive draft：提醒先做共同闭环。

### 13.2 普通闲聊

输入：

```text
今天有点累。
```

期望：

- 不创建 Product Task。
- 不生成高置信长期记忆，除非用户明确要求。
- 可生成低优先 open loop，但默认不主动发送。

### 13.3 严肃任务

输入：

```text
帮我分析 Alma 和 Joi 的差距，并给出下一步。
```

期望：

- 创建 Product Task。
- 创建至少 3 个 task steps。
- 调用已有 workflow 时可关联 tool_run。
- 生成 report artifact。
- 结束后生成 memory proposal。
