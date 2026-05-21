# 05 Memory OS 详细规格

## 1. 定位

Memory OS 是长期、详细、可召回、可迭代、可治理的个人记忆系统。

它不是：

- 历史聊天搜索。
- 用户偏好 KV 表。
- 向量库 top_k。
- 把历史摘要塞进 prompt。

## 2. 记忆分层

| 层 | 名称 | 说明 |
|---|---|---|
| L0 | Raw Event Log | 原始消息、工具、模型、节点日志 |
| L1 | Working Memory | 当前任务临时状态 |
| L2 | Session Memory | 当前连续会话摘要 |
| L3 | Episode Memory | 一次任务过程和结果 |
| L4 | Semantic Memory | 稳定事实、偏好、环境 |
| L5 | Procedural Memory | 方法、经验、成功策略 |
| L6 | Reflective Memory | 反模式、冲突、策略升级 |

## 3. 记忆类型

| 类型 | 说明 |
|---|---|
| user_preference | 用户偏好 |
| project_fact | 项目事实 |
| environment_fact | 设备、服务器、工具环境 |
| episode | 任务过程 |
| outcome | 任务结果 |
| heuristic | 有效经验 |
| anti_pattern | 失败经验、不要再做 |
| entity | 实体 |
| relationship | 实体关系 |
| unresolved_issue | 未解决问题 |
| decision | 决策 |

## 4. 写入流程

```text
Raw Event
  ↓
Trigger Detection
  ↓
Memory Extractor
  ↓
Memory Candidate
  ↓
Normalizer
  ↓
Entity Resolver
  ↓
Conflict Detector
  ↓
Policy Check
  ↓
Write pending / confirmed
```

显式触发词：

```text
记住
以后
从现在开始
我的偏好
不要再
这个项目是
```

如果用户明确要求记住，可直接 `confirmed`。如果系统推断，默认 `pending`。

## 5. 记忆标准化示例

原文：

```text
别老给我推荐 k8s，我就是想轻量点。
```

标准化：

```json
{
  "type": "anti_pattern",
  "content": "在用户要求轻量部署时，不要默认推荐 Kubernetes，应优先考虑 Docker Compose、单机部署或 1Panel。",
  "confidence": 0.92
}
```

## 6. 召回策略

不能只用 embedding。

召回分三层：

### Tier 1：Profile Lookup

确定性查找：

- 用户全局偏好
- 当前项目事实
- 当前 Agent 规则
- 当前节点信息

### Tier 2：Hybrid Retrieval

混合检索：

- 向量相似度
- full-text search
- entity match
- metadata filter
- recency
- confidence
- usage success
- feedback

排序公式：

```text
score =
  0.30 * semantic_similarity
+ 0.20 * keyword_match
+ 0.15 * entity_match
+ 0.10 * confidence
+ 0.10 * recency
+ 0.10 * usage_success
+ 0.05 * user_feedback
```

### Tier 3：Deep Memory Reasoning

复杂任务使用：

```text
相关 episode → 实体扩展 → heuristic / anti_pattern → Context Pack
```

## 7. Memory Context Pack

Agent 看到的是 Context Pack，不是原始记忆表：

```json
{
  "profile": [],
  "project_facts": [],
  "environment_facts": [],
  "heuristics": [],
  "anti_patterns": [],
  "recent_episodes": [],
  "open_issues": [],
  "conflicts": []
}
```

## 8. 使用反馈

每条记忆使用后记录：

- retrieved
- injected
- used_in_answer
- user_feedback
- outcome

正反馈提高权重，负反馈降低权重，多次成功可升级为 heuristic，多次失败可形成 anti_pattern。

## 9. UI 治理

Memory Studio 必须支持：

- 查看
- 搜索
- 编辑
- 禁用
- 删除
- 合并
- 固定
- 查看来源
- 查看使用记录
- 处理冲突

## 10. 隐私等级

| 等级 | 规则 |
|---|---|
| public | 可给模型和 Worker |
| internal | 可给摘要 |
| private | 默认 main-node only |
| secret | 不进 prompt，不给 Worker |
