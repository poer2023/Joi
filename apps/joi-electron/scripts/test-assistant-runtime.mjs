import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../../../packages/store/src/sqlite.ts';
import { AssistantRuntimeManager } from '../src/main/assistant-runtime.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-assistant-runtime-'));
let webhookBody = '';
const webhookServer = createServer((req, res) => {
  req.setEncoding('utf8');
  req.on('data', (chunk) => { webhookBody += chunk; });
  req.on('end', () => {
    res.writeHead(204);
    res.end();
  });
});
await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
const address = webhookServer.address();
if (!address || typeof address === 'string') throw new Error('assistant webhook fixture did not bind');

const secrets = new Map();
const secretStore = {
  async save(name, value) { secrets.set(name, value); },
  async resolve(name) { return secrets.get(name) || ''; },
};
const store = new JoiSQLiteStore({
  dbPath: join(tempDir, 'joi.db'),
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(tempDir, 'logs'),
  backupDir: join(tempDir, 'backups'),
  version: 'assistant-runtime-test',
});
const manager = new AssistantRuntimeManager(store, secretStore, join(tempDir, 'runtime'));
const evidence = {};

try {
  const started = await manager.execute({ action: 'start_activity', title: 'Real assistant capture', interval_seconds: 3600 });
  const sessionID = started.snapshot?.capture.session_id;
  assert.ok(sessionID);
  let snapshot = store.getAssistantWorkspace();
  for (let attempt = 0; attempt < 120 && snapshot.recent_activity.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    snapshot = store.getAssistantWorkspace();
  }
  assert.ok(snapshot.recent_activity.length >= 1, 'timed activity capture did not persist an event');
  const firstEvent = snapshot.recent_activity[0];
  assert.equal(firstEvent.event_type, 'screen_snapshot');
  assert.ok(firstEvent.screenshot_path && existsSync(firstEvent.screenshot_path), JSON.stringify(firstEvent));

  const captured = await manager.execute({ action: 'capture_activity_now', session_id: sessionID });
  assert.equal(captured.ok, true);
  const calendar = await manager.execute({
    action: 'create_calendar_item',
    title: 'Joi assistant runtime review',
    start_at: '2026-07-17T09:00:00+08:00',
    end_at: '2026-07-17T10:00:00+08:00',
    text: 'Draft only during contract test.',
  });
  assert.equal(calendar.ok, true);

  const plan = await manager.execute({ action: 'create_plan', title: 'Assistant closed loop', objective: 'Collect evidence and review it.' });
  const planID = plan.item.id;
  const node = await manager.execute({ action: 'add_plan_node', id: planID, title: 'Capture real evidence' });
  await manager.execute({ action: 'update_plan_node', id: node.item.id, metadata: { status: 'completed', evidence: [{ kind: 'activity_capture', path: firstEvent.screenshot_path }] } });
  const reviewed = await manager.execute({ action: 'review_plan', id: planID });
  assert.match(reviewed.item.review_summary, /1\/1/);

  const webhookURL = `http://127.0.0.1:${address.port}/discord`;
  await manager.execute({ action: 'configure_channel', provider: 'discord', title: 'Local Discord fixture', enabled: true, metadata: { webhook_url: webhookURL } });
  const sent = await manager.execute({ action: 'send_channel_message', provider: 'discord', text: 'Joi assistant channel real test' });
  assert.equal(sent.ok, true);
  assert.deepEqual(JSON.parse(webhookBody), { content: 'Joi assistant channel real test' });

  const stopped = await manager.execute({ action: 'stop_activity', session_id: sessionID });
  assert.equal(stopped.snapshot?.capture.active, false);
  evidence.capture = snapshot.capture;
  evidence.activity = firstEvent;
  evidence.manual_capture = captured.item;
  evidence.calendar_draft = calendar.item;
  evidence.plan_review = reviewed.item;
  evidence.channel_send = sent.item;
  if (process.env.JOI_EVIDENCE_DIR) {
    mkdirSync(process.env.JOI_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.JOI_EVIDENCE_DIR, 'assistant-runtime-result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
} finally {
  manager.dispose();
  store.close();
  await new Promise((resolve) => webhookServer.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('assistant real-runtime tests passed');
