# Joi Skill + Computer Use 验收合同（2026-07-14）

## 目标与参照

- Skill：对标 Codex 的本地 Skill 合同。参照 `https://learn.chatgpt.com/docs/build-skills`，支持目录式 `SKILL.md`、分层发现、显式/隐式触发、渐进披露、启停、变更刷新、同名共存、符号链接、可选 `agents/openai.yaml` 与附属资源。
- Computer Use：采用 `@injaneity/pi-computer-use@0.4.3` 的状态化工具协议与原生 helper；保留 `find_roots -> observe_ui -> inspect/search/expand -> act_ui -> successor diff`、旧状态拒绝、串行写入、诚实 outcome 与 postcondition 验证。
- UI：沿用 Joi 当前「设置 > 能力与工具」的双栏框架、卡片密度、按钮和折叠详情，不改全局导航与聊天主界面。

## Gate 0：能力与安全边界

- Skill 列表首屏只载入 `name`、`description`、路径与轻量界面元数据；完整正文只在显式查看或当次匹配后载入。
- 发现根覆盖项目 `.agents/skills`（cwd 到仓库根）、用户 `~/.agents/skills`、兼容用户 `~/.codex/skills`、管理员 `/etc/codex/skills` 和 Joi 内置根；同名不同路径不得互相覆盖。
- 运行时注入的 Skill 不能越过 Agent capability 白名单、permission profile、确认流或 Run Trace。
- Computer Use 观察类工具为只读；`act_ui` / `computer_use` 必须进入 `browser_interaction` 单次确认流。模型不能直接操作原生 helper。
- 所有自动测试使用临时 HOME、临时 SQLite、临时工作区和隔离测试窗口；禁止写入 `~/Library/Application Support/Joi`、真实会话、真实记忆或真实用户文档。

## Gate 1：功能与界面

- Skill 页面可搜索、按来源筛选、刷新发现、启停、查看完整说明/资源/界面元数据，并展示显式调用名、来源和路径。
- `$skill-name` 可显式调用；普通语言可按描述保守匹配；`allow_implicit_invocation: false` 时只允许显式调用。
- Skill 变更可被刷新发现，禁用状态按规范化 `SKILL.md` 路径持久化；删除的文件 Skill 不残留为可运行项。
- Computer Use 暴露 Pi 同名工具：`find_roots`、`observe_ui`、`search_ui`、`expand_ui`、`inspect_ui`、`act_ui`、`read_text`、`wait_for`；`computer_use` 作为兼容别名。
- Computer Use 返回 stateId、视图类型、结构化 outline/diff、执行 outcome、验证结果与 helper 诊断；图片内容必须限额，避免把大体积 base64 写入模型上下文和 SQLite。
- 窄窗口（560×720）与标准窗口（1280×820）均无横向溢出，按钮和详情可键盘聚焦。

## Gate 2：三轮验证协议

- 每一轮对 Skill 和 Computer Use 分别执行 3 项历史使用模式回放测试与 3 项压力测试；每轮样例不重复。
- 历史样例只抽取任务形态并匿名化，在隔离 fixture 中执行，不复用真实路径、真实命令副作用或真实数据。
- 第一轮结束后最多进行一次覆盖全部失败面的批量修复；第二轮全部通过即结束。
- 第二轮若有失败，最多进行一次针对性修复，然后执行内容不同的第三轮；第三轮无论结果如何只记录，不修复，也不进行第四轮。
- 最终必须验证：静态类型/构建、核心运行时合同、Skill/Computer Use 轮次报告、打包、安装替换、`/Applications/Joi.app` 启动/关闭后重开，以及安装版 UI 与 preload/tool 边界。

## 视觉不变量

- 保留当前 Joi 的浅色/深色变量、圆角卡片、细边框、左侧对象列表与右侧详情面板。
- 不新增独立顶层导航，不复制 Codex 的品牌、字体或色彩；只参考其 Skill 信息层级和交互语义。
- 状态文案必须区分：已发现、已启用、仅显式调用、helper 未就绪、等待确认、执行失败；不得用“可用”掩盖未连接后端。
