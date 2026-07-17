# Joi 右侧观察面板清理与交互动效验收合同（2026-07-15）

## Scope

- Project: Joi Desktop，真实仓库 `/Users/hao/project/Joi`，并同步当前工作树中的同名 UI 改动。
- Target: 聊天页右侧观察面板的展开、固定页签和页签内容。
- Likely files: `apps/joi-desktop/frontend/src/App.tsx`、`apps/joi-desktop/frontend/src/styles.css`。
- User job: 打开右侧面板时，只看到与“单 Joi、多线程”当前版本相关的会话状态、运行摘要、产物和记忆；点击应有清晰但克制的反馈。

## Reference and audit evidence

- Primary reference: 用户提供的 2026-07-15 安装版截图，以及同一安装版逐页审计截图：
  - `docs/specs/evidence/joi-right-inspector-audit-2026-07-15/01-overview-before.jpeg`
  - `docs/specs/evidence/joi-right-inspector-audit-2026-07-15/02-runs-before.jpeg`
  - `docs/specs/evidence/joi-right-inspector-audit-2026-07-15/03-threads-before.jpeg`
  - `docs/specs/evidence/joi-right-inspector-audit-2026-07-15/04-files-before.jpeg`
  - `docs/specs/evidence/joi-right-inspector-audit-2026-07-15/05-memory-before.jpeg`
- Current product boundary: `docs/specs/joi-single-agent-multithread-acceptance.md`。主界面只暴露一个 Joi；旧群聊、项目人格和项目关联数据保留在底层，不再作为主导航或日常编辑界面。
- Existing visual language: 当前浅色 Tolaria token、无边框页签、紧凑 12–14 px 字级、柔和 hover surface。

## Information structure

- Must keep:
  - 固定页签：`概览`、`运行`、`产物`、`记忆`。
  - 概览中的当前 Joi 标识、会话状态、当前模型入口、记忆数量与“查看记忆”。
  - 运行中的状态/调用/步骤汇总、面向用户的最近动作和完整执行详情入口。
  - 当前对话上传或生成的产物；本轮召回记忆及准确/不准确/停用反馈。
- Must remove from daily right-panel UI:
  - 旧项目人格编辑表单：名称、项目名、本地路径、描述、自述、权限规则、保存按钮。
  - 与左侧真实线程导航重复、并混入历史导入数据的固定 `线程` 页签。
  - `run.started`、`turn.started`、`model.delta`、内部上下文链接等底层事件流水，以及右侧中的高级 span 筛选/审计表。
  - 记忆卡片的标题/正文重复和 `stable confirmed memory; scope=global` 等内部元数据。
- Must not delete: SQLite 中的旧房间、项目人格、线程、消息、Run Trace、Memory OS 或外部入口数据。
- Must not add: 新设置入口、新模型路由、新业务数据或推断出来的项目路径。

## Visual rules

- Layout density: 保持现有 420 px 左右右栏宽度和 16 px 内容边距；首屏信息不依赖滚动即可理解。
- Spacing: 页签 2 px 间距；内容模块 10–12 px 间距；不增加大标题或大卡片。
- Typography/color: 完全复用现有 `--tk-*` token；正文与辅助信息保持现有层级。
- Borders/shadows: 保持无边框顶栏和轻量 surface；只允许细边框，不加浮夸阴影。

## Interaction rules

- 打开观察面板：180 ms 内从右侧轻移 10 px 并淡入；不改变布局最终尺寸。
- 切换页签：内容在 160 ms 内轻移 4 px 并淡入；当前页签背景/文字平滑过渡。
- 点击反馈：观察按钮、页签和面板内按钮按下时缩放至约 0.96–0.98；观察按钮在展开态保留可识别的 active 状态与正确 `aria-expanded`。
- Keyboard/focus: 不破坏既有 tab/focus 顺序，页签仍使用 `role=tab`、`aria-selected`、`aria-controls`。
- Reduced motion: `prefers-reduced-motion: reduce` 下停用新增动画和位移。
- Responsive: 维持现有窄窗口自动折叠行为；本任务不新增移动端布局。
- Empty states: 运行、产物、记忆无内容时保留一句可理解的空状态，不暴露内部 ID 或枚举。

## Verification

- Browser preview: 真实前端预览，桌面视口 1280×820；检查四个页签、展开/收起、computed animation、控制台错误。
- Installed app: `/Applications/Joi.app`，1280×820；用真实鼠标点击观察按钮和四个页签，确认内容、命中区和状态切换。
- Required screenshots:
  - 浏览器或安装版概览、运行、产物、记忆各一张。
  - 安装版折叠态和展开态至少各一张。
- Required DOM/AX checks:
  - 顶栏只出现四个固定页签，顺序为概览/运行/产物/记忆。
  - 概览不出现旧项目路径、人设描述、自述、权限规则和保存按钮。
  - 运行不出现 delta/started 原始事件与高级 span 筛选表。
  - 记忆不重复显示同一文案，不出现英文内部原因串。
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
pnpm --dir apps/joi-desktop/frontend test:execution-actions
pnpm --dir apps/joi-desktop/frontend test:chat-projection
pnpm --dir apps/joi-desktop/frontend test:single-agent-workspace
JOI_ALLOW_NON_MAIN_INSTALL=1 /bin/bash scripts/package_desktop_macos.sh
codesign --verify --deep --strict /Applications/Joi.app
```

## Done means

- [x] 右侧固定入口收敛为概览、运行、产物、记忆。
- [x] 旧项目人格/项目路径表单不再出现在当前单 Joi UI。
- [x] 运行页只显示用户可读摘要与完整详情入口。
- [x] 记忆页无重复文案与内部元数据，旧多人格/五入口验证记忆不再进入当前面板。
- [x] 展开、切页和按压反馈可见，且 reduced-motion 生效。
- [x] 前端构建、相关测试、安装版点击回归与签名校验通过。
- [x] 验证通过后只清理本次新构建替代的旧 app 归档。

## Verification result

- 前端构建、`test:execution-actions`、`test:chat-projection`、`test:single-agent-workspace` 与工作树 TypeScript 校验通过。
- 本地预览服务返回 200；浏览器自动化在标签页交接层失败，因此最终交互验收全部落在真实安装版 `/Applications/Joi.app`，不是用预览代替安装版。
- 安装版 AX 实测固定页签仅为 `概览 / 运行 / 产物 / 记忆`；概览到“本轮记忆”的联动、四页切换、面板收起与重新展开均通过。
- 运行页的两个成功动作显示为“网页搜索 / 已完成”和“读取网页 / 已完成”；空错误对象不再被误判为失败，并有回归测试覆盖。
- 记忆页仅展示当前仍相关的“伙伴式前台 + 严肃执行后台”方向，匹配度封顶为 100%；旧群主/五项目人格与五入口预览约束保留在底层记录但不再展示。
- 安装包与 release `app.asar` SHA-256 一致；`codesign --verify --deep --strict`、SQLite `quick_check` 均通过。
- 动效关键词 `right-inspector-enter`、`right-inspector-content-enter` 与 `prefers-reduced-motion` 已在安装包中确认；真实点击状态由安装版 AX 回归确认。
- 证据目录：`docs/specs/evidence/joi-right-inspector-audit-2026-07-15/`，其中 `11-before-after-right-panel-comparison.png` 为同一比较输入中的前后对照。
- 已停止本次本地预览服务；只删除了 2026-07-15 本次三次构建生成并被最终版本替代的归档，保留 2026-07-14 既有归档。
