# Joi Grok Build Image Generation Acceptance

## Scope

- Project: Joi Desktop installed app
- Target: main chat transcript and existing run process disclosure
- User job: ask Joi to generate an image and see the real Grok Build result in the same conversation
- Files likely to change: runtime capability compiler/executor, Electron IPC, store message/artifact persistence, chat projection/rendering, runtime and frontend tests

## Reference

- Primary reference: current installed Joi transcript shown in the user Appshot
- Secondary reference: Grok Build native `image_gen` / `image_edit` tool contract
- Keep: current message bubbles, Run Trace, process disclosure, attachment viewer
- Do not copy: Grok Build TUI chrome or a separate image workspace

## Information Structure

- Keep Thinking/tool activity/final response boundaries.
- Show generated media as an assistant message attachment with the local persisted asset.
- Record the controlled capability request, execution result, model/provider, and persisted file in Run Trace/artifact metadata.
- Do not add unrelated settings, galleries, or image-edit UI in this pass.

## Visual Rules

- Reuse the existing attachment card/image renderer and transcript spacing.
- Preserve current typography, neutral borders, bubble width, and responsive behavior.
- Fit generated images within the message column without clipping or horizontal overflow.

## Interaction Rules

- `image_generate` is available only through the controlled capability runtime.
- Execution uses the authenticated local Grok Build runtime and its native `image_gen` tool.
- The generated image is copied into Joi-owned local application data before display; temporary provider paths are never the durable source.
- While running, existing process disclosure shows progress; success shows the image; failure shows the actual failure layer.
- A plain question about image capability must be answered normally and must not generate an image without an explicit generation request.

## Verification

- Runtime unit test covers native event parsing, bounded file validation, persistence, and redacted failures.
- Capability compiler exposes `image_generate` as implemented and only when allowed for the selected agent.
- Frontend projection/render test covers a generated image attachment.
- Build and install `/Applications/Joi.app`.
- In the installed app, send an explicit image request and verify the image appears in the transcript.
- Verify SQLite Run Trace, artifact/message metadata, app signature, and preserved existing data.

## Done Means

- [x] Joi invokes Grok Build native `image_gen` through the controlled runtime.
- [x] The generated image is persisted under Joi application data and recorded in Run Trace.
- [x] The installed chat transcript visibly renders the generated image.
- [x] Existing non-image chat and response-contract tests still pass.
- [x] Installed app, SQLite integrity, source-to-bundle proof, and signature verification pass.

## Installed Evidence

- Run: `run_mrepqeg02n0aci`
- Artifact: `art_mrepqtxqt6py3g`
- Native Grok session: `019f4b48-c0c5-7a33-a386-0156d80f2425`
- Persisted image: `~/Library/Application Support/Joi/generated-images/joi-grok-1783674499745-cf961ec2.jpg`
- Screenshot: `docs/specs/joi-grok-build-image-generation-installed.jpeg`
