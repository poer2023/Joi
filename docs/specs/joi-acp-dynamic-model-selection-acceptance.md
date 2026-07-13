# Joi ACP 动态模型选择验收合同

## Scope

- Project: Joi Desktop
- Target: 设置 -> 能力与工具 -> Plugins -> ACP provider
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx` and focused tests
- User job: 测试 ACP provider 后，从它真实返回的模型中选择一个模型，并把该模型设为当前入口。

## Reference

- Primary reference: 当前已安装 `/Applications/Joi.app` 的 Plugins provider 行。
- Secondary reference: `TestPluginProvider` 返回的 `models` / `current_model`。
- Keep the existing compact provider row; add only the model selector required to make the returned inventory actionable.

## Information Structure

- Must keep: provider status, test action, current-provider state, enable/remove lifecycle.
- Must add: tested model selector; the selected model is the value persisted by “设为当前”.
- Must remain reachable: Plugins stays present in the 能力与工具 object navigation.
- Must not add: marketplace, recommendation copy, duplicate provider settings, or API-key fields.

## Interaction Rules

- Before a successful test, use the manifest model list or provider default as the bounded fallback.
- After a successful test, expose every returned model ID, including `gpt-5.6-terra[medium]`.
- “设为当前” persists provider ID, exact model ID, and the bracketed reasoning effort when present.
- A failed test must not replace the last known-good model inventory.
- The active state is exact provider + exact model, not provider-only.

## Verification

- Installed-app baseline: current provider row has test/use actions but no actionable dynamic model selector.
- Desktop viewport: existing Joi settings window.
- Required DOM/source checks: selector is bound to tested models; save payload uses selected model and parsed effort.
- Commands:

```bash
pnpm --filter @joi/desktop-frontend test:settings-completion
pnpm --filter @joi/desktop-frontend build
```

## Done Means

- [ ] A successful provider test makes returned ACP models selectable.
- [ ] Selecting Terra medium persists `gpt-5.6-terra[medium]` with `reasoning_effort=medium`.
- [ ] Active state distinguishes the selected model.
- [ ] Existing plugin install/test/disable/remove actions remain present.
- [ ] Focused tests and frontend type/build checks pass.
