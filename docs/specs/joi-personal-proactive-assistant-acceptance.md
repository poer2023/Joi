# Joi personal proactive assistant acceptance

Date: 2026-07-11

Final evidence: [joi-personal-proactive-assistant-test-report-2026-07-11.md](./joi-personal-proactive-assistant-test-report-2026-07-11.md)

## Objective

Prove the installed `/Applications/Joi.app` can act as a traceable personal assistant: use the newly built Codex CLI ACP provider with the requested `5.6 Terra medium` model selection, complete a real information task, and proactively deliver a concise result through Telegram bot `@claude2mebot`.

## Gate 0 — current-state contract

- Inspect the real repo `/Users/hao/project/Joi`, the installed app, its running process, bundle signature, production SQLite, Keychain-backed secrets, and visible UI.
- Preserve `~/Library/Application Support/Joi`; do not reset or delete conversations, settings, subscriptions, or credentials.
- Read Folo through its installed UI first and derive only enough topic/category evidence to build representative tests. Do not export or publish the full subscription list.
- Resolve the exact provider/model identifiers behind the user-visible labels before changing defaults. A guessed model identifier does not pass.

## Gate 1 — primary end-to-end path

- In the installed app, the selected provider is the newly built Codex CLI ACP integration and the selected model/reasoning choice visibly corresponds to `5.6 Terra medium`.
- Run one real, bounded information task from the user's observed interests. The task must use live source content, produce a useful summary, and record message, model, tool, routing, and delivery events in Run Trace.
- Deliver one clearly labelled acceptance message through `@claude2mebot` to the configured allowed Telegram user/chat. Bot identity must be proven with Telegram `getMe`; delivery must be proven by API result plus visible Telegram receipt when possible.
- Any failure must be attributed to provider, model, tool, store, scheduler, or channel transport rather than being reported as a generic failure.

## Gate 2 — hardening and breadth

- Core desktop: launch, close/reopen, conversation continuity, settings persistence, model selection persistence, capability/trace visibility, and safe error states.
- Proactive engine: manual trigger plus schedule semantics, deduplication, retry/failure recording, notification policy, restart recovery, and no duplicate Telegram delivery.
- Information coverage: representative website/image-rich source and X/Twitter-oriented source where accessible; unsupported authentication or anti-bot barriers must remain explicit.
- Packaging: rebuild through the established macOS packaging script, replace `/Applications/Joi.app`, verify codesign and source-to-`app.asar`, then repeat the visible primary path.

## UI and interaction rules

- Keep the current information architecture and visual language; add only controls or status needed to expose a real runtime capability.
- Provider, model/reasoning choice, Telegram readiness, automation state, and failures must display real persisted/runtime state, not preview-only placeholders.
- Loading, empty, disabled, permission-required, retrying, deduped, and failed states must be understandable without opening developer tools.
- Test desktop at the installed app's normal window and a narrow window; no clipped settings controls, hidden save actions, or unreachable trace details.

## Safety and non-goals

- Do not lower source coverage, schedule frequency, alert thresholds, or business semantics merely to make tests pass.
- Do not create a high-frequency recurring push during acceptance. Use at most a few clearly labelled test deliveries and remove/disable temporary schedules after proof.
- Do not scrape or transmit private subscription/account details beyond what is necessary for the user's requested personal-assistant workflow.
- Do not rewrite the Agent/Orchestrator architecture or introduce a global master model.

## Evidence required

- Before/after installed-app screenshots for provider/model, Telegram, automation, task result, and Run Trace.
- Exact non-secret Telegram bot identity/readiness and delivery identifiers.
- Relevant unit/integration/E2E command results and any failure logs.
- Installed bundle timestamp, codesign verification, and packaged-module proof.
- A coverage table marking each scenario passed, failed/fixed, or blocked with the real failure layer.

## Done means

- [x] Gate 0 evidence identifies all active runtime/config sources without data loss.
- [x] Gate 1 succeeds in the installed app with a real Telegram delivery and Run Trace.
- [x] Gate 2 tests the declared matrix, fixes reproducible in-scope bugs, and re-verifies the installed package.
- [x] Any remaining block is external and documented with concrete evidence and a safe next action.
