# Joi 当前产品理念与页面截图包

生成时间：2026-06-28

截图来源：`/Users/hao/.codex/worktrees/2596/Joi/apps/joi-desktop/frontend` 的 Vite dev server

截图 URL：`http://127.0.0.1:5173/?capture=20260628`
边界说明：采集时 `127.0.0.1:18083` Electron/SQLite 桥未运行，所以这些截图展示的是当前前端 dev server 可见的预览数据与样式状态，不代表已连接真实 SQLite 数据或已安装 `/Applications/Joi.app` 的运行状态。

## 核心理念简述

Joi 不是单纯聊天壳，也不是传统后台控制台，而是 local-first Personal Agent OS。默认入口是本机 Desktop：自然聊天在前台，受控执行在后台，所有模型、工具、节点、记忆和交付物都要能被追溯。

当前产品体验用“伪装群聊”的方式降低多 Agent 系统的认知成本：用户看到的是一个类似私人 IM 的总群，里面有真人用户和多个项目人格。群聊只是前台隐喻，背后仍是 Orchestrator Core、tool-calling runtime、Capability policy、Memory OS 和 Run Trace。

“项目作为 agent 人格”是当前 UI 的关键表达：每个项目可以拥有自己的名字、头像、项目路径、描述、自述、权限规则和模型策略。项目人格像聊天成员一样出现在侧栏和群成员列表里，但它不是模型本身；Agent 是岗位/职责边界，模型只是可替换的执行引擎。

Joi 的日常路径分两层：伙伴层负责聊天、记忆、主动触达和关系连续性；执行层负责严肃任务、计划、工具调用、线程、资产、确认和审计。主聊天保持自然消息瀑布流，右侧 inspector 承接结构化证据，设置中心退到高级管理入口。

架构红线仍然是：没有全局主模型；模型不得直接执行 shell、SQL、file write 或 service restart；高风险工具需要确认；Worker 只是弹性执行资源；长期记忆必须可追溯、可编辑、可禁用、可删除、可反馈。

## 核心页面与截图清单

| 文件 | 内容 |
|---|---|
| `screenshots/01-chat-private-hub-main.png` | 私人总群主聊天，右侧 inspector 折叠 |
| `screenshots/02-chat-private-hub-overview.png` | 私人总群 + 右侧概览，展示真人与五个项目人格 |
| `screenshots/03-inspector-runs.png` | 右侧运行 tab，模型/工具/成本/副作用审计 |
| `screenshots/04-inspector-threads-list.png` | 右侧线程列表，线程不拥有聊天，只索引消息、Run 和产物 |
| `screenshots/05-inspector-thread-detail.png` | 线程详情与原聊天锚点 |
| `screenshots/06-inspector-assets.png` | 当前对话资产 tab |
| `screenshots/07-inspector-memory.png` | 当前运行/项目相关记忆 tab |
| `screenshots/08-inspector-member-detail-joi.png` | 总群成员详情，项目人格版本、规则、模型策略 |
| `screenshots/09-project-dm-joi-overview.png` | Joi 项目私聊概览，展示项目人格配置表单 |
| `screenshots/10-settings-models.png` | 设置：模型 |
| `screenshots/11-settings-chat-entrances.png` | 设置：聊天入口 |
| `screenshots/12-settings-automations.png` | 设置：自动化 |
| `screenshots/13-settings-observability.png` | 设置：日志与用量 |
| `screenshots/14-settings-data-memory.png` | 设置：数据与记忆 |
| `screenshots/15-settings-capabilities.png` | 设置：能力与工具 |
| `screenshots/16-settings-nodes-execution.png` | 设置：节点与执行 |
| `screenshots/17-settings-privacy-security.png` | 设置：隐私与安全 |
| `screenshots/18-settings-advanced.png` | 设置：高级 |
| `screenshots/19-modal-new-project-persona.png` | 新建项目人格弹窗 |
| `screenshots/20-responsive-narrow-chat.png` | 窄屏响应式聊天状态 |

## 给优化研究的观察点

- 伪装群聊能解释“多个项目人格同时在场”，但需要避免让用户误以为这是多 Agent 群聊自治；更准确的表述可能是“私人工作群/项目人格工作台”。
- 项目人格页已经承载项目名、本地路径、规则和模型，但“人格”和“项目设置”的信息层级还可以再清晰一些。
- 主聊天与右侧 inspector 的边界目前成立：聊天负责自然流，运行/线程/资产/记忆负责证据和结构化状态。
- 设置页已经是高级管理入口，但类别很多，后续可考虑把日常高频项留在上下文里，把低频诊断继续收进设置。
- 当前色彩和组件语言偏安静、桌面工具化，适合工作流产品；优化重点应放在信息架构和状态可解释性，而不是做营销式视觉。

## 未覆盖内容

- 未截图已安装 `/Applications/Joi.app`。
- 未连接 `127.0.0.1:18083`，因此没有验证真实 SQLite 数据、真实 Run Trace 或真实 terminal bridge。
- 未执行会产生写入、副作用或外部发送的按钮。
