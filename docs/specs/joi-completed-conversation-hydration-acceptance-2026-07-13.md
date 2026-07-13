# Joi completed conversation hydration acceptance

## Scope

- Project: Joi Desktop
- Target: installed `/Applications/Joi.app` chat history
- User job: open an already completed conversation and read its persisted messages immediately

## Interaction contract

- Selecting a conversation resolves the room that owns that conversation before falling back to the previously active room.
- Persisted conversation messages are the complete historical render source; thread-source restoration is only a fallback when no persisted messages exist.
- Switching conversations cannot briefly retain restored messages from the previous conversation.
- Completed conversations render their final content without a streaming cursor, token replay, or loading placeholder.
- A genuinely active submission keeps its existing live streaming behavior.

## Forbidden changes

- Do not delete messages, run events, or application data.
- Do not remove live streaming from an active run.
- Do not change the visual layout or add new controls.

## Verification

- Regression tests cover conversation-first room resolution and persisted-message precedence.
- Frontend build/typecheck succeeds.
- In the installed app, switch from a long Telegram conversation to a short completed conversation and back; each conversation must immediately show only its own persisted messages.
- Re-enter the long completed conversation and confirm no streaming cursor or token replay appears.

## Done means

- [ ] Historical conversation hydration uses the correct room and message source.
- [ ] No prior-conversation content flashes or merges into the selected conversation.
- [ ] Completed content is rendered as settled content.
- [ ] Live runs still stream normally.
- [ ] Installed-app behavior is visibly verified.
