import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  executeServerDiagnose,
  executeSystemHealthCheck,
} from '../src/diagnostics.ts';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.notEqual(typeof address, 'string');
  const port = address.port;

  const diagnose = await executeServerDiagnose({
    service_name: 'fixture-service',
    host: '127.0.0.1',
    port,
    url: `http://127.0.0.1:${port}/health`,
  });
  assert.equal(diagnose.mode, 'server_diagnose_v1_ts_readonly');
  assert.equal(diagnose.service, 'fixture-service');
  assert.equal(diagnose.port.status, 'open');
  assert.equal(diagnose.http.status, 'reachable');
  assert.equal(diagnose.docker.required, false);
  assert.deepEqual(diagnose.issues, []);

  const blocked = await executeServerDiagnose({ url: 'http://169.254.169.254/latest/meta-data/' });
  assert.equal(blocked.http.status, 'policy_blocked');
  assert.equal(blocked.http.reason, 'metadata_ip_blocked');

  const health = executeSystemHealthCheck({
    service_status: { sqlite: true, electron: 'running', worker: false },
    queue_status: { pending: 0 },
    worker_status: [],
    warnings: [],
  });
  assert.equal(health.mode, 'system_health_check_v1_ts_store');
  assert.deepEqual(health.unhealthy, ['worker']);
  assert.ok(health.summary.includes('worker'));

  console.log('diagnostics runtime tests passed');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
