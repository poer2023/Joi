# Joi Codex-style Tool Trace Acceptance

## Scope

- Project: Joi Desktop
- Target screen: the inline execution activity attached to an assistant turn in `/Applications/Joi.app`
- Files likely to change:
  - `apps/joi-desktop/frontend/src/features/chat/components/MessageList.tsx`
  - `apps/joi-desktop/frontend/src/features/chat/conversationProjector.ts`
  - `apps/joi-desktop/frontend/src/styles.css`
  - `apps/joi-desktop/frontend/scripts/test-chat-projection.mjs`
- User job: understand that work happened, inspect a particular call when needed, and never lose the final answer behind raw tool payloads.

## Reference

- Primary reference: current installed Codex desktop activity disclosure, captured at `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/codex-reference-current.jpg`.
- Before state: installed Joi trace at `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-before.png`.
- Source reference: refreshed `/Applications/Codex.app/Contents/Resources/app.asar` under `/Users/hao/project/recodex/ref`.
- What to copy:
  - completed work is one muted, icon-led summary row;
  - the summary expands with height and opacity motion;
  - expanded groups show compact tool rows, while each result stays collapsed until explicitly requested;
  - structured results are normalized and deduplicated before display;
  - long text and JSON are bounded to about 192 px with internal scrolling;
  - the full raw invocation/result is a secondary disclosure, not the primary result surface.
- What not to copy:
  - Codex product navigation, branding, fonts, colors unrelated to conversation activity, or permission/runtime semantics;
  - terminal-only command chrome or unrelated file-diff cards.

## Information Structure

- Must keep: run state, duration, failure and approval state, useful tool target, useful normalized result, and final assistant answer.
- Must remove from the primary surface: step-count emphasis, always-open repeated-call payloads, the outer MCP `content` wrapper, and double-escaped JSON.
- Must not add: a second trace panel, duplicate calls, unredacted secrets, raw IDs, or a new execution model.

## Visual Rules

- Layout density: one 16 px icon and one 13 px summary line; expanded rows use a 4 px vertical rhythm.
- Spacing: no card around the completed activity group; result blocks sit under their owning tool row.
- Typography: Joi body font for summaries, monospace only for structured/raw data.
- Color: muted neutral summary text; status color is reserved for running, failure, and approval states.
- Borders/shadows: no border or shadow around the activity group; bounded result blocks use one subtle border and neutral fill.
- Icon/button style: compact outline icon, full-row disclosure hit target, chevron rotates on expansion.

## Interaction Rules

- Required interactions:
  - completed historical activity starts collapsed;
  - live activity starts expanded and does not snap closed on completion;
  - clicking the activity summary expands/collapses the group;
  - repeated tool clusters expand to compact call rows, not inline payloads;
  - clicking one call reveals only its normalized useful result;
  - raw input/output remains available through a secondary disclosure.
- Hover/focus/active states: summary text strengthens on hover; keyboard focus remains visible; click has a subtle scale/opacity response.
- Narrow behavior: summaries truncate to one line; result blocks keep their internal scroll and do not widen the conversation column.
- Empty/loading/error states: running shimmers or pulses without layout shift; empty terminal result says `无返回内容`; failures remain readable without opening raw data.
- Reduced motion: expansion and click animations are disabled.

## Verification

- Installed target: `/Applications/Joi.app`
- Viewports:
  - Desktop: current 3200 x 1800 desktop, Joi conversation column at its installed width.
  - Narrow: conversation surface at or below 900 px.
- Required screenshots:
  - completed activity collapsed;
  - repeated `web_extract` group expanded with call rows still compact;
  - one `web_extract` result expanded without double escaping;
  - installed-app proof.
  - Evidence:
    - `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-installed-collapsed.jpg`
    - `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-installed-clusters.jpg`
    - `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-installed-repeated-calls.jpg`
    - `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-installed-bounded-result.jpg`
- Required DOM checks:
  - completed summary has `aria-expanded="false"` by default;
  - live summary has `aria-expanded="true"` by default;
  - repeated call rows do not render with forced inline details;
  - parsed MCP JSON omits the redundant outer `content` wrapper from the useful result.
- Commands:

```bash
pnpm --filter @joi/desktop-frontend test:chat-projection
pnpm --filter @joi/desktop-frontend build
codesign --verify --deep --strict /Applications/Joi.app
```

## Done Means

- [x] Completed Joi activity has the same collapsed information hierarchy and visual density as current Codex.
- [x] Expanding a repeated web-read group never creates a wall of raw payloads.
- [x] A selected call shows normalized JSON/text with a 192 px maximum viewport.
- [x] Full redacted input/output remains reachable through a secondary disclosure.
- [x] Live and historical disclosure state remains stable across appended events.
- [x] Projection tests and the production frontend build pass.
- [x] `/Applications/Joi.app` is rebuilt, signed, cold-reopened, and visually inspected.
- [x] Existing Joi application data is preserved.

Verified on 2026-07-15 against the installed `/Applications/Joi.app`. The final cold-start process was PID `91093`; code-sign verification passed, and the existing conversations remained available from `~/Library/Application Support/Joi`.
