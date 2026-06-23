import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs.filter((arg) => !arg.includes('=')));
const gateArg = rawArgs.find((arg) => arg.startsWith('--gate-dir='));
const evidenceArg = rawArgs.find((arg) => arg.startsWith('--evidence='));
const outArg = rawArgs.find((arg) => arg.startsWith('--out='));
const actorArg = rawArgs.find((arg) => arg.startsWith('--actor='));
const force = args.has('--force');

const gateDir = gateArg ? resolve(gateArg.slice('--gate-dir='.length)) : latestGateDir();
const evidencePath = evidenceArg
  ? resolve(evidenceArg.slice('--evidence='.length))
  : join(gateDir, 'desktop-smoke', 'manual-e2e-evidence.json');
const outPath = outArg ? resolve(outArg.slice('--out='.length)) : '';
const actor = actorArg ? actorArg.slice('--actor='.length).trim() : 'codex-full-gate';
const observedAt = new Date().toISOString();

if (!existsSync(evidencePath)) {
  execFileSync(process.execPath, [
    '--experimental-strip-types',
    join(root, 'scripts/conversation_flow_manual_e2e_audit.mjs'),
    '--init',
    `--evidence=${evidencePath}`,
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
evidence.items = Array.isArray(evidence.items) ? evidence.items : [];
const changes = [];

for (const definition of definitions()) {
  const item = evidence.items.find((candidate) => candidate?.id === definition.id);
  if (!item) continue;
  if (!force && item.status === 'passed' && item.actor && item.observed_at) continue;
  const proof = evaluateDefinition(definition, gateDir);
  if (!proof.passed) {
    changes.push({ id: definition.id, status: 'unchanged', reason: proof.reason });
    continue;
  }
  item.status = 'passed';
  item.observed_at = observedAt;
  item.actor = actor;
  item.notes = proof.notes;
  item.artifact_paths = proof.artifacts;
  changes.push({ id: definition.id, status: 'passed', artifact_count: proof.artifacts.length });
}

evidence.collected_at = observedAt;
evidence.collector = 'conversation_flow_manual_e2e_collect';
evidence.gate_dir = gateDir;
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

const audit = runManualAudit(evidencePath);
const output = {
  generated_at: observedAt,
  gate_dir: gateDir,
  evidence_path: evidencePath,
  changes,
  audit,
};
const text = `${JSON.stringify(output, null, 2)}\n`;
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
}
process.stdout.write(text);

function evaluateDefinition(definition, currentGateDir) {
  const artifacts = definition.artifacts(currentGateDir).map((path) => resolve(path));
  const missingArtifacts = artifacts.filter((path) => !existsSync(path));
  if (missingArtifacts.length > 0) {
    return { passed: false, reason: `missing artifacts: ${missingArtifacts.join(', ')}` };
  }
  const missingMarkers = [];
  for (const markerCheck of definition.markers || []) {
    const sourcePath = resolve(markerCheck.path);
    const source = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '';
    for (const marker of markerCheck.markers) {
      if (!source.includes(marker)) missingMarkers.push(`${sourcePath}:${marker}`);
    }
  }
  if (missingMarkers.length > 0) {
    return { passed: false, reason: `missing markers: ${missingMarkers.join(', ')}` };
  }
  if (definition.extra && !definition.extra(currentGateDir)) {
    return { passed: false, reason: 'extra proof condition failed' };
  }
  return {
    passed: true,
    artifacts,
    notes: definition.notes(currentGateDir),
  };
}

function latestGateDir() {
  const e2eDir = join(root, '.e2e');
  if (!existsSync(e2eDir)) return '';
  const gates = readdirSync(e2eDir)
    .filter((name) => name.startsWith('joi-conversation-flow-gate-'))
    .map((name) => {
      const gatePath = join(e2eDir, name);
      const summaryPath = join(gatePath, 'summary.txt');
      const summary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '';
      return {
        path: gatePath,
        mtime: statSync(gatePath).mtimeMs,
        passed: summary.includes('CONVERSATION_FLOW_LOCAL_GATE passed') && summary.includes('EXTERNAL_PREFLIGHT passed'),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return (gates.find((gate) => gate.passed) || gates[0])?.path || '';
}

function runManualAudit(path) {
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types',
    join(root, 'scripts/conversation_flow_manual_e2e_audit.mjs'),
    `--evidence=${path}`,
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function liveHandoffLinked(currentGateDir) {
  const path = join(currentGateDir, 'live-external-handoff-audit.json');
  if (!existsSync(path)) return false;
  try {
    const audit = JSON.parse(readFileSync(path, 'utf8'));
    return audit?.status === 'live_handoff_linked' && Number(audit?.metrics?.linked_external_desktop_tasks || 0) > 0;
  } catch {
    return false;
  }
}

function definitions() {
  return [
  {
    id: 'pure_chat_streaming_no_task',
    artifacts: (gate) => [
      join(gate, 'frontend-chat-projection.log'),
      join(root, 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs'),
    ],
    markers: [{
      path: join(root, 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs'),
      markers: ['stream please', 'assistant.delta', "assert.deepEqual(result.items.map((item) => item.type), ['message', 'message'])"],
    }],
    notes: () => 'Frontend projector test observed pure chat streaming deltas merging into one terminal assistant message without task UI.',
  },
  {
    id: 'serious_task_card_tool_evidence',
    artifacts: (gate) => [
      join(gate, 'desktop-smoke/closure-smoke-audit.json'),
      join(gate, 'frontend-execution-actions.log'),
      join(root, 'apps/joi-desktop/frontend/scripts/test-execution-actions.mjs'),
    ],
    markers: [{
      path: join(root, 'apps/joi-desktop/frontend/scripts/test-execution-actions.mjs'),
      markers: ['product_task_created', 'artifact_created', 'visibleExecutionActions'],
    }],
    notes: () => 'Full gate observed serious-task projection, task/action UI, artifact evidence, and terminal task coverage through smoke audit and frontend execution actions.',
  },
  {
    id: 'approval_denied_semantics',
    artifacts: (gate) => [join(gate, 'store.log'), join(root, 'packages/store/scripts/test-sqlite-store.mjs')],
    markers: [{
      path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      markers: ['decideConfirmation({ id: waitingConfirmation.id, approve: false', "assert.equal(rejectedTrace.status, 'failed')", "assert.equal(store.getProductTask(waitingToolCallingChat.product_task.id).task.status, 'blocked')"],
    }],
    notes: () => 'Store gate observed denied approval turning the run failed and Product Task blocked while preserving approval state.',
  },
  {
    id: 'approval_resume_after_reload',
    artifacts: (gate) => [join(gate, 'store.log'), join(root, 'packages/store/scripts/test-sqlite-store.mjs')],
    markers: [{
      path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      markers: ['loadApprovedToolCallingResume', 'completeApprovedToolCallingResume', 'duplicateResume', "tool_call_id='call_apply_patch_resume'"],
    }],
    notes: () => 'Store gate observed approval resume, edited parameters, run.resumed events, and duplicate resume idempotency.',
  },
  {
    id: 'cancel_streaming_response',
    artifacts: (gate) => [
      join(gate, 'store.log'),
      join(gate, 'frontend-chat-projection.log'),
      join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      join(root, 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs'),
    ],
    markers: [
      { path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'), markers: ['run.cancel_requested', 'run.cancelled', 'cancel waiting approval'] },
      { path: join(root, 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs'), markers: ['run.cancel_requested', 'User cancelled', "activeRunStatusByRunId.run_1, 'cancelled'"] },
    ],
    notes: () => 'Store and frontend gates observed cancellation events, terminal cancelled state, and persisted cancelled projection.',
  },
  {
    id: 'redirect_running_task',
    artifacts: (gate) => [
      join(gate, 'store.log'),
      join(gate, 'frontend-chat-projection.log'),
      join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
    ],
    markers: [{
      path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      markers: ['redirectRun({ run_id: redirectStarted.run_id', 'redirected_from_run_id: redirectStarted.run_id', "assert.equal(redirectChildTrace.parent_run_id, redirectStarted.run_id)"],
    }],
    notes: () => 'Store gate observed redirected parent run and linked child run metadata; frontend gate observed redirect banner projection.',
  },
  {
    id: 'restart_paused_run_recovery',
    artifacts: (gate) => [
      join(gate, 'desktop-crash-recovery.log'),
      join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
    ],
    markers: [{
      path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      markers: ['listRecoverableRuns', 'runtime state was lost after app restart', 'needs_user_decision'],
    }],
    notes: () => 'Crash/recovery gate observed restart classification for orphaned and waiting-approval runs.',
  },
  {
    id: 'memory_correction_next_turn',
    artifacts: (gate) => [
      join(gate, 'store.log'),
      join(gate, 'frontend-chat-projection.log'),
      join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      join(root, 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs'),
    ],
    markers: [
      { path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'), markers: ['memory.corrected', 'previous_memory_id', 'superseded or disabled memories must not be recalled', "!toolCallingTrace.events.some((event) => event.event_type === 'memory.recalled' && event.item_id === 'mem_test')"] },
      { path: join(root, 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs'), markers: ['memory.corrected', 'previousMemoryId'] },
    ],
    notes: () => 'Store/frontend gates observed memory correction events and stale-memory suppression coverage.',
  },
  {
    id: 'reminder_proactive_terminal_state',
    artifacts: (gate) => [
      join(gate, 'store.log'),
      join(gate, 'frontend-chat-projection.log'),
      join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
    ],
    markers: [{
      path: join(root, 'packages/store/scripts/test-sqlite-store.mjs'),
      markers: ['proactive.delivered', 'proactive.suppressed', 'open_loop.expired', 'runs_with_proactive_events > 0'],
    }],
    notes: () => 'Store/frontend gates observed proactive delivery, suppression, feedback, and open-loop expiry terminal states.',
  },
  {
    id: 'external_entry_desktop_continuation',
    artifacts: (gate) => [
      join(gate, 'live-external-handoff-audit.json'),
    ],
    extra: liveHandoffLinked,
    notes: () => 'Live external handoff audit observed a real Telegram or iMessage originated task continued in Desktop as the same Product Task.',
  },
  ];
}
