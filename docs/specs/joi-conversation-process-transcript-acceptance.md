# Joi Conversation Process Transcript Acceptance

## Goal

Main chat must read like a conversation transcript, closer to Hermes, Pi, Claude, and Codex: user and assistant messages stay primary, and process exposure appears as lightweight transcript lines.

## Acceptance

- The main conversation list renders only message bubbles and inline transcript lines.
- The assistant response row starts with one merged leading group for `Thinking` and user-visible tool calls, then the normal assistant body flows below it.
- Tool/process events that are not part of the leading thinking/tool-call group are collected into one `Process` group at the end of the assistant response.
- The end `Process` group is not interleaved by event timestamp with the answer body.
- Multiple `Thinking` transcript entries for one answer collapse into one visible group instead of rendering as repeated `Thinking` rows.
- Tool/process details collapse into lines such as `Running · ...`, `Ran · ...`, or `Needs confirmation · ...`.
- Internal proof events such as memory recall, handoff linkage, proactive state, mode resolution, and verification bookkeeping stay in Run Trace by default.
- Product task and artifact events may surface as transcript lines only when they represent user-visible work; they must not render as boxed cards in the main chat.
- The full audit trail remains available in Run Trace and is not removed from storage.

## Rejection Criteria

- Main chat shows `memory.recalled`, `handoff.linked`, `artifact.created`, or similar internal events as standalone cards.
- Main chat shows several separate `Thinking` groups for one assistant answer.
- Main chat inserts `Process` before or inside the assistant body instead of collecting it at the end.
- Main chat inserts compact run cards, nested execution cards, or task cards after every response.
- Ordinary chat mode exposes classifier/mode-resolution text such as `普通聊天` or `执行模式已锁定`.
