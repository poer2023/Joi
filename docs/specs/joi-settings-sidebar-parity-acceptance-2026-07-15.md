# Joi Settings Sidebar Parity Acceptance

## Scope

- Project: Joi Desktop settings.
- Target app screen: `/Applications/Joi.app` 首页与设置页。
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`、`apps/joi-desktop/frontend/src/styles.css`。
- User job: 从首页进入设置时，左侧导航保持同一条轨道，不发生宽度突变，灰色背景从窗口顶部贯通到底部。

## Reference

- Primary reference: 当前安装版首页左栏；在 1199×768 窗口中约为 250px。
- Current mismatch: 当前设置页左栏固定为 160px，且标题栏左上区域使用主背景色，灰色只从内容行开始。
- What to copy: 首页当前 `--sidebar-width` 与 `--tk-surface-sidebar`。
- What not to copy: 首页会话内容、底部头像/设置按钮或额外分组。

## Information Structure

- Must keep: 设置一级菜单、顶部返回按钮、折叠按钮、右侧横向二级标签及自动折叠行为。
- Must remove: 设置页独立的 160px 宽度规则。
- Must not add: 新菜单、新图标、新说明文字或额外边框。

## Visual Rules

- 展开时设置左栏直接复用首页的实时 `sidebarWidth`；默认 250px，首页被用户调整后设置页跟随同一宽度。
- 设置页标题栏左侧 `var(--sidebar-width)` 范围使用 `--tk-surface-sidebar`，并与下方设置菜单背景无缝贯通。
- 标题栏其余区域继续使用 `--tk-surface-app`；折叠后灰色宽度归零。
- 不改变菜单项字号、行高、选中态、右侧内容间距和现有圆角。

## Interaction Rules

- 返回、折叠、展开继续支持真实鼠标单击。
- 标题栏空白区域继续可拖动；按钮区域继续 `no-drag`。
- 折叠后右侧内容占满；重新展开时恢复与首页一致的宽度。
- 设置二级横向标签的选择和自动折叠行为保持不变。

## Verification

- Browser target: 本地 renderer 预览，仅用于快速布局检查。
- Installed target: `/Applications/Joi.app`，作为最终事实。
- Viewports:
  - Desktop: 当前 1199×768。
  - Narrow desktop: 900×720。
- Required screenshots:
  - 首页侧栏基准。
  - 设置页展开态，验证宽度一致和灰色贯通。
  - 设置页折叠态，验证灰色轨道归零。
- Required DOM/AX checks:
  - 首页与设置页展开态使用同一个 `--sidebar-width`。
  - `.settings-window-titlebar` 左侧色带止于 `--sidebar-width`。
  - 返回、折叠、展开均可点击；空白标题栏仍可拖动。
- Commands:

```bash
pnpm --dir apps/joi-desktop/frontend build
JOI_ALLOW_NON_MAIN_INSTALL=1 /bin/bash scripts/package_desktop_macos.sh
codesign --verify --deep --strict /Applications/Joi.app
```

## Done Means

- [x] 设置页左栏与首页左栏展开宽度一致。
- [x] 灰色从标题栏顶部贯通到设置菜单底部，无白色断层。
- [x] 折叠态仍为 0px，重新展开恢复共享宽度。
- [x] 返回、折叠、展开和空白标题栏拖动路径均通过安装版回归。
- [x] 构建、安装、签名和用户数据完整性检查通过。

## Evidence

- Source: 设置页不再使用独立 `SETTINGS_SIDEBAR_WIDTH = 160`；首页和设置页展开态都直接使用同一个 `sidebarWidth`，默认 250px。
- Source: `.settings-window-titlebar` 使用以 `var(--sidebar-width)` 为断点的背景渐变；左段为 `--tk-surface-sidebar`，右段为 `--tk-surface-app`，折叠后左段自然归零。
- Installed visual: 1199×768 安装版中，首页和设置页左栏均约 250px；灰色覆盖标题栏左段并连续延伸到窗口底部。
- Installed interactions: 真实坐标点击折叠 `(204, 22)`、展开 `(115, 22)`、返回 `(169, 22)` 均通过；空白标题栏拖动手势完成且未破坏页面状态，按钮 hit map 保持原有 `no-drag` 规则。
- Screenshots: `docs/specs/evidence/joi-settings-sidebar-parity-2026-07-15/02-home-reference-after.jpeg`、`03-settings-expanded-after.jpeg`、`04-settings-collapsed-after.jpeg`。
- Same-input comparison: `docs/specs/evidence/joi-settings-sidebar-parity-2026-07-15/05-settings-before-after.png`。
- Build: canonical frontend build and detached worktree TypeScript check passed；`git diff --check` passed。
- Installed package: `/Applications/Joi.app` 与 release `app.asar` SHA-256 均为 `ba972b2057de1a793349cbfca49d0fac28dea529b005b71f4d296aff27c95286`，strict codesign verification passed。
- Data: `~/Library/Application Support/Joi/joi.db` 保持存在，SQLite `quick_check` 为 `ok`；只删除本次已被验证版本替代的 `app-archive-20260715-175338`，保留三个 2026-07-14 既有归档。
