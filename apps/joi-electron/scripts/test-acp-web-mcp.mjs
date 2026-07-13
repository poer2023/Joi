import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchJoiCommand,
  startJoiCommandHost,
  stopJoiCommandHost,
} from '../src/main/command-host.ts';
import {
  acpWebBridgeConfigPath,
  acpWebBridgeToken,
  createACPWebMCPServer,
  resolveACPWebMCPScript,
} from '../src/main/acp-web-bridge.ts';

const token = acpWebBridgeToken();
const executed = [];
const acpWeb = {
  token,
  execute(request) {
    executed.push(request);
    return {
      status: 'completed',
      mode: 'test_web_backend',
      query: request.payload.query,
      results: [{ title: 'Joi result', url: 'https://example.com/joi' }],
    };
  },
};

const unauthorized = await dispatchJoiCommand(
  { action: 'acp_web', token: 'wrong', capability: 'web_search', payload: { query: 'Joi' } },
  { handlers: {}, acpWeb },
);
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.error?.code, 'ACP_WEB_UNAUTHORIZED');

const denied = await dispatchJoiCommand(
  { action: 'acp_web', token, capability: 'shell_command', payload: { cmd: ['id'] } },
  { handlers: {}, acpWeb },
);
assert.equal(denied.ok, false);
assert.equal(denied.error?.code, 'ACP_WEB_CAPABILITY_DENIED');

const tempDir = await mkdtemp(join(tmpdir(), 'joi-acp-web-'));
const socketPath = join(tempDir, 'joi-cli.sock');
let child;
try {
  const spec = createACPWebMCPServer(tempDir);
  assert.equal(spec.name, 'joi_web');
  assert.equal(spec.command, '/usr/bin/env');
  assert.equal(spec.args[0], 'ELECTRON_RUN_AS_NODE=1');
  assert.equal(spec.args[1], process.execPath);
  assert.equal(spec.args[2], resolveACPWebMCPScript());
  assert.deepEqual(spec.args.slice(3), ['--bridge-config', acpWebBridgeConfigPath(tempDir)]);
  assert.deepEqual(spec.env, []);
  const bridgeConfigInfo = await stat(acpWebBridgeConfigPath(tempDir));
  assert.equal(bridgeConfigInfo.mode & 0o077, 0, 'ACP bridge descriptor must not be group/world accessible');
  const bridgeConfig = JSON.parse(await readFile(acpWebBridgeConfigPath(tempDir), 'utf8'));
  assert.equal(bridgeConfig.socket_path, socketPath);
  assert.equal(bridgeConfig.token, token);

  await startJoiCommandHost({
    socketPath,
    handlers: {},
    acpWeb,
    logger: { info() {}, warn() {}, error() {} },
  });
  child = spawn(spec.command, spec.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    // Codex ACP 1.1.2 drops McpServer.env. The launch spec must work with no
    // per-server environment entries at all.
    env: { ...process.env },
  });
  const client = mcpClient(child);
  const initialized = await client.call('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'joi-test', version: '1' },
  });
  assert.equal(initialized.protocolVersion, '2025-03-26');
  client.notify('notifications/initialized');
  const inventory = await client.call('tools/list');
  assert.deepEqual(inventory.tools.map((tool) => tool.name), ['web_search', 'web_extract']);
  const called = await client.call('tools/call', { name: 'web_search', arguments: { query: 'Joi ACP' } });
  assert.equal(called.isError, false);
  const output = JSON.parse(called.content[0].text);
  assert.equal(output.status, 'completed');
  assert.equal(output.capability, 'web_search');
  assert.equal(output.query, 'Joi ACP');
  assert.equal(executed.at(-1)?.capability, 'web_search');
  assert.equal(executed.at(-1)?.payload.query, 'Joi ACP');
  await assert.rejects(client.call('tools/call', { name: 'shell_command', arguments: {} }), /Unsupported Joi web tool/);
} finally {
  child?.kill('SIGTERM');
  await stopJoiCommandHost(socketPath);
  await rm(tempDir, { recursive: true, force: true });
}

console.log('ACP web MCP bridge tests passed');

function mcpClient(processHandle) {
  let nextID = 1;
  let buffer = '';
  const pending = new Map();
  processHandle.stdout.setEncoding('utf8');
  processHandle.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  processHandle.once('exit', (code) => {
    for (const request of pending.values()) request.reject(new Error(`MCP test process exited: ${code}`));
    pending.clear();
  });
  return {
    notify(method, params = {}) {
      processHandle.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    call(method, params = {}) {
      const id = nextID++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP ${method} timed out`));
        }, 5_000);
        pending.set(id, { resolve, reject, timer });
        processHandle.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
  };
}
