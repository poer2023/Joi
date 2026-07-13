# Joi 记忆系统审计（2026-07-11）

## 当前证据

- Live DB: `~/Library/Application Support/Joi/joi.db`
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: 0 条异常
- 记忆 13 条：confirmed 8、pending 1、proposed 1、rejected 2、deleted 1
- 使用日志 65 条，覆盖 8 条记忆；49 条标记为 used in answer
- Context pack 175 个，其中 98 个包含动态召回
- Feedback 2 条；当前无 conflict / merge 记录

## 结论

当前 Memory OS 的治理骨架是完整的：候选、确认、纠正、删除、禁用、冲突字段、使用日志、反馈和 context pack 都存在，SQLite 完整性正常。当前优先级不是替换存储或立即引入向量数据库，而是提高召回隔离、命中质量和可解释性。

## 优化优先级

### P0：scope-aware retrieval

`searchPromptMemories(query, limit)` 目前只按 confirmed / disabled / merged / TTL 过滤，没有把当前 project、room、user scope 带入 SQL。项目约束可能跨项目进入 prompt。应从当前 room/conversation 解析 project/user scope，只允许 global + 当前 user + 当前 room + 当前 project；跨项目召回必须由显式 scope override 或路由决策授权。

验收：为两个项目写入同关键词记忆，默认会话只召回当前项目；显式 cross-project 才可召回另一项目，并写入 Run Trace。

### P1：候选集截断顺序

当前先按 pinned / confidence / updated_at 截断 60 条，再在 JS 中算关键词命中。规模增长后，较旧但高度相关的记忆可能在打分前被丢弃。先做 SQLite FTS5 / 词项候选与治理候选的并集，再统一 rerank；保留 pinned 和记忆 TTL 规则。

验收：超过 60 条 confirmed memory 时，较旧的精确关键词记忆仍进入 top 8。

### P1：注入质量指标

65 条注入中 16 条未标记为 used in answer。应在“数据与记忆”展示召回数、注入数、实际使用数、负反馈率、按 scope 的误召回率，并允许从 run 反查为何召回。

验收：每条 context pack 可查看 score、reason、scope match、是否注入、是否用于回答及反馈。

### P2：候选积压与生命周期

当前量很小，不需要自动大规模清理。可增加 pending/proposed age、重复候选和长期未使用 confirmed 的提示；清理必须走禁用/合并/删除治理流程，不直接物理删除。

### P2：eval 扩充

在现有 memory retrieval eval 上增加跨项目隔离、room/user 优先级、旧精确命中、hard-negative、删除/禁用即时生效和 feedback rerank 六类用例。

## 2026-07-13 实施状态

- scope-aware retrieval 已实现：默认 global + 当前 user/room/project；显式跨项目只扩展到 room 授权项目。
- 已复用现有 SQLite FTS5，将精确候选与治理候选合并 rerank，解决 60 条截断前丢失旧精确记忆的问题。
- Run Trace、context pack、usage log 已记录 scope、命中来源与词项；正负反馈参与 rerank。
- 设置页已增加记忆健康、作用域分布和候选生命周期提示；只提示，不自动删除。
- 六类回归用例已加入 store test，安装版证据见 `joi-memory-optimization-acceptance-2026-07-13.md`。
