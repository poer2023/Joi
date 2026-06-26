# Joi Tolaria Settings Pages Acceptance

## Scope

- Project: Joi desktop frontend browser preview.
- Target URL or app screen: `http://127.0.0.1:5173/`, all settings categories and setting-detail pages.
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: use `import "./styles/tolaria-electron-theme.css"` as the visual source and optimize the full settings surface.

## Goal Gates

- Gate 0: confirm current settings architecture, entry path, and Tolaria adapter boundary.
- Gate 1: apply shared settings layout/style improvements that cover all categories.
- Gate 2: build and browser-verify representative pages from every settings category.

## Information Structure

- Must keep: all 9 setting categories, object column, detail pages, form controls, destructive controls, settings status footer.
- Must restore: a non-footer settings entry, because the previous sidebar footer deletion removed the only visible settings entry.
- Must not add: marketing copy, hero pages, decorative panels, or unrelated new settings.
- Must not change: `apps/joi-desktop/frontend/src/styles/tolaria-electron-theme.css` source file or settings business/API behavior.

## Visual Rules

- Settings mode follows the Tolaria shell: muted sidebar, quiet object list, borderless detail surface, dense but readable controls.
- Left settings category menu uses compact rows with label and description.
- Object column uses compact selectable rows with label and description.
- Detail pages use a toolbar-like category label plus an unframed detail body, not a large floating card.
- Detail headers use compact 18px titles and 12px supporting copy.
- Form rows, metrics, lists, cards, modals, and actions use the same `tk-*` colors, 6-8px radii, restrained borders, and no heavy shadows.
- Text must not overflow buttons, rows, or cards at the current desktop viewport.

## Representative Browser Checks

- Enter settings from the visible top-left settings button.
- Verify one object from every category:
  - 模型 / DeepSeek
  - 聊天入口 / Telegram
  - 自动化 / 新建定时任务
  - 日志与用量 / 日志
  - 数据与记忆 / 待确认记忆
  - 能力与工具 / 内置能力
  - 节点与执行 / main-node
  - 隐私与安全 / 密钥管理
  - 高级 / 诊断包
- Required DOM checks:
  - visible settings entry exists outside the deleted sidebar footer.
  - `.settings-console` has three working columns.
  - `.settings-menu-item` and `.settings-object-item` expose descriptions.
  - `.settings-detail-panel` is borderless/unframed in settings stage.
  - field rows and row cards use compact Tolaria sizing.
  - console has no browser errors after navigation.

## Commands

```bash
pnpm --dir apps/joi-desktop/frontend build
```

## Done Means

- [x] Settings entry is restored without reintroducing the deleted footer.
- [x] All settings categories share the optimized Tolaria layout.
- [x] Representative browser checks pass for all 9 categories.
- [x] Build passes.
- [x] Browser verification shows no console errors or blank layout.
