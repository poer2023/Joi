# Joi Tool Result Scroll Area Acceptance

## Scope

- Target: expanded tool-result and raw-call blocks in `/Applications/Joi.app`.
- Reference: `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-native-scrollbar-before.png`.
- Reuse `apps/joi-desktop/frontend/src/components/ScrollArea.tsx`; do not introduce another scrollbar implementation or dependency.

## Follow-up Corrections

- References:
  - `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-scroll-followup-alignment-before.png`
  - `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-scroll-followup-summary-before.png`
- Keep native macOS/Chromium bars hidden, but show the shared horizontal and vertical thumbs at rest whenever that axis overflows; hover/drag may strengthen them.
- JSON starts within 12 px of the result frame's left edge. Chat-rail centering and padding must not leak into nested ScrollArea content.
- A mixed run with successful and failed calls is not a failed run. Keep individual failed rows red, use a neutral stack/cluster state, and show the exact `N 项失败` count (`1 项失败` in the one-failure regression fixture).
- Every disclosure control has exactly one chevron: right when collapsed, down when expanded. Legacy pseudo-element arrows are forbidden.

## Contract

- Remove the native macOS/Chromium vertical and horizontal scrollbar chrome from tool-result blocks.
- Keep wheel, trackpad, keyboard, vertical, and horizontal scrolling functional.
- Use the shared ScrollArea thumb/track behavior and visual tokens.
- Result viewport remains at most 192 px high; raw-call viewport remains at most 240 px high.
- Long unwrapped JSON must not widen the conversation column.
- Short results must not reserve scrollbar space or show an inactive track.
- Existing disclosure, redaction, normalized-result, error, and reduced-motion behavior must remain unchanged.

## Verification

- DOM: tool block contains `scroll-area` and `scroll-area-viewport`; the `pre` itself is not scrollable.
- CSS: native viewport scrollbar is zero-width; result content scrolls inside the shared viewport.
- Installed UI: verified the long failed Linux DO result, the long successful The Verge result, and the raw-call disclosure in `/Applications/Joi.app`.
- Interaction: vertical paging changes the visible JSON; horizontal thumb drag shifts the long unwrapped line and exposes only the shared 3 px tracks.
- Evidence:
  - Default failed result: `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-unified-scroll-area-failed.jpg`
  - Default successful result: `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-unified-scroll-area-success.jpg`
  - Shared controls while dragging: `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-unified-scroll-area-active.jpg`
- Commands:

```bash
pnpm --filter @joi/desktop-frontend test:chat-projection
pnpm --filter @joi/desktop-frontend build
pnpm test:electron-contract
codesign --verify --deep --strict /Applications/Joi.app
```

## Done Means

- [x] Native scrollbars are absent from tool-result blocks.
- [x] Shared custom vertical and horizontal controls work when overflow exists.
- [x] Result heights and conversation width remain stable.
- [x] Tests, build, installed-app cold start, and visual inspection pass.

## Follow-up Done Means

- [x] Overflowing result blocks visibly expose both shared-axis thumbs without restoring native bars.
- [x] Result and raw JSON are left-aligned with no inherited rail margin or padding.
- [x] Mixed success/failure runs retain a neutral overall summary and a local failure count.
- [x] Process, cluster, and item disclosures render one right/down chevron only.
- [x] Tests, package, codesign, cold start, and installed-app visual inspection pass again.

Follow-up installed-app evidence:

- Detail and raw blocks: `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-scroll-followup-detail-after.jpg`
- Neutral mixed-result summary and single collapsed chevron: `docs/specs/evidence/joi-codex-tool-trace-2026-07-15/joi-scroll-followup-summary-after.jpg`
