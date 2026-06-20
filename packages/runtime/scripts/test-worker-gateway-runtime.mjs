import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../../store/src/sqlite.ts';
import { startWorkerGateway } from '../src/worker-gateway.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-worker-gateway-'));
const previousAllowlist = process.env.WORKER_ALLOWED_NODE_IDS;
const previousToken = process.env.WORKER_TOKEN;
const previousAddr = process.env.WORKER_GATEWAY_ADDR;
delete process.env.WORKER_TOKEN;
process.env.WORKER_ALLOWED_NODE_IDS = 'allowed-node';

const store = new JoiSQLiteStore({
  dbPath: join(tempDir, 'joi.db'),
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(tempDir, 'logs'),
  backupDir: join(tempDir, 'backups'),
  version: 'test',
});

let token = 'token-one';
let gateway;

try {
  assert.equal(store.getSettings().worker_gateway_enabled, true);
  assert.equal(store.getSettings().worker_gateway, 'http://127.0.0.1:18081');

  gateway = await startWorkerGateway({
    store,
    addr: '127.0.0.1:0',
    resolveToken: () => token,
    logger: { info() {}, warn() {} },
  });
  const baseURL = gateway.url();

  let response = await workerRequest(baseURL, 'allowed-node', 'wrong-token', '/worker/register', { node_id: 'allowed-node' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'permission_denied');

  response = await workerRequest(baseURL, 'forged-node', 'token-one', '/worker/register', { node_id: 'forged-node' });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'node_not_allowlisted');

  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/register', {
    node_id: 'allowed-node',
    name: 'Allowed Node',
    capabilities: ['file_read'],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.node_id, 'allowed-node');
  assert.equal(store.listNodes().nodes.find((node) => node.id === 'allowed-node')?.status, 'healthy');

  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/heartbeat', { node_id: 'allowed-node' }, 'replay-nonce');
  assert.equal(response.status, 200);
  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/heartbeat', { node_id: 'allowed-node' }, 'replay-nonce');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'replay_detected');

  store['exec'](
    `INSERT INTO tasks (id, capability_id, assigned_node_id, privacy_level, status, payload, timeout_seconds)
     VALUES ('task_worker', 'file_read', 'allowed-node', 'internal', 'pending', ?, 120)`,
    JSON.stringify({ url: 'https://example.com' }),
  );

  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/tasks/claim', { node_id: 'allowed-node' });
  assert.equal(response.status, 200);
  assert.equal(response.body.task.id, 'task_worker');
  assert.equal(response.body.task.status, 'running');

  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/tasks/task_worker/ack', {
    output: {
      content_type: 'text/html',
      mode: 'web_research_v1_readonly_fetch',
      readable_text: 'Example body{background:#eee;width:60vw} Domain documentation examples.',
      summary: 'Example h1{font-size:1.5em} Domain',
    },
  });
  assert.equal(response.status, 200);

  const taskRow = store['get'](`SELECT status, result FROM tasks WHERE id='task_worker'`);
  assert.equal(taskRow.status, 'succeeded');
  const result = JSON.parse(taskRow.result);
  assert.ok(!result.readable_text.includes('body{'));
  assert.ok(result.readable_text.includes('documentation examples'));

  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/tasks/task_worker/ack', { output: { status: 'again' } });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'task_not_running');

  token = 'token-two';
  response = await workerRequest(baseURL, 'allowed-node', 'token-one', '/worker/heartbeat', { node_id: 'allowed-node' });
  assert.equal(response.status, 401);
  response = await workerRequest(baseURL, 'allowed-node', 'token-two', '/worker/heartbeat', { node_id: 'allowed-node' });
  assert.equal(response.status, 200);

  store.disableNode('allowed-node');
  response = await workerRequest(baseURL, 'allowed-node', 'token-two', '/worker/tasks/claim', { node_id: 'allowed-node' });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'node_disabled');

  const auditReasons = store.listWorkerGatewayAuditLogs(100).items.map((item) => item.reason);
  assert.ok(auditReasons.includes('bad_token'));
  assert.ok(auditReasons.includes('node_not_allowlisted'));
  assert.ok(auditReasons.includes('replay_detected'));
  assert.ok(auditReasons.includes('task_ack'));
  assert.ok(auditReasons.includes('node_disabled'));

  console.log('worker gateway runtime tests passed');
} finally {
  await gateway?.close();
  store.close();
  if (previousAllowlist === undefined) delete process.env.WORKER_ALLOWED_NODE_IDS;
  else process.env.WORKER_ALLOWED_NODE_IDS = previousAllowlist;
  if (previousToken === undefined) delete process.env.WORKER_TOKEN;
  else process.env.WORKER_TOKEN = previousToken;
  if (previousAddr === undefined) delete process.env.WORKER_GATEWAY_ADDR;
  else process.env.WORKER_GATEWAY_ADDR = previousAddr;
  rmSync(tempDir, { recursive: true, force: true });
}

async function workerRequest(baseURL, nodeID, token, path, payload, nonce = randomNonce()) {
  const response = await fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Worker-Node-ID': nodeID,
      'X-Worker-Timestamp': new Date().toISOString(),
      'X-Worker-Nonce': nonce,
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  return {
    status: response.status,
    body: raw ? JSON.parse(raw) : {},
  };
}

function randomNonce() {
  return `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
