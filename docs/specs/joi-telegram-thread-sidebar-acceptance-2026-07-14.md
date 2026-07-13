# Joi Telegram 线程与紧凑侧栏验收合同（2026-07-14）

## Scope

- Project: `/Users/hao/project/Joi`
- Runtime target: `/Applications/Joi.app`
- User job: Telegram 消息回到稳定、可理解的线程；左侧线程列表只承担导航，不展示正文摘要或渠道类型。
- Reference: 本机 Hermes 0.18.2 的真实 session 路由源码与持久化状态，以及 Joi 当前 SQLite / Telegram inbound 实现。

## Thread Identity

- Telegram 不使用“所有用户共享一个全局线程”。
- 私聊以 `(entrypoint, chat_id)` 作为稳定线程身份；同一 chat 的后续消息、运行重启或模型 session 更换继续进入同一 Joi conversation。
- 如果 Telegram update 存在 topic/thread，则以 `(entrypoint, chat_id, external_thread_id)` 分开；不同 chat 不得合并。
- 当前单一 owner 私聊因此只显示一个真实 Telegram 线程。
- 没有 Telegram inbound update、且带验收专用身份的历史测试 conversation 只做可恢复归档，不把它的消息混进真实私聊历史。
- 不删除消息、Run Trace、Memory OS 或已归档历史。

## Sidebar Information Structure

- 活跃线程行只显示标题和日期；不显示 `last_message`、正文摘要、Desktop / Telegram / iMessage 等渠道类型。
- 标题与日期同处一行，标题超长时省略，日期保持完整且右对齐。
- 单行高度目标不超过 34px；列表密度提升但点击区域仍覆盖整行。
- 悬停或键盘聚焦时仍可使用“归档”动作；归档动作出现时日期可暂时让位。
- 搜索、新建线程、线程计数、选中态和历史加载行为不变。

## Measurable Acceptance

- 源码和渲染测试证明 sidebar row 不再读取 `item.last_message` 或 `item.channel` 作为可见子文案。
- CSS 证明线程行是单行布局，`min-height <= 34px`，标题为单行省略，日期不换行。
- Telegram inbound 的同一 `chat_id` 多次请求得到同一个 conversation ID；不同 `chat_id` 得到不同 ID。
- 当前安装版 SQLite 中只有真实 deterministic Telegram conversation 保持 active；验收专用 Telegram conversation 为 archived。
- frontend build、Electron contract/build、macOS package、codesign、SQLite integrity / foreign key 检查通过。
- Computer Use 验证 `/Applications/Joi.app` 左栏只见标题与日期，没有正文摘要和渠道类型，行高紧凑且可正常切换线程。

## Done Means

- [x] Telegram 线程身份与 Hermes 一致地按 chat / topic 隔离，而不是全局合并。
- [x] 当前测试污染线程已可恢复归档，真实 Telegram 历史没有被重写或删除。
- [x] 侧栏只显示标题和日期，并达到单行紧凑视觉。
- [x] 安装版可见验收及数据完整性检查通过。

## Verification（2026-07-14）

- Hermes 本机源码 `~/.hermes/hermes-agent/gateway/session.py`：DM session key 包含 `chat_id`；存在 thread/topic 时继续包含 `thread_id`。`~/.hermes/sessions/sessions.json` 只把每个稳定 key 路由到当前 session，底层 session 重置不生成新的导航会话。
- Joi 生产 SQLite：真实 Telegram conversation 从 2026-06-23 至 2026-07-13 一直复用同一 deterministic ID；额外的“Telegram 完整访问验收”没有对应 `telegram_inbound_updates`，且使用验收专用 `user_id`，确认是测试数据而非第二个真实 chat。
- 归档前使用 SQLite online backup 保存 `joi-before-telegram-test-thread-archive-20260714-0123.db`；测试 conversation 进入 `archived`，真实 Telegram conversation 保持 `active`，消息和 Run Trace 未迁移、未删除。
- `test:single-agent-workspace`：通过；静态渲染合同证明侧栏不再读取 `item.last_message` / `item.channel`，且 32px 单行几何、标题省略和日期保留成立。
- Telegram ACP routing：通过；覆盖同 chat 稳定、不同 chat 隔离、同 chat 不同 topic 隔离，以及 durable inbox 保存 topic ID。
- frontend build、chat projection、execution actions、task mini list、automation UI state、settings completion：通过。
- Electron build 与 contract：通过；preload contract 覆盖 144 项接口，Telegram outbound / ACP 路由回归通过。
- `/Applications/Joi.app` 与构建产物 `app.asar` SHA-256 一致；`codesign --verify --deep --strict` 通过。
- SQLite `integrity_check=ok`，`foreign_key_check` 无异常。
- 安装版 Computer Use：线程数从 7 变为 6；左栏每一行辅助树只有标题和日期；唯一真实 Telegram 线程可点击并完整加载历史。
- 截图证据：[安装版紧凑线程侧栏](./joi-telegram-thread-compact-sidebar-installed-2026-07-14.jpeg)。
