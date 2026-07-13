# Joi Codex ACP 模型设置验收合同

## Scope

- Project: Joi Desktop
- Target: 设置 -> 模型 -> Codex ACP
- User job: 使用本机 Codex 登录测试 ACP 连接、获取账户模型、选择并设为当前模型。

## Information Structure

- Must keep: 现有 Plugins 安装、停用、卸载生命周期。
- Must add: 模型分类中的 Codex ACP 入口、连接状态、模型选择、测试连接、获取模型、设为当前。
- Must not add: API Key、Base URL、第二套 ACP provider 存储或伪造模型清单。

## Interaction Rules

- 测试连接和获取模型复用已安装插件的真实 `TestPluginProvider` ACP 握手。
- 成功结果更新同一份动态模型清单；失败保留上次成功清单并显示真实错误。
- 设为当前保存精确 provider、模型 ID 与模型 ID 中受支持的 reasoning effort。
- 未安装或已停用 provider 时不可测试或切换。

## Verification

- Focused test: `pnpm --filter @joi/desktop-frontend test:settings-completion`（包含 ACP 模型脚本）
- Frontend build: `pnpm --filter @joi/desktop-frontend build`
- Installed app: `/Applications/Joi.app` 中可见设置 -> 模型 -> Codex ACP，并完成真实连接与模型发现。

## Done Means

- [ ] Codex ACP 在模型分类首层可见。
- [ ] 测试连接显示真实 ACP agent 状态。
- [ ] 获取模型后可选择全部返回模型。
- [ ] 选择模型可设为当前并在刷新后保持。
- [ ] 已安装 app 完成可见 UI 验证。
