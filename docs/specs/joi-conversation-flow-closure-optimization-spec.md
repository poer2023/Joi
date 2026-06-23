# Joi Conversation Flow Closure Optimization Spec

Version: v0.1
Source: ChatGPT Pro consultation on 2026-06-22, cleaned into an engineering spec for `/Users/hao/project/Joi`.
Target window: 2-4 weeks
Target client: Electron-native desktop app first, with Telegram/iMessage consistency contracts.

Primary references:

- `docs/45_COMPANION_EXECUTION_PRODUCT_SPEC.md`
- `docs/53_ELECTRON_NATIVE_REFACTOR.md`
- `docs/specs/joi-conversation-ux-v2-spec.md`
- `apps/joi-electron/src/main/ipc.ts`
- `packages/runtime/src/tool-calling.ts`
- `packages/store/src/sqlite.ts`
- `apps/joi-desktop/frontend/src/features/chat/runEventNormalizer.ts`
- `apps/joi-desktop/frontend/src/features/chat/conversationProjector.ts`
- `apps/joi-desktop/frontend/src/features/chat/eventVisibility.ts`

## 1. Background

Joi already has most of the nouns: Conversation, Run, Turn, Product Task, Artifact, Memory, Open Loop, Proactive Message, Tool Run, Model Call, and Confirmation Request. The current gap is not object count. The gap is the user-visible lifecycle that connects those objects into a reliable conversation flow:

`user intent -> mode state -> visible execution -> evidence completion -> durable interrupt/resume -> memory/proactive feedback -> cross-entry handoff`

The latest Electron path often looks like:

`run.started -> turn.started -> message.delta -> turn.completed -> run.completed`

In that trace, `message.delta` is commonly a final assistant response written once, not live provider token deltas or live tool activity entering the UI. Recent conversations also show many `tool_run_count=0` cases, while Product Task, Artifact, Open Loop, and Proactive tables contain many candidate/draft/limited states. Joi has the raw control-plane pieces, but the user cannot consistently see execution, inspect evidence, interrupt safely, correct memory, receive natural follow-up, or continue the same task across Desktop, Telegram, and iMessage.

Compared with Hermes-like agent frameworks, the missing surface is execution closure and durable state. Compared with Pi-like companion products, the missing surface is stable persona, memory correction, and low-friction proactive care. This spec prioritizes closing the loop in the existing Electron-native architecture rather than adding a new agent layer.

## 2. Goals

P0 goals:

- Real streaming: provider token/chunk deltas, tool activity, approval pauses, errors, usage, and terminal state are persisted and projected to UI in order.
- Mode contract: explicit user mode cannot be silently overridden; execution/background modes must create or decline the matching product object with a reason.
- Evidence completion: task terminal state is backed by ToolRun, Artifact, Verification, or an explicit pure-reasoning evidence record.
- Durable interrupt/resume: cancel, redirect, approval resume, crash recovery, and side-effect idempotency have stable event and UI semantics.
- Memory governance: remembered facts, user state, corrections, and immediate correction effects are visible and traceable.
- Open Loop/Proactive closure: draft candidates progress to authorized, delivered, responded, closed, snoozed, expired, or suppressed terminal states.
- Cross-entry handoff: Desktop, Telegram, and iMessage share principal, conversation, task, memory, and notification-return semantics.

Non-goals:

- Do not rewrite the runtime.
- Do not require a new multi-agent chat architecture.
- Do not add model providers as part of this work.
- Do not require Hermes-level subagents, remote sandboxes, or plugin marketplace work.
- Do not force every ordinary chat into a Product Task.
- Do not block P0 on voice or companion-style emotional UI polish.

## 3. Target Experiences

### 3.1 Ordinary Chat

Flow:

`input -> ModeResolution(chat) -> memory/user-state recall -> assistant streaming -> optional memory candidate -> user confirm/correct/ignore`

Acceptance:

- UI shows a real pre-first-token state such as `reading context` or `thinking`.
- Assistant text streams by provider chunk or normalized chunk, not only final answer.
- Ordinary chat does not create Product Task unless the user asks for execution.
- If memory is used, UI can reveal the memory/source and provide a correction entry point.
- If the user corrects a memory, the next turn must not use the stale value.

### 3.2 Serious Execution

Flow:

`input -> ModeResolution(execution) -> ProductTask -> plan/acceptance criteria -> ToolActivity -> approval pause where needed -> Artifact/Verification -> terminal TaskLifecycle -> summary/limits/next step -> optional task learning`

Acceptance:

- A Task Card appears before or at the first tool step.
- Each task step has one of: `pending`, `running`, `waiting_approval`, `completed`, `skipped`, `blocked`, `failed`, `cancelled`.
- Tool activity is visible with tool name, purpose, status, result summary, and error reason.
- High-risk tools such as `shell`, `apply_patch`, browser typing/clicking, or desktop automation pause for confirmation unless already covered by policy.
- `completed` requires evidence; otherwise use `completed_with_limitations`, `blocked`, `failed`, or `cancelled`.

### 3.3 Background Task

Flow:

`input -> ModeResolution(background) -> OpenLoop -> ProactiveCandidate -> authorization/schedule/channel -> delivery -> user response -> close/snooze/expire/suppress`

Acceptance:

- Lightweight reminders remain lightweight; do not inflate every reminder into a heavy Product Task.
- UI states why Joi will contact the user, when, by which channel, and how to stop it.
- Repeated ignores trigger automatic downranking or suppression.
- Expired reminders do not remain `open` forever.

### 3.4 Cross-Entry Handoff

Flow:

`Telegram input -> principal resolved -> conversation selected -> task created -> Desktop approval -> iMessage progress query -> same run/task projection -> final delivered to configured channel`

Acceptance:

- Joi states when it is continuing a task from another entry point.
- Different channels project the same Task, not separate similar tasks.
- Cancel/approve/resume in one channel updates the others.
- Rich UI degrades to structured text without losing state.
- Notification deep links return to the original Conversation/Task.

## 4. Domain Architecture

Use these concepts as the contract. Existing tables/classes can keep their names; the contract should be projected through store/runtime/frontend APIs.

```text
Principal
  -> ChannelIdentity
    -> Conversation
      -> ConversationRun
        -> Turn
        -> ModeResolution
        -> TaskLifecycle
        -> ToolActivity
        -> MemoryUpdate
        -> ProactiveDelivery
        -> CrossEntryHandoff
```

### 4.1 ConversationRun

`runs` becomes the canonical observable execution spine. A run owns ordered events for:

- user input and turn start
- mode resolution
- model calls and token deltas
- assistant response chunks
- tool call request/start/output/finish
- approvals
- task lifecycle updates
- artifacts and verification
- memory candidates/corrections
- open loop and proactive transitions
- interruption, redirect, resume, terminal status

### 4.2 ModeResolution

Every turn must record mode resolution:

```ts
type ModeResolution = {
  turn_id: string;
  requested_mode: "auto" | "chat" | "execution" | "background";
  resolved_mode: "chat" | "execution" | "background";
  mode_source: "explicit" | "automatic" | "inherited";
  mode_locked_by_user: boolean;
  reason: string;
  confidence?: number;
};
```

Rules:

- Explicit user mode is authoritative unless Joi refuses for capability/safety reasons, in which case refusal is explicit and persisted.
- `execution` mode must create or link a Product Task before significant work.
- `background` mode must create or link an Open Loop/Proactive plan or explain why it cannot.
- `chat` mode can still use tools, but the UI must not pretend it is a durable task unless a task object exists.

### 4.3 TaskLifecycle

Product Task is the user-facing commitment. It must link:

- `conversation_id`
- `run_id`
- `turn_id`
- `mode_resolution_id`
- `artifact_id[]`
- `tool_run_id[]`
- `verification_id[]` or verification event ids
- terminal reason

### 4.4 ToolActivity

Tool activity is a projection from model calls and tool runs into UI. It must expose:

- tool name and category
- user-facing purpose
- policy/approval state
- started/finished timestamps
- output summary and artifact links
- error taxonomy
- side-effect/idempotency metadata

### 4.5 MemoryUpdate

Memory is split into durable facts, current state, relationship state, corrections, and task learnings. A MemoryUpdate is any candidate, confirmation, correction, deletion, recall, or feedback event connected to a run.

### 4.6 ProactiveDelivery

ProactiveDelivery connects OpenLoop and ProactiveMessage to actual channel delivery and response feedback.

### 4.7 CrossEntryHandoff

CrossEntryHandoff links channel identities to the same principal, conversation, task, notification, and resume target.

## 5. Event Protocol v2

All new runtime/frontend work should write and read a canonical event envelope.

```ts
type RunEventV2 = {
  id: string;
  schema_version: 2;
  conversation_id: string;
  run_id: string;
  turn_id?: string;
  seq: number;
  event_type: RunEventType;
  item_type?: "assistant_message" | "model_call" | "tool_run" | "task" | "artifact" | "memory" | "open_loop" | "proactive" | "handoff" | "approval";
  item_id?: string;
  parent_item_id?: string;
  status?: string;
  phase?: string;
  source: "renderer" | "electron_main" | "runtime" | "store" | "adapter" | "scheduler" | "model_provider" | "tool";
  visibility: EventVisibility;
  created_at: string;
  delta?: unknown;
  snapshot?: unknown;
  error?: ErrorEnvelope;
  usage?: UsageEnvelope;
  terminal?: boolean;
};
```

Visibility levels:

- `chat`: normal user-visible chat content
- `inline_status`: compact run/tool status
- `task`: Task Card projection
- `tool`: Tool Activity projection
- `approval`: confirmation UI
- `artifact`: artifact/verification UI
- `memory`: memory candidate/correction UI
- `proactive`: open loop/proactive UI
- `handoff`: cross-entry status UI
- `trace_only`: trace/debug only
- `hidden`: internal only, still persisted

### 5.1 Canonical Event Types

Run/turn:

- `run.started`
- `run.mode_resolved`
- `turn.started`
- `turn.completed`
- `run.completed`
- `run.failed`
- `run.cancel_requested`
- `run.cancelled`
- `run.redirected`
- `run.resumed`

Assistant/model:

- `model.started`
- `model.delta`
- `model.completed`
- `assistant.delta`
- `assistant.completed`
- `usage.recorded`

Tool:

- `tool.call_requested`
- `tool.approval_required`
- `tool.started`
- `tool.output_delta`
- `tool.completed`
- `tool.failed`
- `tool.cancelled`
- `tool.policy_blocked`

Approval:

- `approval.requested`
- `approval.approved`
- `approval.denied`
- `approval.expired`
- `approval.resumed`

Task/artifact:

- `task.created`
- `task.planned`
- `task.step_started`
- `task.step_completed`
- `task.step_failed`
- `task.blocked`
- `task.completed`
- `task.completed_with_limitations`
- `artifact.created`
- `artifact.updated`
- `verification.started`
- `verification.completed`
- `verification.failed`

Memory:

- `memory.recalled`
- `memory.candidate_created`
- `memory.confirmed`
- `memory.corrected`
- `memory.rejected`
- `memory.deleted`
- `user_state.updated`
- `relationship_state.updated`

Open loop/proactive:

- `open_loop.created`
- `open_loop.scheduled`
- `open_loop.snoozed`
- `open_loop.closed`
- `open_loop.expired`
- `proactive.candidate_created`
- `proactive.authorized`
- `proactive.scheduled`
- `proactive.delivered`
- `proactive.responded`
- `proactive.suppressed`

Cross-entry:

- `handoff.created`
- `handoff.linked`
- `handoff.resumed`
- `handoff.failed`
- `notification.sent`
- `notification.opened`

### 5.2 Legacy Compatibility

Do not remove current `assistant.delta`, `message.delta`, or existing `run_events` readers abruptly.

Compatibility rules:

- If legacy `message.delta` contains a final full assistant message, normalize it to one `assistant.completed` plus a synthetic final `assistant.delta` for old UI paths.
- If a provider stream emits token/chunk deltas, write `assistant.delta` for user-visible text and optionally `model.delta` for provider trace.
- `runEventNormalizer.ts` must accept both v1 payloads and v2 envelopes.
- `conversationProjector.ts` should prefer v2 but preserve current rendering for historical rows.
- Store migrations should be additive and idempotent.

## 6. State Machines

### 6.1 Run

Allowed states:

`queued -> running -> waiting_approval -> cancelling -> cancelled`

`running -> redirected -> running`

`running -> failed`

`running -> completed`

`waiting_approval -> running`

`waiting_approval -> cancelled`

`failed -> resuming -> running`

Terminal states: `completed`, `failed`, `cancelled`.

### 6.2 Turn

Allowed states:

`created -> mode_resolved -> prompting -> streaming -> tool_calling -> waiting_approval -> streaming -> completed`

`created|mode_resolved|prompting|streaming|tool_calling|waiting_approval -> failed|cancelled`

### 6.3 Product Task

Allowed states:

`draft -> planned -> running -> waiting_approval -> running -> verifying -> completed`

`running|verifying -> completed_with_limitations`

`draft|planned|running|waiting_approval -> blocked|failed|cancelled`

Terminal states: `completed`, `completed_with_limitations`, `blocked`, `failed`, `cancelled`.

### 6.4 ToolRun

Allowed states:

`requested -> approval_required -> approved -> running -> streaming_output -> succeeded`

`requested -> running -> succeeded`

`requested|approval_required|approved|running|streaming_output -> failed|cancelled|policy_blocked`

### 6.5 MemoryCandidate

Allowed states:

`candidate -> pending_user -> confirmed`

`candidate|pending_user -> corrected -> confirmed`

`candidate|pending_user -> rejected`

`confirmed -> superseded|deleted`

### 6.6 OpenLoop

Allowed states:

`open -> scheduled -> delivered -> awaiting_response -> closed`

`open|scheduled|delivered|awaiting_response -> snoozed -> scheduled`

`open|scheduled|delivered|awaiting_response -> expired|cancelled`

### 6.7 ProactiveMessage

Allowed states:

`draft -> needs_authorization -> authorized -> scheduled -> delivered -> responded`

`draft|needs_authorization|authorized|scheduled -> dismissed|suppressed|expired`

### 6.8 CrossEntryHandoff

Allowed states:

`created -> linked -> resumed -> completed`

`created|linked|resumed -> failed|expired|cancelled`

## 7. DB / Store Changes

Before writing migrations, verify existing table/column names in `packages/store/src/sqlite.ts`. All changes should be additive unless a migration has explicit backfill tests.

### 7.1 `run_events`

Add or ensure:

- `schema_version integer default 1`
- `conversation_id text`
- `turn_id text`
- `seq integer not null`
- `item_type text`
- `item_id text`
- `parent_item_id text`
- `phase text`
- `visibility text`
- `source text`
- `terminal integer default 0`
- `payload_json text`
- `error_json text`
- `usage_json text`

Indexes:

- `(run_id, seq)`
- `(conversation_id, created_at)`
- `(run_id, event_type)`
- `(item_type, item_id)`

Constraint:

- `(run_id, seq)` should be unique.

### 7.2 `runs`

Add or ensure:

- `conversation_id`
- `entry_channel`
- `requested_mode`
- `resolved_mode`
- `mode_source`
- `terminal_status`
- `terminal_reason`
- `resume_token`
- `parent_run_id`
- `redirected_from_run_id`
- `cancel_requested_at`
- `resumed_at`

### 7.3 `turns` / `turn_items`

Add or ensure:

- `mode_resolution_id`
- `user_intent_summary`
- `assistant_message_id`
- `stream_status`
- `completed_at`

### 7.4 `model_calls`

Add or ensure:

- `provider`
- `model`
- `streaming_enabled`
- `first_delta_at`
- `completed_at`
- `finish_reason`
- `usage_status`: `recorded | provider_missing | estimated | failed`
- `raw_finish_json`

### 7.5 `tool_runs`

Add or ensure:

- `run_id`
- `turn_id`
- `task_id`
- `tool_call_id`
- `tool_name`
- `purpose`
- `approval_request_id`
- `status`
- `side_effect_level`: `none | read | write_local | write_remote | external_action`
- `idempotency_key`
- `started_at`
- `completed_at`
- `output_summary`
- `artifact_id`
- `error_code`
- `error_message`

### 7.6 `product_tasks`

Add or ensure:

- `source_conversation_id`
- `source_run_id`
- `source_turn_id`
- `mode_resolution_id`
- `terminal_status`
- `terminal_reason`
- `evidence_summary`
- `verification_status`
- `last_projected_at`

### 7.7 Memory/User State Tables

Either extend current memory tables or add:

- `memory_candidates`
- `user_states`
- `relationship_states`
- `memory_feedback`

Minimum fields:

- `principal_id`
- `type`
- `content`
- `source_run_id`
- `source_turn_id`
- `source_message_id`
- `confidence`
- `status`
- `ttl_until`
- `supersedes_id`
- `created_at`
- `updated_at`

### 7.8 Cross-Entry Tables

Add if missing:

- `principals`
- `channel_identities`
- `conversation_entry_links`
- `task_entry_links`
- `notification_deliveries`

Minimum linkage:

- principal -> channel identity
- channel thread/message -> conversation
- external task reference -> Product Task
- notification -> deep link target

### 7.9 Store Methods

Add or standardize:

- `appendRunEventV2`
- `listRunEventsV2`
- `recordModeResolution`
- `recordAssistantDelta`
- `completeAssistantMessage`
- `recordToolActivity`
- `recordUsage`
- `recordRunTerminalState`
- `createOrUpdateProductTaskFromRun`
- `createMemoryCandidate`
- `applyMemoryFeedback`
- `createOpenLoop`
- `authorizeProactiveMessage`
- `recordProactiveDelivery`
- `linkChannelIdentity`
- `createCrossEntryHandoff`

## 8. IPC / API Contract

### 8.1 Electron Chat/Run IPC

Expose:

- `chat:startRun`
- `chat:subscribeRunEvents`
- `chat:listRunEvents`
- `chat:getConversationState`
- `chat:cancelRun`
- `chat:redirectRun`
- `chat:resumeRun`
- `chat:getRunTrace`

`startRun` input must include:

```ts
type StartRunRequest = {
  conversation_id: string;
  user_message: string;
  requested_mode: "auto" | "chat" | "execution" | "background";
  entry_channel: "desktop" | "telegram" | "imessage";
  principal_id?: string;
  parent_task_id?: string;
};
```

### 8.2 Approval IPC

Expose:

- `approval:listPending`
- `approval:decide`
- `approval:resumeRun`

The decision payload must include `run_id`, `approval_request_id`, `decision`, `decided_by`, `decided_at`, and optional edited parameters.

### 8.3 Task IPC

Expose:

- `task:get`
- `task:listByConversation`
- `task:listByPrincipal`
- `task:subscribe`
- `task:close`
- `task:reopen`

### 8.4 Memory IPC

Expose:

- `memory:listUsedForRun`
- `memory:listCandidates`
- `memory:decideCandidate`
- `memory:correct`
- `memory:delete`
- `userState:list`
- `relationshipState:list`

### 8.5 OpenLoop / Proactive IPC

Expose:

- `openLoop:list`
- `openLoop:decide`
- `openLoop:snooze`
- `openLoop:close`
- `proactive:listCandidates`
- `proactive:authorize`
- `proactive:decide`
- `proactive:recordFeedback`

### 8.6 Adapter API

Telegram/iMessage adapters must provide:

- `principal_id`
- `channel`
- `external_user_id`
- `external_thread_id`
- `external_message_id`
- optional `conversation_id`
- optional `task_id`
- return channel capabilities: rich UI, markdown, buttons, deep links

## 9. Frontend / UI Changes

### 9.1 `runEventNormalizer.ts`

Responsibilities:

- Convert legacy `message.delta` final responses into v2 assistant events.
- Normalize v2 envelopes into typed frontend events.
- Preserve strict ordering by `(run_id, seq)`.
- Deduplicate repeated final messages.
- Classify visibility using `eventVisibility.ts`.

### 9.2 `conversationProjector.ts`

Project run events into:

- assistant streaming message
- mode chip
- Task Card
- Tool Activity list
- Approval Card
- Artifact/Verification Card
- Memory Used and Memory Candidate UI
- Open Loop/Proactive cards
- Cross-entry Handoff banner
- terminal summary

Rules:

- Never show only a final answer for execution mode when tool/task events exist.
- Never mark a Task Card complete before the terminal task event.
- Pure chat can stay visually light; execution should be denser and traceable.
- Tool failures must remain visible after final assistant response.

### 9.3 `eventVisibility.ts`

Centralize visibility decisions:

- Chat mode hides low-level provider trace but shows memory usage and assistant stream.
- Execution mode shows task/tool/approval/artifact events.
- Background mode shows schedule, authorization, delivery, feedback, and close state.
- Debug/trace mode can reveal all `trace_only` events.

### 9.4 UI Components

Add or upgrade:

- `ModeResolutionChip`
- `TaskLifecycleCard`
- `ToolActivityRow`
- `ApprovalResumeCard`
- `ArtifactVerificationCard`
- `MemoryCorrectionCard`
- `OpenLoopCard`
- `ProactiveMessageCard`
- `CrossEntryResumeBanner`

## 10. Runtime / Tool-Calling Changes

Primary file: `packages/runtime/src/tool-calling.ts`

### 10.1 Streaming

The tool-calling loop should emit callbacks:

```ts
type ToolCallingCallbacks = {
  onModelStarted?: (event: ModelStarted) => void;
  onModelDelta?: (event: ModelDelta) => void;
  onAssistantDelta?: (event: AssistantDelta) => void;
  onAssistantCompleted?: (event: AssistantCompleted) => void;
  onToolCallRequested?: (event: ToolCallRequested) => void;
  onToolStarted?: (event: ToolStarted) => void;
  onToolOutputDelta?: (event: ToolOutputDelta) => void;
  onToolCompleted?: (event: ToolCompleted) => void;
  onToolFailed?: (event: ToolFailed) => void;
  onApprovalRequired?: (event: ApprovalRequired) => void;
  onUsage?: (event: UsageRecorded) => void;
  onError?: (event: RuntimeError) => void;
};
```

Electron main should attach these callbacks and append `RunEventV2` rows as they occur.

### 10.2 Tool Activity

For every tool call:

- Write `tool.call_requested` when the model emits the tool call.
- If approval is required, write `tool.approval_required` and pause.
- Write `tool.started` before invoking the tool implementation.
- Stream output with `tool.output_delta` if available.
- Write `tool.completed` or `tool.failed` with summary.
- Link `tool_run_id` to Product Task step when in execution mode.

### 10.3 `tool_run_count`

`metadata.tool_run_count` is not sufficient evidence.

New rule:

- Derive count from persisted `tool_runs` with terminal state.
- Reconcile against raw model tool calls.
- If model requested a tool but the tool did not execute, record a `tool.failed` or `tool.policy_blocked` event.

### 10.4 Usage

Usage must record one of:

- `recorded`: provider returned usage
- `provider_missing`: provider omitted usage
- `estimated`: local estimator used
- `failed`: usage extraction failed

Do not silently set zero usage when provider omitted it.

### 10.5 Errors

Use stable error taxonomy:

- `provider_error`
- `tool_error`
- `approval_denied`
- `policy_blocked`
- `cancelled_by_user`
- `timeout`
- `network_error`
- `persistence_error`
- `adapter_error`
- `resume_conflict`

## 11. Memory / UserState / RelationshipState

### 11.1 Types

Separate:

- `durable_fact`: stable user fact
- `preference`: user preference
- `current_state`: recent/temporary state with TTL
- `relationship_state`: how Joi should address/support the user
- `correction`: user says prior memory was wrong
- `task_learning`: reusable operational lesson from a completed task

### 11.2 Write Rules

- Do not write durable memory from every message.
- Create candidate only when the content is stable, useful, and attributable.
- Every memory candidate needs source run/turn/message ids.
- Confirmation and correction should be possible from UI.
- Rejected candidates should not reappear unchanged.

### 11.3 Recall Rules

- Prompt assembly must log which memory/user state was used.
- UI can show "used memory" on demand.
- Current state respects TTL.
- Corrections and superseded memories must not be recalled.

### 11.4 Correction Rules

When the user says a memory is wrong:

- Record `memory.corrected`.
- Supersede or delete the old memory.
- Update prompt context for the next turn.
- Show correction effect in UI.
- Add a regression eval case if the old memory was recently used.

## 12. Proactive / Open Loop

### 12.1 Open Loop Creation

Create OpenLoop for:

- explicit reminders
- follow-up requests
- unresolved commitments
- scheduled checks
- user-approved monitoring

Do not create OpenLoop for rhetorical or throwaway remarks.

### 12.2 Authorization

Before proactive delivery, store:

- reason
- trigger condition
- scheduled time or recurrence
- channel
- frequency cap
- expiry
- user authorization state

### 12.3 Delivery Feedback

Delivery must record:

- `delivered`
- `opened`
- `responded`
- `snoozed`
- `dismissed`
- `closed`
- `suppressed`

Repeated ignore or dismiss should create downranking or suppression.

## 13. Durable Interrupt / Redirect / Resume

### 13.1 Cancel

User cancel writes `run.cancel_requested`, propagates AbortSignal, then writes `run.cancelled` only after runtime acknowledges or timeout policy triggers.

UI must distinguish:

- cancel requested
- cancelling tool/model call
- cancelled
- could not cancel safely

### 13.2 Redirect

If user changes the goal mid-run:

- Current run writes `run.redirected`.
- New run links `parent_run_id` and `redirected_from_run_id`.
- Reusable context and safe artifacts are carried over.
- Unsafe partial tool state is not replayed without confirmation.

### 13.3 Confirmation Resume

Approval resume must:

- persist approval decision
- resume from a stable checkpoint
- not duplicate side-effectful tool calls
- emit `approval.resumed` and `run.resumed`

### 13.4 Crash Recovery

On app restart:

- Load non-terminal runs.
- Classify as recoverable, cancelled, failed, or needs user decision.
- Show recovery banner for recoverable runs.
- Do not silently mark old active tasks complete.

### 13.5 Idempotency

Side-effect tools require:

- `idempotency_key`
- side-effect level
- dry-run or preview where possible
- confirmation decision id
- replay policy

## 14. Cross-Entry Consistency

### 14.1 Principal Resolution

Every adapter maps channel identity to canonical principal:

- Desktop local user
- Telegram user/chat
- iMessage sender/thread

Unknown identities create pending links, not duplicate principals.

### 14.2 Conversation Selection

Adapters choose a conversation by:

- explicit deep link/conversation id
- active task link
- recent channel thread mapping
- fallback default inbox conversation

Record the selection reason.

### 14.3 Task Continuation

If a channel message references an active task:

- link to existing Product Task
- append a new Turn/Run to same conversation
- project updated state back to all relevant channels

### 14.4 Notification Return

Notifications need:

- `notification_id`
- `conversation_id`
- `task_id` or `open_loop_id`
- channel delivery id
- deep link target
- opened/resumed events

## 15. Implementation Plan

### P0-1: RunEvent v2 and Legacy Compatibility

Files:

- `packages/store/src/sqlite.ts`
- `apps/joi-electron/src/main/ipc.ts`
- `apps/joi-desktop/frontend/src/features/chat/runEventNormalizer.ts`
- `apps/joi-desktop/frontend/src/features/chat/conversationProjector.ts`
- `apps/joi-desktop/frontend/src/features/chat/eventVisibility.ts`

Acceptance:

- New v2 event envelope can be appended/listed/subscribed.
- Legacy `message.delta` rows render unchanged.
- A fixture with `run.started -> assistant.delta* -> assistant.completed -> run.completed` projects as streaming text.
- A fixture with legacy final `message.delta` projects once, not duplicated.

Metrics:

- 100% new Electron runs have `schema_version=2` events.
- 100% runs have terminal event.

### P0-2: Real Provider Streaming and Tool Activity

Files:

- `packages/runtime/src/tool-calling.ts`
- `apps/joi-electron/src/main/ipc.ts`
- `packages/store/src/sqlite.ts`

Acceptance:

- Provider SSE chunks create ordered `assistant.delta` events.
- Tool calls create requested/started/completed/failed events.
- UI shows at least one live delta before final completion for streaming providers.
- `tool_run_count` is derived from persisted `tool_runs`.

Metrics:

- Streaming latency: first visible assistant delta under 2 seconds after provider first chunk in local dev.
- Tool evidence present for execution runs that call tools.

### P0-3: ModeResolution and Evidence TaskLifecycle

Files:

- `apps/joi-electron/src/main/ipc.ts`
- `packages/store/src/sqlite.ts`
- `apps/joi-desktop/frontend/src/features/chat/conversationProjector.ts`

Acceptance:

- Every turn records ModeResolution.
- Explicit execution mode creates Product Task or records refusal reason.
- Product Task terminal states require evidence summary.
- UI shows Task Card with lifecycle state.

Metrics:

- 100% execution turns have task id or refusal event.
- 0 completed tasks without evidence summary.

### P0-4: Durable Cancel / Redirect / Resume

Files:

- `apps/joi-electron/src/main/ipc.ts`
- `packages/runtime/src/tool-calling.ts`
- `packages/store/src/sqlite.ts`
- frontend projector/UI cards

Acceptance:

- User can cancel a streaming model call and see terminal cancelled state.
- User can redirect a running task into a new linked run.
- Approval pause survives renderer reload.
- App restart classifies non-terminal runs.

Metrics:

- Cancel terminal event present for 100% cancelled runs.
- No duplicate side-effect tool calls in resume tests.

### P1-5: Memory/UserState Correction Closure

Files:

- `packages/store/src/sqlite.ts`
- prompt assembly / memory retrieval modules
- Electron IPC
- frontend memory UI

Acceptance:

- Used memories are logged per run.
- Memory candidates can be confirmed, corrected, rejected.
- Corrected memory is not used on next turn.
- UI shows what Joi thinks it knows and lets user edit/delete.

Metrics:

- Memory correction regression fixture passes.
- No superseded memory appears in prompt assembly.

### P1-6: OpenLoop / Proactive Delivery Closure

Files:

- `packages/store/src/sqlite.ts`
- scheduler/proactive modules
- Electron IPC
- frontend proactive/open loop UI

Acceptance:

- Draft proactive candidates move to authorized/scheduled/delivered/responded/closed or suppressed.
- Ignored proactive messages can downrank future delivery.
- Expired open loops are not left open.

Metrics:

- 0 open loops older than expiry without terminal classification.
- Delivery feedback recorded for delivered proactive messages.

### P1-7: Desktop / Telegram / iMessage Handoff

Files:

- adapter entrypoints
- `apps/joi-electron/src/main/ipc.ts`
- `packages/store/src/sqlite.ts`
- frontend handoff banner

Acceptance:

- Same principal can be resolved across at least Desktop + one external channel.
- Task created externally can be viewed/approved in Desktop.
- Progress query from another channel returns same Task state.

Metrics:

- Cross-entry golden trace passes.
- No duplicate task is created for a linked handoff message.

### P2-8: Evaluation and Metrics Dashboard

Files:

- test fixtures
- store assertions
- optional internal diagnostics UI

Acceptance:

- Golden traces cover chat, execution, approval, cancel, redirect, proactive, and handoff.
- SQLite assertions run in CI/local test script.
- A recent-run report shows terminal state, tool evidence, memory use, proactive closure, and handoff status.

## 16. Tests and Eval

### 16.1 Golden Traces

Create fixtures for:

- ordinary chat with streaming and no task
- chat with memory recall and correction
- execution with tool call and artifact
- approval pause/resume
- cancel during streaming
- redirect during tool plan
- background reminder lifecycle
- proactive message delivery and feedback
- Telegram-to-Desktop or iMessage-to-Desktop handoff

Each fixture asserts normalized event order and final projector output.

### 16.2 SQLite Assertions

Assert:

- `(run_id, seq)` order is unique and gap-tolerant.
- Every run has terminal state or is explicitly recoverable.
- Every execution mode run has task/refusal.
- Every completed task has evidence.
- Every tool call request has terminal tool event.
- Every delivered proactive message has delivery state.
- Superseded memories are not recalled.

### 16.3 Frontend Projector Tests

Assert:

- streaming deltas merge into one assistant message
- legacy final messages do not duplicate
- task/tool/approval/artifact cards render in correct order
- cancellation and redirect banners persist
- memory correction cards update projected state
- handoff banner appears for external entry continuation

### 16.4 Manual E2E

Run at least:

1. Ask a pure chat question; verify streaming and no Product Task.
2. Ask a serious repo task; verify Task Card, tool activity, artifact/evidence, terminal state.
3. Deny an approval; verify blocked/cancelled semantics.
4. Approve and resume after reload.
5. Cancel a streaming response.
6. Redirect a running task.
7. Restart app with a paused run; verify recovery classification.
8. Correct a memory; verify next turn uses correction.
9. Create a reminder; verify delivery/feedback/close.
10. Start a task from Telegram or iMessage and continue in Desktop.

### 16.5 Longitudinal Metrics

Track weekly:

- percent of runs with v2 terminal state
- percent of execution runs with task id
- percent of completed tasks with tool/artifact/verification evidence
- average first visible delta latency
- number of stale open loops
- proactive delivery response/ignore/suppression rates
- memory correction recurrence failures
- cross-entry duplicate-task rate

## 17. Risk and Migration

Risks:

- Event duplication during legacy/v2 bridge.
- UI overload from exposing too much trace detail.
- Tool evidence can become noisy if every low-level operation is visible.
- Resume can duplicate side effects without idempotency.
- Memory candidates can become annoying if generated too aggressively.
- Proactive messages can erode trust if authorization and frequency caps are weak.
- Cross-entry principal linking can create privacy and attribution mistakes.

Mitigations:

- Additive schema migrations first.
- Compatibility normalizer before runtime changes.
- Event visibility policy keeps provider trace hidden by default.
- Side-effect tools require idempotency keys.
- Memory candidate thresholds and user correction feedback.
- Proactive authorization, expiry, and frequency caps.
- Pending principal links require explicit confirmation when ambiguous.

Migration strategy:

- Keep historical `message.delta` rows valid.
- Mark new events with `schema_version=2`.
- Backfill only lightweight derived views if needed; avoid rewriting historical event payloads.
- Ship v2 normalizer behind a feature flag first.
- Enable runtime streaming persistence after frontend projector can render it.
- Enable stricter task evidence rules after migration tests pass.

## 18. Definition of Done

Joi can be considered conversation-flow closed for this phase only when these are true:

- Latest Electron runs show `run.started -> run.mode_resolved -> turn.started -> assistant.delta* / tool.* -> assistant.completed -> turn.completed -> run.completed`.
- Execution mode always creates or links a Product Task, or records a refusal reason.
- Completed tasks have evidence from ToolRun, Artifact, Verification, or explicit pure-reasoning evidence.
- Cancel, redirect, approval resume, and crash recovery each have golden traces and manual E2E proof.
- Memory used in a run is inspectable; a correction changes the next turn.
- OpenLoop/Proactive objects progress out of draft/open into delivered/responded/closed/snoozed/expired/suppressed.
- At least one external entry point can start or continue the same task shown in Desktop.
- Frontend projector tests cover legacy events and v2 events.
- Recent-run report shows terminal state, task evidence, tool evidence, memory usage, proactive state, and handoff state.

Product-level evidence:

```text
User intent
-> ModeResolution
-> ConversationRun
-> TaskLifecycle or ChatResponse or OpenLoop
-> ToolActivity / MemoryUpdate / ProactiveDelivery
-> Artifact / Verification / Feedback
-> durable terminal state
-> historical replay
-> cross-entry continuation
```

If any link in that chain is missing for a workflow, the workflow is not closed. The goal is not to make Joi noisier; the goal is for Joi to be interruptible, inspectable, correctable, resumable, and trustworthy across entries.
