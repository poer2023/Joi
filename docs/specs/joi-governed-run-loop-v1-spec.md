# Joi Governed Run Loop v1 Spec

Version: v0.1
Source: ChatGPT Pro consultation on 2026-06-24, cleaned into an engineering spec for `/Users/hao/project/Joi`.
Consultation thread: `https://chatgpt.com/c/6a3be19c-df0c-83ea-b915-254aebd3ae5a`
Original requested thread: `https://chatgpt.com/c/6a3bb6cf-32a8-83ea-825c-474cce8d1721`
Target window: next sprint
Target client: Electron-native Desktop first

Primary local references:

- `docs/02_SYSTEM_ARCHITECTURE.md`
- `docs/05_MEMORY_OS_SPEC.md`
- `docs/06_CAPABILITY_TOOL_PROTOCOL.md`
- `docs/10_SECURITY_PERMISSION_PRIVACY.md`
- `docs/11_FRONTEND_UI_SPEC.md`
- `docs/14_RUN_TRACE_OBSERVABILITY.md`
- `docs/32_DESKTOP_FIRST_ARCHITECTURE.md`
- `docs/55_PROJECT_OVERVIEW.md`
- `apps/joi-electron/src/main/automation.ts`
- `apps/joi-electron/src/main/automation-webhook.ts`
- `apps/joi-electron/src/main/index.ts`
- `apps/joi-desktop/frontend/src/App.tsx`

## 1. Conclusion

The next highest-priority Joi improvement is **Governed Run Loop v1**:

```text
User Intent
  -> Run Contract
  -> Plan
  -> Permission / Approval
  -> Controlled Tool Execution
  -> Artifact / Result
  -> Memory Proposal
  -> Skill Suggestion
  -> Automation Continuation
  -> Token / Cost / Logs Summary
```

This is not another logs page and not a visual-only Run Trace redesign. The goal is to make every meaningful task execution a user-visible, confirmable, observable, recoverable, and learnable product object.

Joi already has many underlying pieces: chat modes, automation triggers, local runtime, capability policy, logs, token accounting, memory candidates, worker diagnostics, and Run Trace. The next step is to connect them into one trusted execution loop in the main Desktop experience.

## 2. Why This Direction

Governed Run Loop is the shortest path from "desktop chat with many diagnostics" to "local-first Personal Agent Harness."

| Direction | Why it is not the only next priority | How it fits Governed Run Loop |
| --- | --- | --- |
| Memory Proposal | Important, but a standalone memory inbox does not explain why a memory exists or how it affects future work. | Memory becomes an inline proposal at the end of a run, with source, reason, and future effect. |
| Skill Suggestion | Premature without stable run evidence. Otherwise skills become model-generated playbooks without proof. | Similar runs and repeated corrections produce draft skills after the run loop records enough structure. |
| Automations | Triggers already exist. The missing piece is a trusted execution story for background work. | Schedule and webhook runs enter the same run contract, approval, timeline, and summary model. |
| Multi-entry capture | Telegram, iMessage, and webhook are entry points, not the core product surface. | External entries capture intent; execution still lands in a governed run. |
| Run Timeline | Needed, but raw trace visualization alone would keep Joi feeling like a diagnostics console. | Timeline is rewritten as a user-readable run story with raw evidence in the inspector. |
| Token / Logs | Useful for trust and cost control, but not the primary workflow. | Each run shows a compact usage summary and links to detailed logs. |
| More models | Not the bottleneck. Joi's architecture says models are execution engines, not the control system. | Model calls remain runtime-controlled steps inside the governed loop. |

The criterion is simple: current Joi does not lack nouns; it lacks a product loop that makes those nouns trustworthy to the user.

## 3. Problem Statement

Joi currently has:

- Desktop chat entry with `Auto`, `Chat`, `Task`, and `Bg` modes.
- Automation Runner and Automation Webhook Server.
- Memory candidate inbox and confirmed memory search.
- Capability console and controlled tool-calling runtime.
- Run Trace, app logs, worker audit logs, and token/model usage.
- Main-node execution with optional workers.

The user-facing lifecycle remains fragmented:

1. Main chat is not yet a task cockpit.
   Users cannot consistently see what Joi understood, what it plans to do, what it is doing now, what needs approval, what succeeded, what failed, and what is worth remembering.

2. Run Trace is engineering evidence, not a product story.
   Events such as `run.completed`, worker heartbeat, tool logs, and runtime internals are useful for developers but too raw for daily use.

3. Memory, Skill, and Automation do not share a user-visible context.
   A memory proposal should derive from a specific run. A skill suggestion should derive from repeated run patterns. An automation execution should not be a detached background record.

4. Harness boundaries are not explicit enough in the product.
   Models must not directly execute tools. The UI should make it clear that the model proposes, while the runtime validates, confirms, executes, and records.

## 4. Goals

- Create a `Run Contract` for every `Task`, `Bg`, and automation run.
- Show a compact `Run Card` in the main chat for meaningful execution.
- Move raw evidence into the right inspector, scoped to the selected run.
- Record every capability request in structured timeline items.
- Require approval cards for high-risk capability execution.
- Attach Memory, Skill, and Automation proposals to the originating run.
- Summarize token, latency, cost estimate, and logs at the run level.
- Preserve architecture boundaries:
  - no global or master model;
  - Orchestrator Core owns control;
  - models only request capabilities through runtime;
  - high-risk tools require confirmation;
  - main-node remains fully capable without workers.

## 5. Non-goals

- Do not add a model marketplace.
- Do not add broad new capabilities as part of this sprint.
- Do not redesign all settings pages.
- Do not build a full Skill marketplace or Skill runtime.
- Do not create a full multi-entry inbox.
- Do not implement autonomous proactive agent behavior.
- Do not move raw Run Trace directly into the main chat.

## 6. Target User Scenarios

### 6.1 Package and Commit a New Feature

User input:

```text
打包并提交新功能
```

Expected behavior:

- Joi classifies it as a task.
- Joi creates a Run Contract:
  - goal: package current changes and commit them;
  - scope: current repository;
  - risk: build commands, file writes, git commit;
  - success criteria: build passes, commit succeeds, commit hash is shown.
- Joi shows a plan:
  - inspect `git status`;
  - run relevant build/tests;
  - prepare commit message;
  - request approval before commit;
  - commit after approval.
- The inspector shows terminal output, tool results, logs, and evidence.
- The run ends with result summary, failure/retry record, usage summary, and optional memory/skill proposals.

### 6.2 Diagnose a Conversation Failure

User input:

```text
排查会话错误原因
```

Expected behavior:

- Joi classifies it as a diagnostic task.
- The contract explicitly states read-only scope unless the user approves changes.
- Joi reads logs, run trace, app logs, and relevant local state.
- If cleanup or config changes are required, Joi requests separate approval.
- Final output includes ranked causes, evidence references, suggested repairs, and optional next actions.

### 6.3 Automation Triggered Run

Example trigger:

```text
每天汇总昨天的截图记忆管线结果
```

Expected behavior:

- The schedule or webhook trigger creates an automation-origin run.
- The run records automation id, trigger payload summary, dedup key, and runtime path.
- Read-only work can complete automatically.
- High-risk actions enter an attention or approval queue.
- Automation history links to the governed run and its final result.

## 7. Core Flows

### 7.1 Manual Task Run

```text
User input
  -> Orchestrator classifies mode
  -> Run Contract is created
  -> Main chat shows Run Card
  -> Orchestrator selects Agent role
  -> Model engine proposes plan or tool request
  -> Runtime validates capability, risk, roots, and policy
  -> Approval Card appears if needed
  -> User approves or denies
  -> Runtime executes tool
  -> Timeline, logs, tool_runs, and model_calls are written
  -> Artifact or result is created
  -> Memory / Skill / Automation proposals are generated
  -> Run completes
```

### 7.2 Approval Required

```text
tool_request received
  -> policy_engine.evaluate()
  -> risk = high
  -> approval_request created
  -> timeline item: approval.requested
  -> UI shows Approval Card
  -> user approves or denies
  -> runtime continues, replans, or stops
```

Approval Card fields:

- requested action;
- reason;
- affected paths, accounts, endpoints, or services;
- risk and privacy level;
- dry-run or diff summary when available;
- expected effect;
- rollback or recovery note;
- approve, deny, and view details actions.

### 7.3 Memory Proposal After Run

```text
run.completed
  -> memory candidate extractor
  -> candidate gate
  -> proposal card
  -> user confirms, edits, dismisses, or marks false positive
  -> confirmed memory enters Memory OS
```

Memory Proposal Card fields:

- memory text;
- type: `user_preference`, `project_fact`, `workflow_rule`, or `task_context`;
- source: run id, message id, tool result, or artifact;
- reason to remember;
- future effect;
- confidence;
- actions: remember, edit and remember, do not remember, mark false positive.

Special rule:

```text
不要记住这句话
```

must not create a positive memory candidate. It should either be filtered or recorded as a negative memory signal for extractor calibration.

### 7.4 Skill Suggestion After Repeated Runs

Skill suggestion should only appear when there is evidence:

```text
similar_runs >= 3
OR same correction >= 2
OR same approval pattern >= 3
```

MVP output is a draft card only:

- suggested skill name;
- trigger condition;
- stable steps;
- required capabilities;
- approval points;
- supporting runs;
- default status: `draft` and disabled.

Full skill runtime is outside MVP.

### 7.5 Automation Run

```text
schedule/webhook trigger
  -> create run with origin_surface = automation_schedule|automation_webhook
  -> attach automation_id and trigger metadata
  -> execute through the same runtime path
  -> approval required events enter attention queue
  -> run summary writes back to automation history
```

Automation must not bypass the tool-calling runtime or approval policy.

## 8. UI and Information Architecture

### 8.1 Main Chat

Main chat should show the user story, not raw diagnostics:

```text
User Message
Run Card
  - title
  - status
  - goal
  - plan summary
  - current step
  - approval needed
  - result
  - artifacts
  - memory / skill / automation proposals
  - time and cost summary
Assistant Result
```

Run Card states:

| State | Main chat display |
| --- | --- |
| `understanding` | Understanding task |
| `planned` | Goal, plan, risk |
| `waiting_approval` | Highlighted approval request |
| `running` | Current step and completed steps |
| `retrying` | Failure reason and retry count |
| `completed` | Result, artifacts, usage summary |
| `failed` | Failed step, completed work, recovery actions |
| `cancelled` | User cancellation or policy denial |
| `background` | Compact background status |

Do not show these in main chat by default:

- raw JSON;
- worker heartbeat;
- raw `run.completed` events;
- full terminal output;
- full `model_calls`;
- settings-level configuration details.

### 8.2 Run Card Compact Form

Example:

```text
打包并提交新功能
Status: Waiting for approval
Goal: Build current changes and commit after checks pass
Next: git commit
Risk: modifies Git history

[View plan] [Approve commit] [Cancel]
```

Expanded view adds:

- goal;
- scope;
- constraints;
- step list;
- approval history;
- artifacts;
- memory/skill proposals;
- token, latency, and cost summary.

### 8.3 Right Inspector

The right inspector should become the evidence panel for the selected run.

Suggested tabs:

- `Timeline`: user-readable plan, approval, tool, result, retry, failure, and completion events.
- `Tools`: capability request, policy evaluation, result summary, risk/privacy level.
- `Memory`: recalled memories, proposed memories, disabled/conflicting memories.
- `Artifacts`: files, reports, diffs, diagnostic bundles, links.
- `Logs`: app logs, runtime events, worker audit, model calls.
- `Terminal`: visible only for shell/terminal-related runs; sensitive output collapsed by default.

### 8.4 Settings and Diagnostics

Settings remain the place for global management:

- provider/model configuration;
- automation creation and management;
- full memory governance;
- capability console;
- logs and usage;
- log cleanup;
- nodes and worker diagnostics.

Daily task execution should not require the user to visit settings to understand what happened.

| Area | Responsibility |
| --- | --- |
| Main chat | Start tasks, show status, request approval, show result |
| Inspector | Evidence for selected run |
| Settings | Configuration, governance, history, diagnostics, cleanup |
| Automation page | Trigger management and history |
| Memory page | Full memory governance |

## 9. Data Model

The implementation should prefer additive schema changes and dual-write during rollout.

### 9.1 `runs`

```sql
runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  parent_run_id TEXT NULL,
  origin_surface TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  user_goal TEXT NOT NULL,
  normalized_intent TEXT,
  agent_role TEXT,
  execution_location TEXT,
  risk_level TEXT,
  privacy_level TEXT,
  created_at DATETIME,
  started_at DATETIME,
  completed_at DATETIME,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cached_tokens INTEGER DEFAULT 0,
  total_reasoning_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  artifact_count INTEGER DEFAULT 0,
  approval_count INTEGER DEFAULT 0,
  failure_code TEXT NULL,
  failure_message TEXT NULL
);
```

`origin_surface` values:

- `desktop_chat`
- `automation_schedule`
- `automation_webhook`
- `telegram`
- `imessage`
- `worker_gateway`

`mode` values:

- `chat`
- `task`
- `bg`
- `auto`

`status` values:

- `created`
- `planned`
- `waiting_approval`
- `running`
- `completed`
- `failed`
- `cancelled`

### 9.2 `run_contracts`

```sql
run_contracts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  goal TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  inputs_json TEXT,
  assumptions_json TEXT,
  constraints_json TEXT,
  deliverables_json TEXT,
  success_criteria_json TEXT,
  non_goals_json TEXT,
  approval_policy_json TEXT,
  max_cost_usd REAL NULL,
  max_tokens INTEGER NULL,
  max_duration_ms INTEGER NULL,
  created_by TEXT NOT NULL,
  created_at DATETIME
);
```

`created_by` must be `orchestrator` for initial contracts. Models may propose content but must not own the contract boundary.

### 9.3 `run_timeline_items`

```sql
run_timeline_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  status TEXT,
  visibility TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  payload_json TEXT,
  related_tool_run_id TEXT NULL,
  related_model_call_id TEXT NULL,
  related_memory_id TEXT NULL,
  related_approval_id TEXT NULL,
  related_artifact_id TEXT NULL,
  related_automation_id TEXT NULL,
  created_at DATETIME
);
```

`actor_type` values:

- `user`
- `orchestrator`
- `agent`
- `model`
- `runtime`
- `capability`
- `worker`

`visibility` values:

- `chat`
- `inspector`
- `diagnostic`

### 9.4 `approval_requests`

```sql
approval_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  timeline_item_id TEXT,
  capability_id TEXT NOT NULL,
  workflow_id TEXT NULL,
  risk_level TEXT NOT NULL,
  privacy_level TEXT,
  policy_reason TEXT,
  requested_action TEXT NOT NULL,
  impact_summary TEXT,
  dry_run_summary TEXT,
  rollback_summary TEXT,
  status TEXT NOT NULL,
  requested_at DATETIME,
  decided_at DATETIME NULL,
  decided_by TEXT NULL,
  decision_note TEXT NULL
);
```

`status` values:

- `pending`
- `approved`
- `denied`
- `expired`
- `auto_denied`

### 9.5 `run_proposals`

Use this table for Memory, Skill, and Automation proposals:

```sql
run_proposals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  rationale TEXT,
  source_refs_json TEXT,
  expected_effect_json TEXT,
  confidence REAL,
  draft_payload_json TEXT,
  created_at DATETIME,
  decided_at DATETIME NULL
);
```

`type` values:

- `memory`
- `skill`
- `automation`

`status` values:

- `proposed`
- `accepted`
- `edited`
- `dismissed`
- `expired`

## 10. API Surface

Use the project's existing API response envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "trace_id": "run_xxx"
}
```

### 10.1 Preview Run

```http
POST /api/runs/preview
```

Input:

```json
{
  "conversation_id": "conv_x",
  "message_id": "msg_x",
  "mode": "auto",
  "origin_surface": "desktop_chat",
  "text": "打包并提交新功能"
}
```

Output data:

```json
{
  "run_id": "run_x",
  "contract": {},
  "initial_card": {}
}
```

### 10.2 Start Run

```http
POST /api/runs/:run_id/start
```

### 10.3 Get Run Timeline

```http
GET /api/runs/:run_id/timeline
```

### 10.4 Approval Decision

```http
POST /api/runs/:run_id/approvals/:approval_id/decision
```

Input:

```json
{
  "decision": "approved",
  "note": "允许提交，但不要 push"
}
```

### 10.5 Proposal Decision

```http
POST /api/runs/:run_id/proposals/:proposal_id/decision
```

Input:

```json
{
  "decision": "edited",
  "edited_payload": {}
}
```

### 10.6 Resume Failed Run

```http
POST /api/runs/:run_id/resume
```

## 11. Event Taxonomy

Required event names:

```text
run.created
run.contract.created
run.plan.created
run.status.changed

model.call.started
model.call.completed
model.call.failed

capability.requested
capability.policy_evaluated
approval.requested
approval.approved
approval.denied

tool.run.started
tool.run.completed
tool.run.failed

artifact.created

memory.context.loaded
memory.proposal.created
memory.proposal.accepted
memory.proposal.dismissed

skill.proposal.created

automation.trigger.received
automation.run.linked

run.retry.started
run.completed
run.failed
run.cancelled
```

Each trace event should include:

```json
{
  "event_id": "evt_x",
  "run_id": "run_x",
  "seq": 12,
  "event_type": "capability.policy_evaluated",
  "timestamp": "2026-06-24T00:00:00Z",
  "actor": {
    "type": "runtime",
    "id": "tool-calling-runtime"
  },
  "visibility": "inspector",
  "summary": "Git commit requires approval because it modifies repository history.",
  "payload": {},
  "refs": {
    "tool_run_id": "tool_x",
    "approval_id": "approval_x",
    "model_call_id": null,
    "memory_id": null,
    "artifact_id": null
  }
}
```

## 12. Runtime, Permission, and Approval Behavior

### 12.1 Control Boundary

```text
Model engine
  -> outputs plan, reasoning summary, or tool request

Tool-calling runtime
  -> parses tool request
  -> validates capability
  -> validates risk level
  -> validates allowed roots
  -> validates privacy policy
  -> creates approval request
  -> executes capability
  -> records trace

Orchestrator Core
  -> creates run
  -> creates contract
  -> assigns agent role
  -> owns state machine
  -> decides continue, retry, or stop
```

Forbidden paths:

```text
model -> direct shell
model -> direct file write
model -> direct SQL
model -> direct network side effect
model -> direct worker command
```

### 12.2 Risk Policy

| Risk | Default behavior |
| --- | --- |
| `read-only` / `low` | Execute automatically and record trace. |
| `medium` | Execute only with recorded policy reason. |
| `high` | Require user confirmation by default. |
| `destructive` | Deny by default unless an explicit workflow allows it. |
| `secrets` / `credentials` | Do not expose to model; runtime may use them if allowed. |
| `external_send` / `publish` | Require confirmation. |
| `file_delete` / `overwrite` | Deny or require strong confirmation. |
| `git_commit` | Require confirmation. |
| `git_push` | Require high-risk confirmation. |
| `automation_triggered_high_risk` | Do not auto-execute; route to attention queue. |

### 12.3 Main-node and Worker Rules

- Main-node must complete default task flows without workers.
- Workers are elastic execution resources.
- Workers cannot bypass runtime policy.
- Worker steps write into the same run timeline.
- Worker failure must either fall back to main-node or mark the run as recoverable failure.

### 12.4 Approval Card Rules

Approval Card must live in the main chat as a first-class UI surface.

When a user denies approval:

- the runtime must not execute the requested capability;
- Orchestrator may replan;
- if no safe path remains, the run becomes `cancelled` or `failed`;
- the timeline records the denial and reason.

## 13. Memory, Skill, Automation, Token, and Logs Integration

### 13.1 Memory

Memory proposals must come from:

- explicit user preference;
- project fact;
- reusable workflow rule;
- durable task context;
- user correction.

Memory proposals must filter:

- temporary test sentences;
- explicit "do not remember" expressions;
- one-off commands;
- low-confidence chat;
- facts with no future effect;
- sensitive content without clear user intent.

Candidate payload:

```json
{
  "why_remember": "用户多次要求 Joi 不要在主聊天显示 raw trace。",
  "source": {
    "run_id": "run_x",
    "message_id": "msg_x"
  },
  "future_effect": "下次生成聊天 UI spec 时默认将 trace 放入 inspector。",
  "candidate_type": "workflow_rule",
  "confidence": 0.86
}
```

### 13.2 Skill

MVP only creates draft suggestions:

```text
检测到你连续 3 次让 Joi 做“排查会话错误原因”。
可以沉淀为 Skill：diagnose-chat-run-failure
```

Draft fields:

- trigger;
- required capabilities;
- steps;
- approval points;
- memory dependencies;
- examples;
- supporting runs;
- default disabled state.

### 13.3 Automation

The Automation page continues to own:

- schedule;
- webhook endpoint;
- HMAC secret;
- dedup path;
- timezone;
- prompt.

Every automation execution must create or attach a governed run. Automation history should display:

```text
trigger -> run id -> status -> result -> approvals -> artifacts
```

High-risk automation actions go to `Needs Attention`.

### 13.4 Token and Logs

Main chat summary:

```text
耗时 38s · 约 12.4k tokens · 估算 $0.03
```

Inspector details:

- model calls;
- input/output/cached/reasoning tokens;
- latency;
- tool runs;
- error logs;
- worker audit.

Settings keeps global aggregation and cleanup.

## 14. Acceptance Criteria

### 14.1 Functional

- A `Task` message creates `run` and `run_contract`.
- Run Card appears in main chat with goal, status, and plan summary.
- Every capability request writes a `run_timeline_item`.
- High-risk capability creates an `approval_request`.
- High-risk capability is not executed before approval.
- Denied approval prevents the capability execution.
- Automation triggers create runs with `origin_surface=automation_schedule|automation_webhook`.
- Automation runs reuse the same runtime, approval, and timeline path.
- Memory proposal shows source, reason, and future effect.
- `不要记住这句话` does not enter pending memory candidates.
- Completed runs show result summary, artifact summary, token summary, and cost estimate.
- Inspector can view timeline, tools, memory, and logs by `run_id`.
- Settings logs and token usage still aggregate correctly.
- Main-node completes default task flow without workers.
- Worker execution does not bypass approval policy.

### 14.2 UI

- Main chat does not show raw JSON by default.
- Main chat does not show worker heartbeat by default.
- Compact Run Card stays visually bounded in chat.
- Approval Card has clear approve, deny, and details actions.
- Selecting a Run Card step focuses the matching inspector timeline item.
- Failed runs show failed step, completed work, and recovery action.
- Inline Memory Proposal supports remember, edit and remember, do not remember, and mark false positive.

### 14.3 Tests

Unit tests:

- intent to run contract;
- risk policy evaluation;
- approval required matrix;
- memory candidate gate;
- event visibility mapping;
- run status state machine.

Integration tests:

- manual task -> approval -> tool -> result;
- manual task -> approval denied -> replan or stop;
- automation schedule -> governed timeline;
- webhook dedup -> one run only;
- memory proposal -> confirm -> searchable memory;
- model call tokens -> run summary aggregation;
- worker execution -> same run timeline.

Golden E2E tests:

1. Read-only diagnosis:
   - input: `排查会话错误原因`;
   - no approval for read-only logs;
   - no destructive tool;
   - evidence refs included;
   - run completes.

2. Git commit:
   - input: `打包并提交新功能`;
   - build/check may run;
   - git commit requires approval;
   - git push does not execute unless explicitly requested;
   - commit hash appears if approved.

3. Memory negative:
   - input: `不要记住这句话`;
   - no pending memory candidate;
   - optional `memory_negative_signal`;
   - no confirmed memory.

4. Webhook duplicate:
   - same payload and dedup path;
   - first trigger creates run;
   - second trigger is skipped;
   - dedup skip is logged.

5. Worker unavailable:
   - main-node executes;
   - no hard worker dependency;
   - run completes or fails with actionable reason.

## 15. Milestones

### MVP

Target: one sprint.

- Add or extend `runs`, `run_contracts`, `run_timeline_items`.
- Add main chat Run Card.
- Write capability requests into timeline.
- Add main chat Approval Card for high-risk work.
- Let inspector query by `run_id` for timeline, tools, and logs.
- Bind automation runs to `run_id`.
- Add basic inline Memory Proposal Card:
  - source;
  - rationale;
  - future effect;
  - accept/edit/dismiss.
- Aggregate token and cost summary into run summary.
- Gate behind feature flag: `features.governed_run_loop_v1`.

MVP does not include:

- full Skill runtime;
- multi-entry unified inbox;
- broad UI redesign;
- proactive agent behavior;
- new capability marketplace.

### Next

- Skill Suggestion draft card.
- Run pattern detector.
- Automation `Needs Attention` queue.
- Run resume/retry checkpoint.
- Memory candidate gate improvements.
- Approval policy editor v0.
- Artifact panel linked from Run Card.

### Later

- Unified capture surface across Telegram, iMessage, Desktop, and webhook.
- Telegram/iMessage approval replies.
- Skill versioning.
- Run regression/eval dashboard.
- Agent role performance analytics.
- Local-first cross-device sync.
- Proactive workflow layer.

## 16. Risks and Rollback

### Risks

1. Run Timeline becomes another raw logs page.
   - Mitigation: enforce `visibility=chat|inspector|diagnostic`; chat only renders `chat`.

2. Run Contract becomes too heavy for simple chat.
   - Mitigation: ordinary `Chat` mode stays light; `Task` and `Bg` get Run Cards; `Auto` escalates based on risk and complexity.

3. Approval prompts become too frequent.
   - Mitigation: read-only and low-risk work can auto-run; approval remains for high-risk work; repeated approvals may suggest a skill but must not silently grant permanent power.

4. Memory continues to over-capture.
   - Mitigation: candidate gate ships in MVP; no proposal without future effect; negative memory expressions are filtered.

5. Automation becomes invisible background execution.
   - Mitigation: every automation run has a run id, timeline, and high-risk attention path.

6. Worker execution violates control boundaries.
   - Mitigation: workers only execute runtime-assigned jobs; worker audit attaches to run timeline; failover returns to main-node.

### Rollback

- Feature flag:

```text
features.governed_run_loop_v1=false
```

- Additive migrations only:
  - do not delete old logs, run events, tool runs, or model calls.
- Dual-write during rollout:
  - continue writing existing Run Trace;
  - also write new timeline.
- Fail closed:
  - if policy evaluation fails, high-risk capability does not execute.
- Automation fallback:
  - preserve existing runner;
  - new run binding failure must not lose trigger records;
  - high-risk actions still must not execute without approval.

## 17. Likely File Areas

The exact implementation should follow current repository boundaries.

Desktop renderer:

- `apps/joi-desktop/frontend/src/App.tsx`
- chat feature components
- right inspector components
- settings automation/logs/memory/capability surfaces

Suggested new components:

- `RunCard`
- `RunStatusBadge`
- `RunPlanView`
- `RunApprovalCard`
- `RunTimeline`
- `RunTimelineItem`
- `RunCostSummary`
- `RunProposalCard`
- `InspectorRunPanel`
- `InspectorToolsPanel`
- `InspectorMemoryPanel`
- `InspectorLogsPanel`

Electron main / runtime:

- `apps/joi-electron/src/main/index.ts`
- `apps/joi-electron/src/main/automation.ts`
- `apps/joi-electron/src/main/automation-webhook.ts`
- orchestrator/runtime modules
- capability registry and policy evaluation
- logging and Run Trace services
- memory services
- worker gateway services

Suggested service boundaries:

- `RunService`
- `RunContractService`
- `RunTimelineService`
- `ApprovalService`
- `RunProposalService`
- `PolicyEngine`
- `RunCostAggregator`
- `RunArtifactService`

SQLite/store:

- migrations for `runs`, `run_contracts`, `run_timeline_items`, `approval_requests`, `run_proposals`;
- add `run_id` linkage to tool runs, model calls, automation runs, and existing run events where needed.

Runtime boundary:

```text
ModelAdapter
  -> returns structured plan/tool_request

OrchestratorCore
  -> owns run state

ToolCallingRuntime
  -> validates and executes capability

CapabilityRegistry
  -> declares risk/privacy/policy

PolicyEngine
  -> decides approval/deny/allow

WorkerGateway
  -> executes assigned jobs only
```

Event bus:

- runtime events;
- app logs;
- run events;
- worker audit;
- automation runs.

Suggested publishing helpers:

```text
emitRunEvent(run_id, event)
appendTimelineItem(run_id, item)
broadcastRunUpdate(run_id)
```

## 18. Final Position

Joi should not continue horizontally adding isolated abilities before this loop exists. The current issue is not capability count; it is that the user cannot yet read the system as one trusted personal agent.

Next sprint should focus on:

```text
Governed Run Loop v1
= Run Contract
+ User-facing Run Card
+ Structured Timeline
+ Approval Card
+ Inspector Evidence
+ Memory/Skill/Automation Proposals
+ Token/Logs Summary
```

That directly communicates Joi's product identity:

- not a chat shell;
- not a diagnostics console;
- not an automation script collection;
- a local-first, controlled, reviewable, and learnable Personal Agent Harness.
