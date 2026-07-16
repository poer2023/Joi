# Codex、Pi、Alma 与 Joi 能力并集（2026-07-16 本机实测）

本文只记录本机安装版和本地包的真实能力，不把菜单占位或计划项算作已支持。

## 本机基线

- Codex.app：`26.707.72221`（CLI `0.144.2`）
- Pi Coding Agent：`0.80.6`；Pi Computer Use：`0.4.3`
- Alma.app：`0.0.864`
- Joi.app：`0.1.1`

## 能力并集

| 能力域 | Codex | Pi | Alma | Joi 当前状态 |
| --- | --- | --- | --- | --- |
| 文件搜索、读取、编辑、写入 | 原生 | `read/write/edit` | Glob、ripgrep、read、patch、write、Notebook edit | 已有真实后端 |
| 单次 Shell / 测试 / 构建 | 原生 Shell | `bash` | Bash | 已有；完全访问使用主机执行，保留不可逆破坏黑名单 |
| 持久终端、读取输出、终止进程 | Unified exec | 可由扩展实现 | Bash output、terminate Shell | 本次新增 `shell_start/write/output/kill` |
| 网页搜索与正文提取 | 原生搜索/浏览器 | 可扩展 | 网络搜索、网络获取 | 已有搜索、提取和结果折叠 UI |
| 浏览器与桌面操作 | Browser/Computer Use | Pi Computer Use 8 个工具 | Computer Use 设置与工具扩展 | 已接入 Pi 的完整状态式工具组 |
| 图片输入与图片生成 | 支持 | 支持图片输入 | 视觉模型、图片生成设置 | 图片附件已有；Grok Build 图片生成已有 |
| 会话历史检索与恢复上下文 | resume/fork/archive | session tree、resume、fork、compact | 历史、搜索、新建、删除、auto compact | 已有 `session_search/summary`；本次新增持久化 `session_branch/session_compact`，原记录不删除 |
| 记忆 | experimental memories | 主要依赖会话/扩展 | 自动检索、总结、embedding | 本次新增作用域 `memory_recall` 与审核式写入候选 |
| Skills | Agent Skills | Agent Skills 标准 | skill invocation | 已有发现、自动选择；本次新增 `skills_list/skill_view` |
| MCP / 插件 / 扩展工具 | MCP、plugins | extensions/packages | MCP、tool search | 已有 MCP 包装、插件；本次新增统一 `tool_search` |
| 项目与任务 | goals、计划与任务 | 可由扩展实现 | project selector、todo sync | 本次新增 `project_list`、`task_list/view/update` |
| 交互询问与自动化 | request input、automations | 扩展 | plan/todo、外部入口 | 已有 `request_user_input`、暂停草案式自动化 |
| 子 Agent / 任务委派 | 原生多 Agent | 核心明确不内置，可由扩展实现 | task delegation | 本次新增 `delegate_task`：代码 Orchestrator 创建独立子会话/Run，子 Agent 禁止递归委派 |
| 语音输入、TTS | 非核心 | 非核心 | Whisper、TTS | 本次新增本机 `say + FFmpeg` TTS 与本机 Whisper 转写，音频以可播放附件持久化 |
| LSP、调试器 | 可通过 Shell/插件 | 可通过扩展 | 未作为核心工具展示 | 本次新增 clangd/sourcekit-lsp definition/references/diagnostics 与持久 LLDB 会话 |
| 视频生成 | 支持媒体/插件扩展 | 可由扩展实现 | 当前设置未展示视频后端 | 本次新增 xAI `grok-imagine-video` 异步生成、下载、MP4 校验与可播放附件 |

## “够用”的当前停止线

当前 Joi 已闭合三条主要工作链：

1. 开发链：搜索 → 读取 → 修改 → Shell/测试 → 浏览器/桌面验收。
2. 上下文链：记忆 → 历史会话 → 项目 → 技能 → 本机工具发现。
3. 控制链：持久任务 → 用户确认 → 自动化草案 → Run Trace。

本轮已把会话分支/压缩、受控子 Agent、语音、LSP、LLDB 和视频从计划项升级为真实后端；未接入的注册项仍继续返回明确的 `not_configured`，不以占位结果冒充成功。

## 安装版实测结论

2026-07-16 的最终验收不是只测源码：重新打包并完整退出旧进程后，从 `/Applications/Joi.app` 通过当前 `gpt-5.6-luna[medium]` 模型和 Joi MCP 能力桥逐项调用了全部新增能力。

- 会话树：分支保留 3 条快照，源会话后续增长到 20 条，二者没有串写；压缩 checkpoint 已出现在后续真实 prompt assembly 中，原 transcript 未删除。
- 子 Agent：模型在自然语言任务中主动创建独立 `research_agent` conversation/run；`Research Agent` 友好名称也能一次解析，子 run 正确记录 `parent_run_id`，递归委派关闭。
- 语音：本地生成 WAV 并由 Whisper 精确转写，assistant 消息显示原生音频播放控件。
- 开发工具：`clangd` 返回定义与诊断；LLDB 完成 attach、断点、run、表达式求值、step 和 stop。
- 视频：xAI 异步请求完成并下载真实 MP4；`ffprobe` 验证为 480×480 H.264/AAC、1.041667 秒，assistant 消息显示视频时间轴。

完整 ID、哈希、产物和回归结果见 `docs/specs/evidence/joi-advanced-agent-capabilities-2026-07-16/installed-app/installed-app-comparison-report.json`。

## 权限语义

- `read_only`：文件与命令写入受沙箱限制。
- `workspace_write`：只允许授权工作区写入，记忆候选和任务状态变更仍要求确认。
- `danger_full_access`：允许主机命令和持久终端，也允许桌面交互；Run Trace 记录每次工具调用。
- 即使完全访问，也继续拒绝磁盘擦除、破坏性 `diskutil`、`git reset --hard`、递归删除等不可逆操作。这是 Joi 的产品底线，不是能力缺失。
