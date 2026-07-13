# Joi Codex ACP Plugin 验收合同

## Scope

- Project: Joi Desktop
- Target: 设置 -> 能力与工具 -> Plugins；聊天运行时的 ACP provider 路由
- User job: 通过 GitHub URL 安装 Codex CLI ACP 插件，测试后设为当前模型；可停用、卸载清理并再次从同一 URL 安装。

## Reference

- Alma 0.0.864 的 Codex CLI (ACP) provider 设置页与已安装主进程实现。
- 只复刻 ACP provider 生命周期和必要状态，不复制 Alma 品牌、布局或私有代码。

## Information Structure

- 必须保留：现有本地 `plugin.json` 安装、能力、Skills、MCP 统计与开关。
- 必须新增：GitHub URL 安装、安装来源/版本/commit、ACP provider 状态、测试、设为当前模型、卸载清理说明。
- 禁止新增：插件市场、推荐流、评分、账户体系、自动上传密钥。

## Interaction Rules

- GitHub 安装仅接受 `https://github.com/<owner>/<repo>` 或 `<owner>/<repo>`。
- 安装在 Joi userData 的受管 plugins 目录；下载和依赖安装失败不得覆盖当前可用版本。
- 停用后不能再被模型路由选中；卸载删除受管目录和注册信息，不删除 Codex 登录或用户工作区。
- ACP 子进程退出、超时、协议错误必须写入真实失败状态；不得回退成伪成功回复。
- 当前模型使用 ACP 时无需 API Key/Base URL；认证沿用本机 Codex 登录。

## Verification

- Unit: ACP fake-agent initialize/session/prompt/stream/cancel；GitHub URL 与受管路径校验；store provider 注册生命周期。
- UI: 已安装 Joi.app 中可见 URL 安装、测试、设为当前、停用、卸载。
- E2E: 从 GitHub 安装 -> ACP smoke -> 卸载确认目录消失 -> 再安装 -> 再次 smoke。
- Security: 插件 manifest 不含 secret；日志不输出 Codex token；只有受管目录可递归删除。

## Done Means

- [ ] Alma ACP 链路有本机证据与官方协议交叉验证。
- [ ] Codex ACP 插件可真实对话并在 Run Trace 显示 provider/模型/流式事件。
- [ ] GitHub 安装、停用、卸载、重装闭环通过。
- [ ] 新 Joi.app 已构建、替换、签名校验并用真实 UI 验证。
