# Joi Skill + Computer Use 重新验收合同（2026-07-14）

## 目标

- 在第一组失败记录的基础上先修复一次，再重新执行完整三轮。
- Skill 继续按 Codex/Agent Skills 合同验证；Computer Use 继续使用 `@injaneity/pi-computer-use@0.4.3` 的原生 helper、状态、ref、动作与验证语义。
- 复用第一组三轮各自的题目以获得一一对应的前后对比；三轮之间的历史题目与压力题目仍不重复。
- 每轮结束后记录问题并在下一轮前修复优化；第三轮完成后无条件停止，不运行第四轮。

## Gate 0：失败分层与隔离

- `capture_timeout`、写后 stale epoch、打包运行时依赖必须分别定位，不得用重复运行掩盖。
- 写动作一旦派发不得自动重放。若 successor 截图失败，只允许做只读语义恢复，并明确记录 `action_replayed: false`。
- 每个测试用例在开始前取得独立的新 observation；一个用例失败不得污染后续用例。
- 所有测试使用临时 HOME、临时 Electron `userData`、隔离 BrowserWindow 和专用 capture 目录。
- 禁止修改 `~/Library/Application Support/Joi`、真实会话、真实记忆、真实文件和外部账号。

## Gate 1：前置修复必须满足

- Electron main bundle 不保留 `@injaneity/pi-computer-use/src/*.ts` 或 `@earendil-works/pi-coding-agent` 运行时裸导入。
- `image: never` 的语义路径不依赖 ScreenCaptureKit；显式 `image: always` 仍要有独立冒烟验证。
- 写动作后即使截图失败，也必须返回可继续使用的新 state，或诚实返回不可恢复错误；不得让后续用例级联失败。
- `/Applications/Joi.app` 必须通过 codesign、启动 renderer、关闭窗口后重开、Skills 页面可见和 Computer Use 最小读写闭环。

## Gate 2：三轮题目与节奏

- 每轮对 Skill 执行 3 项历史使用记录相似对话 + 3 项压力测试。
- 每轮对 Computer Use 执行 3 项历史使用记录相似对话 + 3 项压力测试。
- 第一轮沿用原第一轮题目，第二轮沿用原第二轮题目，第三轮沿用原第三轮题目；报告写入 `.e2e/skill-computer-use-rerun/round-N/`。
- 第一、二轮后允许根据记录修复优化，并先跑最小回归再进入下一轮。
- 第三轮只记录最终结果；结束后不再修改源码、不再重跑、不进行第四轮。

## UI 验收

- 保留 Joi 当前设置页、卡片、双栏详情和浅/深色变量，不新增顶层导航。
- Skills 页面仍可搜索、筛选、刷新、启停、查看说明和复制显式调用名。
- 标准窗口 `1280×820` 与窄窗口 `560×720` 不出现横向溢出，键盘焦点和空/错状态可见。
- 安装版可见验证优先于 dev/preview 和构建结果。

## 完成与停止条件

- 每轮必须恰好产生两份 6-case 报告，标明隔离目录、历史/压力数量、失败层和是否触及真实数据。
- 只有安装版可见 UI、Skill 调用链、Pi 最小读写闭环及三轮报告均有证据时，才可声称功能可用。
- 第三轮结束后，无论通过与否都停止；未通过项只记录，不继续修复。

## 轮间记录

- 第 1 轮：Skill 6/6、Computer Use 6/6。删除每轮开始前重复的 root discovery + semantic observation，并补充总耗时与最慢用例字段。
- 第 2 轮：Skill 6/6、Computer Use 6/6。48/48 并发读取命中、8/8 写事务逐步验证、无效 ref 诚实失败。第 3 轮前增加 prepared stateId 唯一性断言与逐题证据。
