# 45 产品与闭环规格：伙伴前台 + 执行后台

## 1. 产品定义

Joi 的下一阶段定位：

```text
一个长期了解用户的 AI 伙伴。
平时以自然聊天、记忆和主动关心为主。
当用户交代严肃任务时，切换成可追踪、可交付、可审计的执行系统。
```

Joi 不应该是纯工作台，也不应该是纯陪伴聊天。纯工作台会冷，纯陪伴会软。目标体验是：

```text
能陪用户想，也能替用户做。
能记住用户，也能把事办完。
```

## 2. 产品分层

```text
Conversation Layer
- chat
- message
- channel
- tone
- conversation_type

Memory Layer
- memory_candidates
- confirmed_memories
- memory_usage_logs
- user_state
- open_loops

Task Layer
- product_tasks
- product_task_steps
- task_runs
- task_deliverables
- confirmations

Capability Layer
- capability
- tool_workflow
- tool_run
- risk_policy
- node_assignment

Artifact Layer
- report
- plan
- summary
- diff
- important_conversation_digest

Proactive Layer
- proactive_candidates
- scoring
- review
- delivery
- feedback
```

层之间的核心关系：

```text
聊天产生记忆
记忆影响回复
回复可能创建任务
任务调用工具
工具产生交付物
交付物反哺记忆
记忆和任务状态产生主动触达
用户反馈修正记忆和触达策略
```

## 3. 两个产品循环

### 3.1 伙伴循环

```text
用户聊天
→ 判断聊天性质
→ 提取记忆候选
→ 更新短期状态
→ 召回相关记忆
→ 用贴合用户的方式回应
→ 生成主动触达机会
→ 根据用户反馈调整理解
```

适用场景：

- 用户表达想法、困惑、偏好、方向修正。
- 用户问“你怎么看”“我现在方向对吗”。
- 用户要求 Joi 记住某件事。
- 用户在多个会话之间延续同一个项目判断。

伙伴循环的输出不一定是 Product Task。它可以只生成 memory candidate、open loop 或 proactive candidate。

### 3.2 执行循环

```text
用户交代任务
→ 自动识别任务类型
→ 创建 Product Task
→ 生成计划
→ 调用 Capability / Tool Workflow / Worker / workspace / web
→ 展示步骤变化
→ 遇到高风险操作请求确认
→ 产出 Artifact
→ 写入 Run Trace
→ 总结结果和下一步
→ 抽取任务相关记忆
```

适用场景：

- “帮我分析这个项目”
- “给我一份报告”
- “查一下并总结”
- “根据文件生成方案”
- “帮我改代码”
- “部署/诊断/执行某个明确工作”

执行循环必须留下可追溯证据，不能只给最终聊天回复。

## 4. 输入模式

主输入框支持轻量模式：

```text
自动判断（默认）
聊聊
认真执行
后台任务
```

默认使用自动判断，不要求用户先选择模式。

### 4.1 自动判断规则

| 用户表达 | 目标模式 | 行为 |
|---|---|---|
| “我有点迷茫” | chat_assist | 伙伴聊天，不创建任务 |
| “你觉得方向对吗” | chat_assist | 深度对话，可生成记忆，不一定创建任务 |
| “帮我分析这个项目” | serious_task | 创建 Product Task |
| “给我一份报告” | serious_task | 创建 Product Task + Artifact |
| “查一下然后总结” | serious_task | 创建 Product Task + Tool Workflow |
| “之后提醒我” | background_task | 创建 Open Loop + Proactive Candidate |
| “记住这个” | chat_assist | 创建 Memory Candidate |
| “帮我改代码” | serious_task | 创建高风险 Product Task，按 Capability policy 进入确认 |

### 4.2 模式覆盖

用户显式选择模式时，自动判断只能补充，不可反向覆盖：

- 用户选择“聊聊”，系统不得偷偷创建 serious task，除非用户后续明确下达任务。
- 用户选择“认真执行”，系统必须创建 Product Task 或说明为什么不能创建。
- 用户选择“后台任务”，系统必须生成 open loop、scheduled follow-up 或 proactive candidate。

## 5. 关键用户可见对象

### 5.1 Joi 对你的理解

默认右栏展示：

```text
我最近记住了这些
我可能理解错了这些
我准备之后提醒你这些
你可以改、删、禁止我记
```

禁止做成不可解释的用户画像大屏。每一条理解都必须可追溯、可纠正、可禁用。

### 5.2 Task Card

严肃任务进入后，聊天中插入任务卡片：

```text
任务：分析 Joi 与 Alma 差距并给优化方案
状态：执行中
计划：5 步
当前步骤：正在整理差距
风险：只读分析，无需确认
交付物：差距分析报告
Trace：run_xxx
```

### 5.3 Artifact

Artifact 是严肃任务的交付物，也是伙伴关系的阶段性记忆。

首批类型：

```text
report
plan
summary
diff
```

后续再扩展 gallery、image、dataset、code_bundle。

### 5.4 Proactive Candidate

主动触达先做候选审核，不直接乱发：

```text
Joi 想提醒你的事
- 伙伴提醒
- 任务进度
- 记忆确认
```

用户可以点：

```text
发送
忽略
有用
太烦
不准确
以后别这样
```

## 6. 成功指标

### 6.1 伙伴指标

| 指标 | MVP 目标 |
|---|---|
| 对话后 memory candidate 生成率 | 关键方向类对话 >= 80% |
| 用户确认/修正入口覆盖率 | 100% |
| 下次会话能召回核心方向 | 关键记忆 >= 90% |
| 无来源记忆 | 0 |
| 用户可删除/禁用记忆 | 100% |

### 6.2 执行指标

| 指标 | MVP 目标 |
|---|---|
| serious task 创建 Product Task | >= 90% |
| Product Task 至少有 1 个 task step | 100% |
| 工具调用关联 task/run/tool_run | 100% |
| Artifact 关联 task/run/source | 100% |
| 高风险操作误执行 | 0 |
| Trace 可打开 | 100% |

### 6.3 主动触达指标

| 指标 | MVP 目标 |
|---|---|
| 主动消息先进入审核队列 | 100% |
| 每条候选有 reason | 100% |
| 每日发送上限 | 默认 2 条 |
| 同主题重复提醒 suppression | 必须实现 |
| 用户负反馈可降低同类提醒 | 必须实现 |

## 7. 非目标

本阶段不做：

- 自动全量监控用户电脑活动。
- 无审核主动发送情绪类消息。
- 插件市场。
- 多模态 Gallery 宇宙。
- 把 setting center 继续扩成主体验。
- 让模型绕过 Capability/Tool Compiler 直接执行工具。
