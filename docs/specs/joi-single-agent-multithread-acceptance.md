# Joi 单 Agent 多线程改造验收合同

## 目标

Joi Desktop 的主界面只暴露一个 Joi。用户通过多个独立线程组织对话和任务；现有群聊、项目人格及其数据继续保留在底层，但不再占据主导航。

## Gate 0：入口与信息架构

- 左侧主导航只展示线程，不展示「私人总群」或项目人格房间。
- 顶部新增按钮为「新建线程」，搜索只筛选线程。
- 主标题固定为 Joi，副标题展示当前线程标题或「新线程」。
- 外部入口线程可以保留，并通过渠道标签区分 Desktop、iMessage、Telegram 等来源。

## Gate 1：线程行为

- 点击任意线程可加载对应历史消息。
- 点击「新建线程」后清空当前内容和会话 ID。
- 新线程第一次发送消息时不复用任何群聊或项目人格房间的旧 conversation_id。
- 请求仍可携带 Joi 主房间的 room_id 进入现有 Orchestrator；专家人格只作为隐藏的内部能力，不作为用户可见聊天对象。
- 归档线程不影响其他线程和历史数据。

## Gate 2：安装版可用性

- 前端构建、类型检查和线程规则测试通过。
- 新版本完成 Electron 打包并替换 `/Applications/Joi.app`。
- 安装版可启动，侧栏可切换线程、新建线程和搜索线程，主界面不再出现群聊入口。
- SQLite `quick_check` 和外键检查通过；已验证的新安装包替代旧包后才清理旧归档。

## 不在本次破坏范围

- 不删除既有群聊、项目人格、消息、Run Trace、Memory OS 或外部入口数据。
- 不把 Orchestrator Core 替换成单一模型，也不改变受控 capability、审批和审计边界。
- Grok Build 周额度耗尽属于模型供应侧可用性，不得伪装成 UI 或线程改造成功。

## 2026-07-10 安装版验收结果

- Gate 0：通过。主导航已从房间/人格列表切换为线程列表，群聊与项目人格数据未删除。
- Gate 1：通过。安装版点击「新建线程」后标题为「新线程」，消息区为空；搜索「新月」从 43 条可见线程筛选为 1 条。
- Gate 2：通过。前端构建、线程规则测试、聊天投影、执行动作和 Electron preload/外部附件契约测试通过；`/Applications/Joi.app` 已重新安装并运行。
- SQLite：`PRAGMA quick_check` 返回 `ok`，`PRAGMA foreign_key_check` 无结果；当前保留 99 个 conversations、47 个 rooms、5 个 personas。
- 供应侧状态：Grok Build 仍返回 `403 personal-team-blocked:spending-limit`，因此安装版结构和本地功能可用，但恢复模型回复仍需额度恢复或另配可用模型。
