# Joi 个人全能主动助理测试报告

日期：2026-07-11

真实仓库：`/Users/hao/project/Joi`
真实安装版：`/Applications/Joi.app`

## 结论

本轮已把 Joi 的核心链路推进到可用状态：安装版已固定使用 **Codex CLI ACP / `gpt-5.6-terra[medium]` / medium**，只读网页搜索与正文提取已经在真实 ACP 会话中跑通，Telegram bot **`@claude2mebot`** 已完成身份核验、入站、出站、重启去重和白名单验证；基于 Folo 当前订阅轮廓的“个人关注日报”已建立为每天 **09:00 Asia/Shanghai** 的正式自动任务，并在成功时推送到 Telegram。

这轮没有把受外部额度限制的失败包装成成功：直接主动 Telegram 推送已经真实送达，但首个“模型生成日报后自动推送”的生产执行尚未发生。Codex 当前额度提示在 **06:28** 恢复，任务首跑安排在 **09:00**；Joi 当前保持运行。源码层的自动任务、通知 outbox、去重、恢复和路由回归均已通过。

## 三道验收门

| 验收门 | 结果 | 关键证据 |
| --- | --- | --- |
| Gate 0：真实状态与兴趣轮廓 | 通过 | 使用真实仓库、安装包、生产 SQLite、Keychain、可见 UI 与 Folo；保留原有用户数据；Folo 脱敏快照为 88 个订阅，其中 50 个公开、38 个私密 |
| Gate 1：ACP 网页任务与 Telegram | 通过 | 安装版 Terra medium 完成真实搜索和正文提取；`@claude2mebot` 直接主动推送可见送达；入站模型路由与有用错误信息均实测 |
| Gate 2：稳固性、打包与回归 | 通过，首个计划执行待观察 | 安全边界、通知状态机、重启去重、UI、SQLite、构建、签名和安装版复验均通过；09:00 首个模型驱动日报尚未到执行时间 |

## 发现并直接修复的问题

| 问题 | 风险 | 修复与复验 |
| --- | --- | --- |
| ACP 不认识模型时可能静默回退 | UI 选中 Terra，但实际运行别的模型 | 改为未知模型硬失败；记录 requested/effective model；模型选择可持久化并在安装版显示完整 `gpt-5.6-terra[medium]` |
| ACP 子进程继承过多环境变量 | Telegram/API 等 secret 可能进入模型侧进程 | 改为最小环境白名单；代理 URL 带凭据时拒绝；stderr 原文不保存、不返回，只记录无内容统计 |
| ACP permission 可受模型提供的标题或 kind 影响 | 权限伪造、越权读写或执行 | 权限只认宿主编译的 capability；精确校验 MCP server/tool/args、命令/cwd、真实路径与符号链接；删除、未知、网络和敏感路径默认拒绝 |
| `codex-acp` 1.1.2 丢失 MCP server env | 工具进程可能拿不到 socket/token，导致实际 bridge 调用失败 | 用 owner-only `0600` descriptor 和受控 `/usr/bin/env` 启动 bridge；token 不进 argv；真实握手与工具调用通过 |
| ACP 延迟工具发现导致模型误报“网页工具不可用” | 有工具却不使用，信息任务失效 | 系统提示明确完整工具名；要求先 `tool_search("joi_web web_search web_extract")`，再调用 `mcp__joi_web__web_search` / `web_extract` |
| `web_extract` 可被重定向或 DNS 解析带到内网 | SSRF、元数据或家庭网络访问风险 | 每次重定向及全部 A/AAAA 都做 public-only 校验；拒绝 loopback/private/link-local/metadata/CGNAT/test/special；固定已验证 IP 并保留 TLS hostname/SNI；限制 5 跳、1 MiB、15 秒 |
| ACP 结构化错误显示 `[object Object]` | Telegram/桌面无法判断真实失败层 | 安全提取 message、nested error、code 和有界 JSON；保留 usage-limit 与重试时间；处理循环/getter/深层对象并脱敏；安装版已显示具体 06:28 恢复提示 |
| Telegram 入站仅靠内存 offset | 崩溃或重启可能重复调用模型、重复回复 | 新增 durable inbox 和 persisted offset；状态覆盖 pending、processing、model_started、reply_pending、reply_sending、completed、failed、reply_ambiguous；模型启动后不盲目重跑 |
| Telegram/自动任务沿用旧会话 persona 的 Grok 模型 | UI 是 ACP/Terra，真实渠道却运行 grok-4.5 | 渠道改用 `settings_preferred`：保留 persona/agent 职责，但 provider/model/reasoning 固定取当前设置；真实 Telegram run 已证明路由为 ACP/Terra/medium |
| 通知发送中崩溃会被当作可安全重试 | Telegram 可能重复送达 | outbox 使用 pending/sending/send_failed/delivered/acceptance_unknown；只重试明确未被 Telegram 接受且被分类为 retryable 的失败，包括 429 与配置未就绪类；5xx、超时、连接中断进入 acceptance_unknown，不盲发 |
| 自动任务 UI 缺少 Telegram 完成推送状态，窄窗控件拥挤 | 用户无法确认目标和 readiness | 增加完成时 Telegram 开关、目标、白名单/readiness/错误提示，并修复约 560 px 窄窗布局 |
| 健康指标存在空时间、失真延迟和缓存比异常 | 状态页误导排障 | 修正未来空时间行、ACP latency 持久化/回退、cache ratio 统一为 0–1；历史 40,794 条空日志未做破坏性重写 |
| 测试 fixture、截图和 Folo“redacted”快照仍含真实 ID、身份信息、本地路径或具体关注源 | 可分享报告会泄露个人信息与兴趣画像 | fixture 全部改为合成 ID；11 张截图与来源明细快照移入本机受限目录；shareable Folo schema v3 只保留聚合计数；报告中的 bot、chat 与签名身份均掩码 |

## 真实安装版端到端证据

### ACP + 网页

- 源码真实会话：ACP session `019f4dc5-b6a0-7c21-99ea-f1ab38528228`，marker `JOI_ACP_WEB_E2E_OK`；`web_search` 与 `web_extract` 都成功。
- 安装版显式工具名 run：`run_mrfefiur3vwk9m`，Terra medium；Brave 搜索返回 3 条，正文提取成功。
- 安装版自然语言 run：`run_mrfemhyg9v9j33`；搜索成功，首个页面提取失败后自动换官方页面重试并成功，最终回答基于已提取正文。
- 日志记录了 `acp_web.web_search.completed` 与 `acp_web.web_extract.completed`，不是只看 UI 文案判断成功。
- Joi 的 ACP capability allowlist 只批准只读 `joi_web.web_search` 和 `joi_web.web_extract`；其余网络、shell 或文件权限请求由 Joi 拒绝。

### Telegram

- Telegram `getMe`：bot id `8580••••10`，username `claude2mebot`，显示名 `Claude2me`；webhook 为空，检查时 pending update 为 0。
- 允许用户/聊天：`7991••••97`；生产设置为 enabled。完整 ID 仅保存在本机生产配置，bot token 仅保存在 macOS Keychain。
- 真实入站 update `850301670` 对应 `run_mrfeot66cqm1lw`，暴露并促成旧 persona 覆盖模型的修复。
- 修复后真实入站 update `850301671` 对应 `run_mrff11ordw69dq`，实际路由已是 `acp_codex_cli / gpt-5.6-terra[medium] / medium`；当时失败层是外部 Codex usage limit，而非 Telegram 或 Joi 路由。
- 安装版错误格式复验 run `run_mrff8wlfga5i2p` 已返回具体额度与 06:28 重试时间，不再出现 `[object Object]`。
- 直接主动出站 trace `cli_b15d5926f8764958881cbf45a2894f71` 成功；本地 Telegram 中可见明确标记的 Joi 主动推送验收消息。
- 两个真实 update 在 durable inbox 中各只有 1 行，offset 已推进到 `850301672`；多次重启与重新安装后没有重复回复。`acceptance_unknown` 被错误标记为可重试的记录数为 0。

### Folo 兴趣覆盖与隐私

只读脱敏快照统计：

- 总订阅 88：公开 50、私密 38。
- 视图：articles 18、social 18、pictures 6、videos 19、notifications 27。
- 主题：X/社交 21、阅读 17、视频/硬件 11、AI 6、图片 6、开发 5、通知 4、游戏 3。
- 日报按八类轮换：X/社交、AI/智能体、开发工具、图片/摄影、视频/数码、资讯/博客、游戏、重要产品更新。
- 任务只允许公开网页；没有把私密订阅标题、URL、Cookie 或 token 写入报告、提示词或推送。

### 已登记的生产自动任务

```text
id: automation_mrff9vawa6fet3
slug: personal-folo-daily-digest
name: 个人关注日报 · Folo → Telegram
schedule: daily 09:00 Asia/Shanghai
next_fire_at: 2026-07-11T01:00:00.000Z
model policy: settings_preferred
effective model: acp_codex_cli / gpt-5.6-terra[medium] / medium
notification: Telegram on completed -> 7991••••97
retry: max 2; usage/policy/invalid payload 等不做无意义重试
privacy: public_sources_only
```

数据库中只有这一条同 slug 的有效任务，当前 enabled；尚无 `last_fire_at`，因此不声称首份日报已经自动送达。

## 回归与安装验证

以下检查均通过：

```text
pnpm test:runtime
pnpm test:store
pnpm test:electron-contract
pnpm test:cli
pnpm test:secrets
pnpm --filter @joi/electron exec tsc --noEmit
frontend production build
frontend execution/chat/single-agent/automation/settings tests
desktop eval 17/17
production schema dry-run
scripts/test-folo-interest-snapshot.mjs
git diff --check
SQLite PRAGMA integrity_check -> ok
SQLite PRAGMA foreign_key_check -> no violations
unzip -t Joi-0.1.1-macos-arm64.zip
codesign --verify --deep --strict /Applications/Joi.app
```

最终安装状态：

- `/Applications/Joi.app` 修改时间：`2026-07-11 05:01:50 +0800`，当前进程正在运行。
- bundle id：`com.hao.joi.desktop`。
- 签名：Apple Development `w***@163.com`，Team `C8M•••923`；deep/strict 校验通过。
- `app.asar` SHA-256：`a2ccf531eaee24cee7fb5f3547c0efe90aa8d99c0863fa3ed5db5d7c6e5488d0`。
- ZIP SHA-256：`3ebbd04296a7dd3cfebf1da5bef1040a036099139fd54173e882dfcc5b73a6fb`。
- 最终包：`/Users/hao/project/Joi/dist/desktop/Joi-0.1.1-macos-arm64.zip`。
- 新包验证完成后，五个本轮被替代的旧 app 归档已删除；源码、当前 app、当前 ZIP 与 `~/Library/Application Support/Joi` 用户数据均保留。

## 证据分级

- 可分享：[Folo 聚合快照生成器](../../scripts/folo-interest-snapshot.mjs)默认输出 schema v3，仅含 counts、预定义 categories 与预定义 topics；[本轮聚合证据](./evidence/personal-assistant-2026-07-11/folo-interest-snapshot.redacted.json)由先前的本机快照只保留聚合字段得到，不含具体订阅标题、URL、source family 或 representative sources。
- 本机受限：11 张原始截图和一份含具体公开来源明细的内部快照保留在 `~/Library/Application Support/Joi/private-test-evidence/2026-07-11/`，目录权限 `0700`、文件权限 `0600`。它们证明 Folo、模型、Telegram、自动任务和真实收件结果，但包含 Telegram 数字 ID、本人头像/姓名、旧聊天、本地路径或具体兴趣来源，不进入仓库或可分享报告。

## 剩余观察项

首个模型驱动的自动日报应在额度恢复后的 09:00 触发。通过标准是：生成一个 automation run，至少一次搜索和一次正文提取成功，任务状态 completed，notification delivery 为 delivered，并且 Telegram 只收到一次日报。若届时 Joi 未运行，本地调度器不会被假定为后台常驻服务；需要重新打开 app 后按 missed-run policy 检查，而不能补造成功记录。
