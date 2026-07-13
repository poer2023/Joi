# Joi completed conversation hydration acceptance

## Scope

- Target: installed `/Applications/Joi.app` thread history.
- User job: open an already completed conversation and read its persisted messages immediately.

## Interaction contract

- Persisted conversation messages are the complete historical render source.
- Thread-source restoration is only a fallback when a conversation has no persisted messages.
- Switching conversations cannot retain restored messages from the previous conversation.
- Completed conversations render without a streaming cursor, token replay, or loading placeholder.
- A genuinely active submission keeps its existing live streaming behavior.

## Forbidden changes

- Do not delete messages, run events, or application data.
- Do not remove live streaming from an active run.
- Do not change the visual layout or add controls.

## Verification

- Regression tests cover persisted-message precedence and fallback restoration.
- Frontend and Electron production builds succeed.
- In `/Applications/Joi.app`, switch from a long Telegram conversation to a short completed conversation and back; each must immediately show only its own persisted messages.
- Re-enter the long completed conversation and confirm no streaming cursor or token replay appears.

## Done means

- [x] No prior-conversation content flashes or merges into the selected conversation.
- [x] Completed content is rendered as settled content.
- [x] Live runs still use the unchanged streaming path.
- [x] Installed-app behavior is visibly verified.
