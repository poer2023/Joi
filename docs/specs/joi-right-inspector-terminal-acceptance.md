# UI Acceptance Contract

## Scope

- Project: Joi Electron Desktop.
- Target URL or app screen: `/Applications/Joi.app`, chat home with the right `Joi Inspector` open on `Terminal`.
- Files likely to change: `apps/joi-electron/src/main`, `apps/joi-electron/src/preload`, `packages/shared-types`, `apps/joi-desktop/frontend/src/App.tsx`, `apps/joi-desktop/frontend/src/styles.css`.
- User job: Use the right sidebar as a real local command-line terminal, similar to Hermes.

## Reference

- Primary reference: Hermes screenshot with a right-side `ZSH` terminal prompt.
- Secondary reference: current Joi right inspector screenshot.
- What to copy: the right-side terminal placement, direct keyboard input, visible shell prompt, and theme-colored editor surface.
- What not to copy: Hermes session list, model controls, or chat layout.

## Information Structure

- Must keep: a unified right sidebar with `Terminal` and `Memory` tabs.
- Must remove: delivery/results, recent task summaries, and execution-summary cards from the `Terminal` tab.
- Must not add: a landing page, tutorial copy, or a model-controlled shell path.

## Visual Rules

- Layout density: compact desktop inspector density.
- Spacing: Terminal tab fills the available right-panel content area without nested cards.
- Typography: monospace inside terminal; existing UI typography outside it.
- Color: terminal uses the unified Joi workspace/editor background, not blue and not a black card.
- Borders/shadows: no decorative gradients, no nested cards, and no divider under the `ZSH` label.
- Icon/button style: no terminal restart/stop buttons in the top-right chrome.

## Interaction Rules

- Required interactions: auto-start local shell, focus terminal, type commands, receive streamed output, resize with a wider right sidebar.
- Topbar behavior: `Terminal` / `Memory` tabs live in the right sidebar topbar; tabs are only as wide as their labels, have no numeric badges, and topbar blank space is draggable while tab hitboxes are not draggable.
- Hover/focus/active states: tab states remain clear; terminal accepts keyboard focus.
- Mobile behavior: right inspector may remain collapsed under the existing responsive rule.
- Empty/loading/error states: show terminal status and concise error text if Electron terminal bridge is unavailable.

## Verification

- Browser target: installed Electron app, not static preview.
- Viewports:
  - Desktop: installed app window around 1280x820.
  - Mobile: existing right-panel collapse behavior only.
- Required screenshots: installed app with visible shell prompt and command output.
- Required DOM checks: Terminal tab contains `.interactive-terminal-surface`.
- Console/network requirements: no renderer console errors from xterm or preload terminal bridge.
- Commands:

```bash
pnpm --filter @joi/electron build
pnpm test:electron-contract
APP_VERSION=0.1.0-$(date +%Y%m%d.%H%M) pnpm package:electron:mac
/usr/bin/codesign --verify --deep --strict --verbose=2 /Applications/Joi.app
```

## Done Means

- [ ] The UI matches the accepted information structure.
- [ ] No forbidden helper copy, extra modules, or unrelated features were added.
- [ ] Installed app shows a working shell prompt in the right inspector.
- [ ] A command can be typed and output appears in the terminal.
- [ ] The Terminal tab contains only the terminal shell label, terminal surface, and concise error text if needed.
- [ ] The right sidebar can be resized wider than the previous 560px cap.
- [ ] Console errors and request failures were checked.
