import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rawArgs = process.argv.slice(2);
const requireComplete = rawArgs.includes('--require-complete');
const outArg = rawArgs.find((arg) => arg.startsWith('--out='));
const outPath = outArg ? resolve(outArg.slice('--out='.length)) : '';
const tokenArg = rawArgs.find((arg) => arg.startsWith('--token='));
const proofToken = (tokenArg ? tokenArg.slice('--token='.length) : process.env.JOI_LIVE_HANDOFF_TOKEN || '').trim();

const appProcesses = inspectAppProcesses();
const prodSchema = runJSON(['--experimental-strip-types', join(root, 'scripts/desktop_production_schema_migration.mjs')]);
const externalStatus = runJSON(['--experimental-strip-types', join(root, 'scripts/desktop_external_status.mjs'), '--require-external', '--check-connections']);
const liveAudit = runJSON(liveHandoffAuditArgs(['--include-readiness']));
const liveRequiredAudit = runJSON(liveHandoffAuditArgs(['--require-live', '--include-readiness']), { allowFailure: true });
const manualE2EAudit = runJSON(['--experimental-strip-types', join(root, 'scripts/conversation_flow_manual_e2e_audit.mjs')]);
const latestGate = latestConversationFlowGate();
const gateSteps = summarizeGateSteps(latestGate.summary);
const smokeAuditPath = latestGate.evidence_dir ? join(latestGate.evidence_dir, 'desktop-smoke', 'closure-smoke-audit.json') : '';
const smokeAudit = readOptionalJSON(smokeAuditPath);
const smokeChecks = Array.isArray(smokeAudit?.checks) ? smokeAudit.checks : [];
const smokeRuns = Array.isArray(smokeAudit?.runs) ? smokeAudit.runs : [];
const closureMetrics = smokeAudit?.closure_metrics || {};

const streamingProjectionGateSteps = [
  'store',
  'runtime',
  'electron-contract',
  'frontend-chat-projection',
  'frontend-execution-actions',
  'frontend-task-mini-list',
  'desktop-real-model',
  'desktop-conversation-flow-smoke',
];
const eventProtocolSmokeChecks = [
  'run has v2 events only',
  'run event seq is unique and ordered',
  'run lifecycle events are ordered',
  'run completed terminal event exists',
  'closure report has terminal coverage',
];
const modeTaskSmokeChecks = [
  'run records explicit mode resolution',
  'mode resolution is user locked',
  'execution run has task or refusal coverage',
  'closure report has execution task coverage',
  'closure report has completed task evidence',
];
const durableGateSteps = [
  'store',
  'runtime',
  'frontend-chat-projection',
  'frontend-execution-actions',
  'desktop-crash-recovery',
];
const memoryProactiveGateSteps = [
  'store',
  'frontend-chat-projection',
  'desktop-conversation-flow-smoke',
];
const crossEntryGateSteps = [
  'live-handoff-audit-fixture',
  'desktop-conversation-flow-smoke',
];
const crossEntrySmokeChecks = [
  'external channel resolves same product task',
  'external principal resolves same product task',
  'handoff product task exists once per product id',
  'handoff fixture did not duplicate task',
  'telegram and imessage handoff flows are covered',
  'closure report has handoff coverage',
];
const streamingMarkers = sourceMarkerEvidence([
  {
    path: 'packages/runtime/src/tool-calling.ts',
    markers: ['onModelDelta', 'onAssistantDelta', 'onToolStarted', 'onApprovalRequired', 'onUsage'],
  },
  {
    path: 'packages/store/src/sqlite.ts',
    markers: ['model.delta', 'assistant.delta', 'tool.call_requested', 'tool.started', 'tool.output_delta', 'tool.approval_required', 'usage.recorded'],
  },
  {
    path: 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs',
    markers: ['assistant.delta', 'assistant.completed', 'tool.finished'],
  },
]);
const durableMarkers = sourceMarkerEvidence([
  {
    path: 'packages/store/scripts/test-sqlite-store.mjs',
    markers: ['approval.resumed', 'run.resumed', 'duplicateResume', 'run.cancel_requested', 'run.cancelled', 'run.redirected', 'listRecoverableRuns'],
  },
  {
    path: 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs',
    markers: ['run.resumed', 'run.cancel_requested', 'run.cancelled', 'run.redirected'],
  },
]);
const memoryProactiveMarkers = sourceMarkerEvidence([
  {
    path: 'packages/store/scripts/test-sqlite-store.mjs',
    markers: ['runs_with_memory_events > 0', 'runs_with_proactive_events > 0', 'memory.corrected', 'open_loop.expired', 'proactive.delivered', 'proactive.suppressed', 'notification.resumed'],
  },
  {
    path: 'apps/joi-desktop/frontend/scripts/test-chat-projection.mjs',
    markers: ['memory.corrected', 'open_loop.expired', 'proactive.suppressed', 'notification.resumed'],
  },
]);

const items = [
  auditItem(
    'production_schema_current',
    'Production SQLite has the additive conversation-flow schema required by the spec.',
    Boolean(prodSchema.ok && prodSchema.json?.sqlite_exists && prodSchema.json?.after?.schema_current),
    {
      sqlite_path: prodSchema.json?.sqlite_path || '',
      missing_schema: prodSchema.json?.after?.missing_schema || prodSchema.json?.before?.missing_schema || [],
      applied: Boolean(prodSchema.json?.applied),
    },
  ),
  auditItem(
    'production_app_running',
    'The installed Electron app is running from /Applications/Joi.app with inbound sidecar process evidence.',
    appProcesses.joi_pids.length > 0 && appProcesses.sidecar_pids.length > 0,
    appProcesses,
  ),
  auditItem(
    'local_conversation_flow_gate',
    'The local full gate covering store/runtime/secrets/electron/frontend/build/smoke/external-preflight has passed.',
    latestGate.passed,
    {
      passed: latestGate.passed,
      evidence_dir: latestGate.evidence_dir,
      summary_path: latestGate.summary_path,
      steps: pickGateSteps(gateSteps, [
        'store',
        'runtime',
        'electron-contract',
        'desktop-evals',
        'frontend-chat-projection',
        'frontend-execution-actions',
        'frontend-task-mini-list',
        'frontend-build',
        'electron-build',
        'live-handoff-audit-fixture',
        'desktop-crash-recovery',
        'desktop-real-model',
        'desktop-conversation-flow-smoke',
        'external-preflight',
      ]),
    },
  ),
  auditItem(
    'real_streaming_event_projection',
    'Provider/assistant deltas, tool activity, approval pauses, usage, terminal events, and frontend projection are covered by the full gate.',
    gateStepsPassed(gateSteps, streamingProjectionGateSteps)
      && smokeChecksPassed(smokeChecks, eventProtocolSmokeChecks)
      && smokeRunsHaveEvents(smokeRuns, ['assistant.delta', 'assistant.completed', 'usage.recorded'])
      && streamingMarkers.passed,
    {
      gate_steps: pickGateSteps(gateSteps, streamingProjectionGateSteps),
      smoke_audit_path: smokeAuditPath,
      smoke_checks: summarizeSmokeChecks(smokeChecks, eventProtocolSmokeChecks),
      representative_runs: summarizeSmokeRuns(smokeRuns),
      required_run_events: ['assistant.delta', 'assistant.completed', 'usage.recorded'],
      source_markers: streamingMarkers.files,
    },
  ),
  auditItem(
    'mode_task_evidence_contract',
    'Explicit mode resolution is not silently overridden, execution runs create or decline work, and completed tasks require evidence.',
    gateStepsPassed(gateSteps, ['store', 'desktop-conversation-flow-smoke'])
      && smokeChecksPassed(smokeChecks, modeTaskSmokeChecks)
      && Number(closureMetrics.execution_runs || 0) > 0
      && Number(closureMetrics.execution_runs || 0) === Number(closureMetrics.execution_runs_with_task_or_refusal || 0)
      && Number(closureMetrics.completed_tasks || 0) > 0
      && Number(closureMetrics.completed_tasks || 0) === Number(closureMetrics.completed_tasks_with_evidence || 0),
    {
      gate_steps: pickGateSteps(gateSteps, ['store', 'desktop-conversation-flow-smoke']),
      smoke_audit_path: smokeAuditPath,
      smoke_checks: summarizeSmokeChecks(smokeChecks, modeTaskSmokeChecks),
      closure_metrics: pickMetrics(closureMetrics, [
        'execution_runs',
        'execution_runs_with_task_or_refusal',
        'completed_tasks',
        'completed_tasks_with_evidence',
      ]),
    },
  ),
  auditItem(
    'durable_interrupt_resume_recovery',
    'Cancel, redirect, approval resume, duplicate resume idempotency, and crash recovery are covered by store/frontend/runtime gates.',
    gateStepsPassed(gateSteps, durableGateSteps) && durableMarkers.passed,
    {
      gate_steps: pickGateSteps(gateSteps, durableGateSteps),
      source_markers: durableMarkers.files,
    },
  ),
  auditItem(
    'memory_proactive_feedback_contract',
    'Memory corrections, open-loop expiry, proactive delivery/suppression, notification resume, and reporting counters are covered by local gates.',
    gateStepsPassed(gateSteps, memoryProactiveGateSteps) && memoryProactiveMarkers.passed,
    {
      gate_steps: pickGateSteps(gateSteps, memoryProactiveGateSteps),
      source_markers: memoryProactiveMarkers.files,
    },
  ),
  auditItem(
    'cross_entry_handoff_fixture',
    'Desktop, Telegram, and iMessage fixture flows share principal, conversation, Product Task, and no-duplicate semantics.',
    gateStepsPassed(gateSteps, crossEntryGateSteps) && smokeChecksPassed(smokeChecks, crossEntrySmokeChecks),
    {
      gate_steps: pickGateSteps(gateSteps, crossEntryGateSteps),
      smoke_audit_path: smokeAuditPath,
      smoke_checks: summarizeSmokeChecks(smokeChecks, crossEntrySmokeChecks),
      channels: [...new Set(smokeRuns.map((run) => run?.entry_channel).filter(Boolean))],
      product_task_ids: [...new Set(smokeChecks
        .flatMap((check) => [check?.productTaskID, ...(Array.isArray(check?.product_task_ids) ? check.product_task_ids : [])])
        .filter(Boolean))],
      closure_metrics: pickMetrics(closureMetrics, ['runs_with_handoff_events']),
    },
  ),
  auditItem(
    'external_entry_readiness',
    'At least one external entry point is configured, connection-checked, and backed by a running service.',
    Boolean(externalStatus.ok && Object.entries(externalStatus.json?.services || {}).some(([name, service]) => name !== 'desktop_app' && service?.ready)),
    {
      credentials: redactSources(externalStatus.json?.credentials || {}),
      checks: summarizeChecks(externalStatus.json?.checks || {}),
      services: summarizeServices(externalStatus.json?.services || {}),
    },
  ),
  auditItem(
    'manual_e2e_proof',
    'Manual E2E evidence covers pure chat, serious task, approval, cancel, redirect, recovery, memory correction, proactive closure, and external continuation.',
    Boolean(manualE2EAudit.ok && manualE2EAudit.json?.complete === true),
    {
      status: manualE2EAudit.json?.status || 'unknown',
      evidence_path: manualE2EAudit.json?.evidence_path || '',
      evidence_exists: Boolean(manualE2EAudit.json?.evidence_exists),
      blocking_item_ids: manualE2EAudit.json?.blocking_item_ids || [],
      items: summarizeManualE2EItems(manualE2EAudit.json?.items || []),
      next_action: manualE2EAudit.json?.next_action || '',
      error: manualE2EAudit.json?.evidence_parse_error || manualE2EAudit.error || '',
    },
  ),
  auditItem(
    'recent_run_report_handoff_status',
    'Recent-run reporting exposes terminal coverage, evidence counters, and handoff state.',
    Boolean(liveAudit.ok && liveAudit.json?.status && liveAudit.json?.metrics && liveAudit.json?.readiness),
    {
      status: liveAudit.json?.status || 'unknown',
      metrics: liveAudit.json?.metrics || {},
      proof_token: liveAudit.json?.proof_token || proofToken || '',
      token_filter_applied: Boolean(liveAudit.json?.token_filter_applied),
      pending_external_handoffs: summarizePendingHandoffs(liveAudit.json?.pending_external_handoffs || []),
      readiness_ok: liveAudit.json?.readiness?.ok === true,
      next_action: liveAudit.json?.next_action || '',
    },
  ),
  auditItem(
    'live_external_to_desktop_handoff',
    'A real Telegram or iMessage-originated task is linked to a Desktop continuation of the same Product Task.',
    Boolean(liveRequiredAudit.ok
      && liveRequiredAudit.json?.status === 'live_handoff_linked'
      && Number(liveRequiredAudit.json?.metrics?.linked_external_desktop_tasks || 0) > 0
      && (!proofToken || (liveRequiredAudit.json?.token_filter_applied === true && liveRequiredAudit.json?.proof_token === proofToken))),
    {
      status: liveRequiredAudit.json?.status || 'unknown',
      proof_token: liveRequiredAudit.json?.proof_token || proofToken || '',
      token_filter_applied: Boolean(liveRequiredAudit.json?.token_filter_applied),
      external_runs: Number(liveRequiredAudit.json?.metrics?.external_runs || 0),
      linked_external_desktop_tasks: Number(liveRequiredAudit.json?.metrics?.linked_external_desktop_tasks || 0),
      pending_external_handoffs: summarizePendingHandoffs(liveRequiredAudit.json?.pending_external_handoffs || []),
      readiness_ok: liveRequiredAudit.json?.readiness?.ok === true,
      error: liveRequiredAudit.json?.error || liveRequiredAudit.error || '',
      next_action: liveRequiredAudit.json?.next_action || '',
    },
  ),
];

const complete = items.every((item) => item.status === 'proved');
const audit = {
  generated_at: new Date().toISOString(),
  complete,
  objective: 'Joi conversation-flow closure optimization',
  proof_token: proofToken || '',
  token_filter_applied: Boolean(proofToken),
  status: complete ? 'complete' : 'incomplete',
  blocking_item_ids: items.filter((item) => item.status !== 'proved').map((item) => item.id),
  items,
};

const output = `${JSON.stringify(audit, null, 2)}\n`;
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output);
}
process.stdout.write(output);

if (requireComplete && !complete) {
  process.exit(1);
}

function auditItem(id, requirement, proved, evidence) {
  return {
    id,
    requirement,
    status: proved ? 'proved' : 'incomplete',
    evidence,
  };
}

function liveHandoffAuditArgs(extraArgs = []) {
  const args = ['--experimental-strip-types', join(root, 'scripts/desktop_live_external_handoff_audit.mjs'), ...extraArgs];
  if (proofToken) args.push(`--token=${proofToken}`);
  return args;
}

function runJSON(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, json: parseJSON(stdout), stdout };
  } catch (error) {
    const stdout = error?.stdout?.toString?.() || '';
    return {
      ok: false,
      json: parseJSON(stdout),
      stdout,
      error: error instanceof Error ? error.message : String(error),
      exit_code: typeof error?.status === 'number' ? error.status : 1,
      allowed_failure: Boolean(options.allowFailure),
    };
  }
}

function parseJSON(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function inspectAppProcesses() {
  let output = '';
  try {
    output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { joi_pids: [], sidecar_pids: [] };
  }
  const rows = output.split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }));
  const joiRows = rows.filter((row) => row.command.includes('/Applications/Joi.app/Contents/MacOS/Joi'));
  const joiPids = new Set(joiRows.map((row) => row.pid));
  const sidecarRows = rows.filter((row) => row.command.includes('node index.mjs') && joiPids.has(row.ppid));
  return {
    joi_pids: joiRows.map((row) => row.pid),
    sidecar_pids: sidecarRows.map((row) => row.pid),
  };
}

function latestConversationFlowGate() {
  const e2eDir = join(root, '.e2e');
  if (!existsSync(e2eDir)) return { passed: false, evidence_dir: '', summary_path: '' };
  const candidates = readdirSync(e2eDir)
    .filter((name) => name.startsWith('joi-conversation-flow-gate-'))
    .map((name) => {
      const evidenceDir = join(e2eDir, name);
      const summaryPath = join(evidenceDir, 'summary.txt');
      return {
        evidence_dir: evidenceDir,
        summary_path: summaryPath,
        mtime_ms: statSync(evidenceDir).mtimeMs,
        summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '',
      };
    })
    .sort((a, b) => b.mtime_ms - a.mtime_ms);
  const latest = candidates.find((candidate) => gatePassed(candidate.summary)) || candidates[0];
  if (!latest) return { passed: false, evidence_dir: '', summary_path: '' };
  return {
    passed: gatePassed(latest.summary),
    evidence_dir: latest.evidence_dir,
    summary_path: latest.summary_path,
    summary: latest.summary,
  };
}

function gatePassed(summary) {
  return summary.includes('CONVERSATION_FLOW_LOCAL_GATE passed') && summary.includes('EXTERNAL_PREFLIGHT passed');
}

function summarizeGateSteps(summary) {
  const steps = {};
  for (const line of String(summary || '').split('\n')) {
    const match = line.match(/^(PASS|FAIL)\s+(\S+)(?:\s+log=(.+))?/);
    if (!match) continue;
    steps[match[2]] = {
      status: match[1] === 'PASS' ? 'passed' : 'failed',
      log_path: match[3] || '',
    };
  }
  return steps;
}

function gateStepsPassed(steps, names) {
  return names.every((name) => steps?.[name]?.status === 'passed');
}

function pickGateSteps(steps, names) {
  return Object.fromEntries(names.map((name) => [
    name,
    steps?.[name] || { status: 'missing', log_path: '' },
  ]));
}

function readOptionalJSON(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function smokeChecksPassed(checks, names) {
  return names.every((name) => {
    const matches = checks.filter((check) => check?.name === name);
    return matches.length > 0 && matches.every((check) => check.passed === true);
  });
}

function summarizeSmokeChecks(checks, names) {
  return Object.fromEntries(names.map((name) => {
    const matches = checks.filter((check) => check?.name === name);
    return [
      name,
      {
        passed: matches.length > 0 && matches.every((check) => check.passed === true),
        count: matches.length,
      },
    ];
  }));
}

function smokeRunsHaveEvents(runs, eventTypes) {
  return runs.length > 0 && runs.every((run) => {
    const events = Array.isArray(run?.event_types) ? run.event_types : [];
    return eventTypes.every((eventType) => events.includes(eventType));
  });
}

function summarizeSmokeRuns(runs) {
  return runs.slice(0, 5).map((run) => ({
    run_id: run?.run_id || '',
    entry_channel: run?.entry_channel || '',
    status: run?.status || '',
    terminal_status: run?.terminal_status || '',
    event_types: Array.isArray(run?.event_types) ? run.event_types : [],
  }));
}

function pickMetrics(metrics, names) {
  return Object.fromEntries(names.map((name) => [name, Number(metrics?.[name] || 0)]));
}

function sourceMarkerEvidence(definitions) {
  const files = definitions.map((definition) => {
    const absolutePath = join(root, definition.path);
    const source = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    const markers = definition.markers.map((marker) => ({
      marker,
      found: source.includes(marker),
    }));
    return {
      path: absolutePath,
      passed: markers.every((marker) => marker.found),
      markers,
    };
  });
  return {
    passed: files.every((file) => file.passed),
    files,
  };
}

function redactSources(credentials) {
  return Object.fromEntries(Object.entries(credentials).map(([name, credential]) => [
    name,
    { present: Boolean(credential?.present), source: credential?.source || 'unknown' },
  ]));
}

function summarizeChecks(checks) {
  return Object.fromEntries(Object.entries(checks).map(([name, check]) => [
    name,
    { ok: Boolean(check?.ok), status: check?.status || 'unknown' },
  ]));
}

function summarizeServices(services) {
  return Object.fromEntries(Object.entries(services).map(([name, service]) => [
    name,
    {
      enabled: Boolean(service?.enabled),
      configured: Boolean(service?.configured),
      running: Boolean(service?.running),
      ready: Boolean(service?.ready),
    },
  ]));
}

function summarizePendingHandoffs(handoffs) {
  return handoffs.slice(0, 5).map((handoff) => ({
    external_channel: handoff?.external_channel || '',
    external_run_id: handoff?.external_run_id || '',
    product_task_id: handoff?.product_task_id || '',
    latest_task_status: handoff?.latest_task_status || '',
    latest_task_title: handoff?.latest_task_title || '',
  }));
}

function summarizeManualE2EItems(items) {
  return items.map((item) => ({
    id: item?.id || '',
    status: item?.status || 'unknown',
    configured_status: item?.evidence?.configured_status || '',
    missing_reason: item?.evidence?.missing_reason || '',
  }));
}
