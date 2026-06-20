# 44 伙伴前台 + 执行后台开发 Spec 索引

## 1. 背景

2026-05-24 的项目报告确认 Joi 已经具备 local-first desktop runtime、SQLite AppCore、真实聊天、Run Trace、Prompt Assembly、Memory Context Pack、Capability、Tool Workflow、Worker Gateway、Telegram desktop mode、备份和诊断等底座。

下一阶段目标不是继续扩展设置页，而是把现有底座组织成一个日常可用的产品闭环：

```text
伙伴层：聊天、记忆、主动触达、关系连续性
执行层：任务、计划、工具调用、流程进度、交付物、Run Trace
共同底座：Memory、Context、Capability、Artifact、Provider、Node
```

产品定位：

```text
Joi 是一个长期了解用户的 AI 伙伴。
平时以自然聊天、记忆和主动关心为主。
当用户交代严肃任务时，Joi 切换成可追踪、可交付、可审计的执行系统。
```

一句话原则：

```text
语气像伙伴，执行像系统。
```

## 2. 分卷阅读顺序

| 文档 | 用途 |
|---|---|
| [45 产品与闭环规格](45_COMPANION_EXECUTION_PRODUCT_SPEC.md) | 定义产品定位、模式切换、伙伴循环、执行循环、范围和成功标准 |
| [46 数据模型与 API 规格](46_TASK_MEMORY_ARTIFACT_DATA_API_SPEC.md) | 定义 Product Task、Memory Candidate、Artifact、Open Loop、Proactive Message 的表、DTO、Electron IPC/API |
| [47 Reflection 与主动触达规格](47_REFLECTION_PROACTIVE_SPEC.md) | 定义 Conversation Reflection Job、记忆抽取、任务候选、主动消息候选、评分、审核和发送策略 |
| [48 桌面 UI 规格](48_DESKTOP_UI_COMPANION_EXECUTION_SPEC.md) | 定义三栏主界面、任务卡片、右侧伙伴理解/执行面板、交付物面板、设置页降级 |
| [49 实施计划与验收规格](49_COMPANION_EXECUTION_IMPLEMENTATION_PLAN.md) | 定义分阶段开发顺序、验收用例、测试命令、回归边界和风险控制 |
| [50 文件级开发拆解](50_COMPANION_EXECUTION_FILE_LEVEL_TASKS.md) | 定义具体要改的后端、SQLite、Electron IPC、前端、eval 和文档路径 |

## 3. 本轮不改变的架构红线

必须保留现有 Joi 的核心护栏：

1. Orchestrator Core 是代码控制系统，不允许引入全局主模型。
2. Agent 是岗位，模型是执行引擎。
3. 模型不得直接执行 shell、SQL、file write、service restart 等底层工具。
4. Agent 只能请求 Capability，Tool Compiler 编译为固定 Tool Workflow。
5. Run Trace 继续覆盖消息、路由、记忆召回、模型调用、工具执行、节点派发。
6. 高风险工具默认确认，破坏性操作默认禁止。
7. main-node 保持完整任务能力，Worker 只是弹性执行资源。
8. Worker 不默认接收长期记忆和 secret，只拿最小必要上下文。
9. Memory 必须可追溯、可编辑、可禁用、可删除、可反馈、可迭代。
10. Desktop Mode 是默认产品路径，不依赖 Docker、Postgres、NATS 或 localhost Web Console。

## 4. 命名约束

当前代码中已经存在 `tasks` 表，并且它是 worker queue 表：

```text
tasks
task_attempts
```

这一层表示派发到节点的底层执行任务，不等于用户可理解的产品任务。

因此本轮 spec 中：

```text
产品概念：Task
UI 文案：任务
API DTO：ProductTask / TaskCard
物理表：product_tasks / product_task_steps / product_task_deliverables
```

这样可以避免破坏现有 Worker Gateway、Node Scheduler、Tool Compiler 和 Trace 查询逻辑。

## 5. 最小闭环

MVP 必须证明下面这条链路：

```text
用户自然聊天
→ Joi 识别聊天性质
→ 生成 memory candidate / task candidate / open loop
→ 用户可确认或纠正
→ 下次对话能召回该上下文
→ 用户交代严肃任务
→ Joi 创建 Product Task
→ 展示计划、步骤、工具、交付物
→ Capability/Tool Workflow 执行仍写入 Run Trace
→ 产出 Artifact
→ 任务结束后再次 Reflection
→ 形成新的记忆和主动触达候选
```

如果这条链路没有跑通，就不应优先扩展更多设置页、provider 列表或插件入口。
