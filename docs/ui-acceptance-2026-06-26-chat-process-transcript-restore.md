# Chat Process Transcript Restore UI Acceptance

## Scope

- Project: Joi desktop frontend preview
- Target URL: `http://127.0.0.1:5173/`
- Surface: assistant response stack in project DM chat, especially Mnemo / Memory OS

## Reference

- User selected the assistant response process area that currently compresses execution into a small run summary and `Process 1 step`.
- Required change: restore the previously implemented visible thinking and tool-call process transcript.

## Constraints

- Keep process evidence inside the chat transcript, near the related assistant response.
- Do not reintroduce separate internal event cards for memory, handoff, artifact, or task noise.
- Do not change right inspector tab structure in this pass.
- Keep row spacing compact and prevent horizontal overflow.

## Done Means

- [x] Mnemo assistant response shows visible `Thinking` transcript lines.
- [x] Mnemo assistant response shows visible tool-call process lines for memory retrieval and memory proposal handling.
- [x] Process groups are readable without requiring the user to manually expand a collapsed `Process 1 step`.
- [x] Internal memory/artifact events remain off the main chat transcript unless represented as intentional tool/process lines.
- [x] `pnpm --dir apps/joi-desktop/frontend build` passes.
- [x] Browser preview verifies the transcript lines are visible and console has no errors.
