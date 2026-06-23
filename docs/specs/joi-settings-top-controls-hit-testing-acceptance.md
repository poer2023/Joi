# Joi Settings Top Controls Hit Testing Acceptance

## Reference

- User report on 2026-06-23: in the installed Joi app Settings model page, the top-left back and settings-menu expand controls are visible but cannot be clicked.
- Visual state: Settings > Models > Grok, with macOS traffic lights at the top-left and a draggable settings surface behind the controls.

## Scope

- Fix the Settings top-left `返回对话` and settings-menu expand/collapse controls in the installed Electron app.
- Preserve the current Settings object list and detail panel, while keeping the controls at the same top-left control-cluster position used by the chat shell.
- Do not redesign the Settings page or change provider/model configuration behavior.
- Fix the collapsed chat shell top-left `新建对话`, `搜索`, and sidebar expand controls so native drag regions do not swallow pointer clicks.

## Acceptance

- Clicking `返回对话` on Settings returns to the chat home/thread view in `/Applications/Joi.app`.
- Clicking `展开设置菜单` or `折叠设置菜单` toggles the Settings menu without a double toggle.
- The Settings controls remain visually in the original top-left control cluster and stay above Settings drag regions.
- In collapsed chat mode, the `新建对话`, `搜索`, and sidebar expand controls remain at their original top-left coordinates and respond to normal mouse clicks.
- The controls remain keyboard-clickable through normal button activation.

## Verification

- Build and install the Electron app to `/Applications/Joi.app`.
- Use Computer Use against `/Applications/Joi.app` to verify Settings top controls on the real installed app.
