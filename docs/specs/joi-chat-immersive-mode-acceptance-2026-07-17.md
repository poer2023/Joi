# Joi Chat Immersive Mode Acceptance — 2026-07-17

## Reference and scope

- Primary reference: the user-provided installed Joi appshot and screenshot from `2026-07-17 16:09`.
- Surface: the existing Desktop chat page only.
- Goal: provide a reversible window-level reading mode that leaves the conversation content and one lightweight restore control visible.
- Do not alter message rendering, message data, scroll position, drafts, attachments, run state, Settings, Today, Trace, or native macOS full-screen state.

## Entry and exit contract

- Add a compact `进入沉浸模式` button to the existing chat header.
- `Command+Shift+F` toggles immersive mode while Chat is active.
- `Escape`, the restore button, or `Command+Shift+F` exits immersive mode.
- Navigating away from Chat exits immersive mode and restores window controls.
- Entering or exiting does not discard the composer draft, selected conversation, sidebar preference, or right-inspector preference.

## Immersive visual contract

- Hide the primary sidebar, sidebar controls, chat header, right inspector, resizers, composer, notifications, and macOS traffic-light buttons.
- Do not enter native macOS full screen or move/resize the window.
- The message scroller fills the whole content view with no composer reserve and keeps its current scroll state.
- Render exactly one chrome control above the content: a lightweight `32px` restore button at the top-right with a clear tooltip and accessible label.
- The restore button is `no-drag`, keyboard focusable, and remains clickable above long transcripts.

## Native boundary

- Renderer requests traffic-light visibility through a narrow preload `app` method.
- Main process validates the visibility payload as a boolean and applies it only to the registered BrowserWindow on macOS.
- The window buttons are restored on every normal exit path and renderer cleanup.

## Verification

- Source contract covers the renderer state, shortcut, hidden surfaces, restore button, preload bridge, IPC validation, and native window-button call.
- Frontend and Electron builds pass, followed by the existing focused interaction/preload tests and `git diff --check`.
- Fresh `/Applications/Joi.app` installed and inspected with Computer Use.
- Installed checks: enter through the header button, confirm only messages plus restore control remain, confirm traffic lights and composer are absent, exit through the restore control, re-enter with `Command+Shift+F`, exit with `Escape`.
- Strict codesign and installed `app.asar` source-marker checks pass.

## Done means

- [x] Header button and `Command+Shift+F` enter immersive mode.
- [x] Only conversation content and the lightweight restore button remain visible.
- [x] Composer and native traffic lights are hidden without native full screen.
- [x] Restore button, `Escape`, and repeated shortcut exit reliably.
- [x] Draft and pre-existing sidebar/inspector preferences survive the round trip.
- [x] Installed evidence, bundle proof, and strict codesign pass.

## Installed evidence

- Fresh `/Applications/Joi.app` installed at `2026-07-17 16:17:07 +0800` and launched from that exact path.
- The header `进入沉浸模式` button entered the mode. Installed AX state then contained only `退出沉浸模式` plus `聊天消息`; sidebar, header identity, inspector, composer, and native close/full-screen/minimize buttons were absent.
- The installed screenshot shows the transcript filling the window and a single translucent `32px` restore control at the top-right, without traffic lights or composer.
- Restore-button exit returned all chrome and preserved a temporary unsent draft. The draft was removed after verification.
- With the right inspector open, immersive mode hid it without mutating its preference; the inspector returned on exit and was then restored to its original closed state.
- `Command+Shift+F` entered again and `Escape` exited; native window buttons returned.
- Frontend interaction contract, preload/IPC contract, frontend build, Electron build, `git diff --check`, installed bundle markers, and strict codesign all passed.
- Screenshot: `joi-chat-immersive-mode-installed-2026-07-17.jpeg`.
