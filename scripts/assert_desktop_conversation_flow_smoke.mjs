import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../packages/store/src/sqlite.ts';

const root = resolve(import.meta.dirname, '..');
const dbPath = process.argv[2] ? resolve(process.argv[2]) : '';
const evidencePath = process.argv[3] ? resolve(process.argv[3]) : '';
const auditPath = process.argv[4] ? resolve(process.argv[4]) : '';

if (!dbPath || !evidencePath) {
  console.error('usage: node --experimental-strip-types scripts/assert_desktop_conversation_flow_smoke.mjs <sqlite-path> <handoff-evidence-json> [audit-json-path]');
  process.exit(2);
}

const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const store = new JoiSQLiteStore({
  dbPath,
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(dirname(dbPath), 'logs'),
  backupDir: join(dirname(dbPath), 'backups'),
  version: 'e2e-conversation-flow-smoke-assert',
});

const checks = [];
const check = (name, condition, detail = {}) => {
  assert.ok(condition, `${name} failed: ${JSON.stringify(detail)}`);
  checks.push({ name, passed: true, ...detail });
};

const eventIndex = (events, type) => events.findIndex((event) => event.event_type === type);
const hasEvent = (events, type) => eventIndex(events, type) >= 0;
const orderedBefore = (events, first, second) => {
  const firstIndex = eventIndex(events, first);
  const secondIndex = eventIndex(events, second);
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
};

try {
  const flowRunIDs = Array.isArray(evidence.external_flows)
    ? evidence.external_flows.flatMap((flow) => [flow.run_id, flow.desktop_run_id].filter(Boolean))
    : [evidence.telegram_run_id, evidence.desktop_run_id].filter(Boolean);
  const runIDs = [...new Set(flowRunIDs)];
  check('handoff run ids are distinct', runIDs.length >= 2 && new Set(runIDs).size === runIDs.length, { runIDs });

  const runAudits = [];
  for (const runID of runIDs) {
    const trace = store.getRunTrace(runID);
    const events = trace.events || [];
    const eventTypes = events.map((event) => event.event_type);
    const seqs = events.map((event) => Number(event.seq));
    const uniqueSeqs = new Set(seqs);
    const sortedSeqs = [...seqs].sort((a, b) => a - b);
    const modeEvent = events.find((event) => event.event_type === 'run.mode_resolved');
    const runCompleted = events.find((event) => event.event_type === 'run.completed');
    const taskCoverage = store['get'](
      `SELECT COUNT(*) AS count
       FROM product_tasks
       WHERE latest_run_id=? OR source_run_id=? OR id=json_extract(?, '$.product_task_id')`,
      runID,
      runID,
      JSON.stringify(trace.metadata || {}),
    );
    const refusalCoverage = store['get'](
      `SELECT COUNT(*) AS count
       FROM run_events
       WHERE run_id=?
         AND (item_type='refusal' OR event_type IN ('task.refused', 'task.declined', 'policy.blocked'))`,
      runID,
    );

    check('run trace exists', Boolean(trace.id), { runID });
    check('run has v2 events only', events.length > 0 && events.every((event) => Number(event.schema_version) === 2), { runID, eventTypes });
    check('run event seq is unique and ordered', uniqueSeqs.size === seqs.length && JSON.stringify(seqs) === JSON.stringify(sortedSeqs), { runID, seqs });
    check('run records explicit mode resolution', trace.requested_mode === 'serious_task' && trace.resolved_mode === 'serious_task' && trace.mode_source === 'explicit', { runID, requested_mode: trace.requested_mode, resolved_mode: trace.resolved_mode, mode_source: trace.mode_source });
    check('mode resolution is user locked', modeEvent?.payload?.mode_locked_by_user === true, { runID, payload: modeEvent?.payload });
    check('run lifecycle events are ordered', orderedBefore(events, 'run.started', 'run.mode_resolved') && orderedBefore(events, 'run.mode_resolved', 'turn.started') && orderedBefore(events, 'assistant.delta', 'assistant.completed') && orderedBefore(events, 'assistant.completed', 'turn.completed') && orderedBefore(events, 'turn.completed', 'run.completed'), { runID, eventTypes });
    check('run completed terminal event exists', Boolean(runCompleted?.terminal), { runID, terminal: runCompleted?.terminal });
    check('execution run has task or refusal coverage', Number(taskCoverage?.count || 0) > 0 || Number(refusalCoverage?.count || 0) > 0, { runID, taskCoverage: Number(taskCoverage?.count || 0), refusalCoverage: Number(refusalCoverage?.count || 0) });
    check('handoff event is present', hasEvent(events, 'handoff.linked') || hasEvent(events, 'handoff.created'), { runID, eventTypes });

    runAudits.push({
      run_id: runID,
      entry_channel: trace.entry_channel,
      status: trace.status,
      terminal_status: trace.terminal_status,
      event_types: eventTypes,
    });
  }

  const flows = Array.isArray(evidence.external_flows) ? evidence.external_flows : [{
    channel: 'telegram',
    run_id: evidence.telegram_run_id,
    desktop_run_id: evidence.desktop_run_id,
    product_task_id: evidence.product_task_id,
    principal_id: evidence.principal_id,
  }];
  const productTaskIDs = [...new Set(flows.map((flow) => String(flow.product_task_id || evidence.product_task_id || '')).filter(Boolean))];
  const channels = [...new Set(flows.map((flow) => String(flow.channel || '')).filter(Boolean))];
  const linkedTaskCount = Number(store['get'](
    `SELECT COUNT(*) AS count
     FROM product_tasks
     WHERE id IN (${productTaskIDs.map(() => '?').join(',')})`,
    ...productTaskIDs,
  )?.count || 0);
  const duplicateTaskCount = productTaskIDs.reduce((sum, productTaskID) => sum + Number(store['get'](
    `SELECT COUNT(*) AS count
     FROM task_entry_links
     WHERE product_task_id=?`,
    productTaskID,
  )?.count || 0), 0);
  for (const flow of flows) {
    const channel = String(flow.channel || '');
    const productTaskID = String(flow.product_task_id || evidence.product_task_id || '');
    const principalID = String(flow.principal_id || evidence.principal_id || '');
    const channelTaskCount = store.listProductTasks({ channel, limit: 50 }).tasks.filter((task) => task.id === productTaskID).length;
    const principalTaskCount = store.listProductTasks({ principal_id: principalID, limit: 50 }).tasks.filter((task) => task.id === productTaskID).length;
    check('external channel resolves same product task', channelTaskCount === 1, { channel, productTaskID, channelTaskCount });
    check('external principal resolves same product task', principalTaskCount === 1, { channel, principalID, productTaskID, principalTaskCount });
  }
  const report = store.getRecentRunClosureReport({ limit: 25 });

  check('handoff product task exists once per product id', linkedTaskCount === productTaskIDs.length, { productTaskIDs, linkedTaskCount });
  check('closure report has terminal coverage', report.metrics.total_runs === report.metrics.terminal_event_runs, report.metrics);
  check('closure report has execution task coverage', report.metrics.execution_runs === report.metrics.execution_runs_with_task_or_refusal, report.metrics);
  check('closure report has completed task evidence', report.metrics.completed_tasks === report.metrics.completed_tasks_with_evidence, report.metrics);
  check('closure report has handoff coverage', report.metrics.runs_with_handoff_events >= runIDs.length, report.metrics);
  check('handoff fixture did not duplicate task', evidence.no_duplicate_task === true && duplicateTaskCount >= 1, { product_task_id: evidence.product_task_id, duplicateTaskCount });
  check('telegram and imessage handoff flows are covered', channels.includes('telegram') && channels.includes('imessage'), { channels });

  const audit = {
    generated_at: new Date().toISOString(),
    sqlite_path: dbPath,
    handoff_evidence_path: evidencePath,
    checks,
    runs: runAudits,
    closure_metrics: report.metrics,
  };

  if (auditPath) {
    mkdirSync(dirname(auditPath), { recursive: true });
    writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  }

  console.log(JSON.stringify(audit, null, 2));
} finally {
  store.close();
}
