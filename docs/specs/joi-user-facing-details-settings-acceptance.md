# Joi 普通用户详情与设置验收

日期：2026-07-11

## 三道验收门

- [x] 门 0：盘点全部设置详情与右侧详情页，明确普通用户不直接看到 JSON、原始日志、内部 ID、payload、schema、trace、内部枚举和连接凭证引用。
- [x] 门 1：可理解的数据转为指标、列表、状态、百分比与字段卡片；仅供排障的数据从普通界面隐藏，保留脱敏诊断包出口。
- [x] 门 2：真实仓库构建、逐页浏览器扫描、release bundle 与已安装 App 验证通过。

## 页面覆盖

浏览器逐一点击并检查 39 个设置详情页：

| 分类 | 页面数 |
| --- | ---: |
| 模型 | 8 |
| 聊天入口 | 4 |
| 自动化 | 3 |
| 运行与用量 | 3 |
| 数据与记忆 | 8 |
| 能力与工具 | 1 |
| 节点与执行 | 6 |
| 隐私与安全 | 5 |
| 支持 | 1 |

另外检查右侧 5 个详情页：概览、运行、线程、文件、记忆。

## 验收结果

- 39/39 设置详情页均无原始 `<pre>` 数据块。
- 设置详情未出现目标内部术语：原始数据、Prompt Assembly、Memory Context Pack、Tool I/O、Capability Console、Run Trace、payload、metadata、schema、JSON、Dedup、Slug、Handoff、终态事件等。
- 运行记录只展示用户可理解的等级、风险、类型、状态、耗时和错误提示；原始 payload、来源表、Run ID 与日志正文详情不再直接显示。
- 能力页合并为 GUI 概览，展示可用能力、扩展、技能、授权范围和最近使用；contract、inventory、workflow 原始结构不再暴露。
- 支持页只保留状态、脱敏诊断导出、清理范围预览和运行完整性摘要。
- 结构化交付物和执行结果通过字段网格显示；只包含内部诊断数据时不在普通视图展示。

## 证据

- `docs/specs/evidence/joi-user-details-settings/settings-capabilities.png`
- `docs/specs/evidence/joi-user-details-settings/settings-support.png`
- `docs/specs/evidence/joi-user-details-settings/right-inspector-runs.png`

## 构建与安装验证

- Frontend TypeScript 检查通过。
- Frontend Vite build 通过；仅保留既有的大 chunk 警告。
- chat projection 与 execution action projection 测试通过。
- `scripts/package_desktop_macos.sh` 构建并安装成功。
- `/Applications/Joi.app` 深度签名校验通过，已安装 `app.asar` 与 release bundle SHA-256 一致。
- 已安装 App 成功启动并读取现有本地对话数据；被替换的旧 App 归档已在验证后删除。
