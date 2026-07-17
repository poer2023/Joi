import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileElectronCapabilityTools } from '../../../packages/runtime/src/capability-compiler.ts';
import {
  dispatchJoiCommand,
  startJoiCommandHost,
  stopJoiCommandHost,
} from '../src/main/command-host.ts';
import {
  acpWebBridgeConfigPath,
  acpWebBridgeToken,
  createACPCapabilityMCPServer,
  createACPWebMCPServer,
  resolveACPBridgeGrant,
  resolveACPWebMCPScript,
} from '../src/main/acp-web-bridge.ts';

const token = acpWebBridgeToken();
const executed = [];
const acpWeb = {
  authorize: resolveACPBridgeGrant,
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
const children = [];
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
  const child = spawn(spec.command, spec.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    // Codex ACP 1.1.2 drops McpServer.env. The launch spec must work with no
    // per-server environment entries at all.
    env: { ...process.env },
  });
  children.push(child);
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
  await assert.rejects(client.call('tools/call', { name: 'shell_command', arguments: {} }), /Unsupported Joi capability tool/);

  const capabilitySpec = createACPCapabilityMCPServer(tempDir, [
    {
      name: 'workspace_search',
      description: 'Search an authorized workspace.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'file_read',
      description: 'Read an authorized workspace file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ], 'danger_full_access');
  assert(capabilitySpec);
  assert.equal(capabilitySpec.name, 'joi_capabilities');
  const capabilityConfigPath = capabilitySpec.args.at(-1);
  const capabilityConfigInfo = await stat(capabilityConfigPath);
  assert.equal(capabilityConfigInfo.mode & 0o077, 0);
  const capabilityConfig = JSON.parse(await readFile(capabilityConfigPath, 'utf8'));
  assert.equal(capabilityConfig.server_name, 'joi_capabilities');
  assert.deepEqual(capabilityConfig.tools.map((tool) => tool.name), ['file_read', 'workspace_search']);
  assert.deepEqual([...resolveACPBridgeGrant(capabilityConfig.token).capabilities].sort(), ['file_read', 'workspace_search']);
  assert.equal(resolveACPBridgeGrant(capabilityConfig.token).permission_profile, 'danger_full_access');

  const capabilityChild = spawn(capabilitySpec.command, capabilitySpec.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  children.push(capabilityChild);
  const capabilityClient = mcpClient(capabilityChild);
  const capabilityInitialized = await capabilityClient.call('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'joi-capability-test', version: '1' },
  });
  assert.equal(capabilityInitialized.protocolVersion, '2025-03-26');
  capabilityClient.notify('notifications/initialized');
  const capabilityInventory = await capabilityClient.call('tools/list');
  assert.deepEqual(capabilityInventory.tools.map((tool) => tool.name), ['file_read', 'workspace_search']);
  const searched = await capabilityClient.call('tools/call', { name: 'workspace_search', arguments: { query: 'bridge scope' } });
  assert.equal(searched.isError, false);
  assert.equal(executed.at(-1)?.capability, 'workspace_search');
  assert.equal(executed.at(-1)?.permission_profile, 'danger_full_access');

  const readOnlyCapabilitySpec = createACPCapabilityMCPServer(tempDir, [
    {
      name: 'workspace_search',
      description: 'Search an authorized workspace.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ], 'read_only');
  assert(readOnlyCapabilitySpec);
  const readOnlyCapabilityConfig = JSON.parse(await readFile(readOnlyCapabilitySpec.args.at(-1), 'utf8'));
  assert.notEqual(readOnlyCapabilityConfig.token, capabilityConfig.token);
  assert.equal(resolveACPBridgeGrant(readOnlyCapabilityConfig.token).permission_profile, 'read_only');

  const fullAgentSpec = createACPCapabilityMCPServer(
    tempDir,
    compileElectronCapabilityTools('danger_full_access', { allowed_capabilities: ['*'] }),
    'danger_full_access',
  );
  assert(fullAgentSpec);
  const fullAgentChild = spawn(fullAgentSpec.command, fullAgentSpec.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  children.push(fullAgentChild);
  const fullAgentClient = mcpClient(fullAgentChild);
  await fullAgentClient.call('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'joi-full-agent-test', version: '1' },
  });
  fullAgentClient.notify('notifications/initialized');
  const fullAgentInventory = await fullAgentClient.call('tools/list');
  assert.equal(fullAgentInventory.tools.length, 89);
  for (const capability of ['tool_search', 'shell_start', 'browser_tabs', 'browser_console', 'browser_network']) {
    assert(fullAgentInventory.tools.some((tool) => tool.name === capability), `full MCP inventory is missing ${capability}`);
  }

  const outOfGrant = await dispatchJoiCommand(
    { action: 'acp_web', token: capabilityConfig.token, capability: 'shell_command', payload: { cmd: ['id'] } },
    { handlers: {}, acpWeb },
  );
  assert.equal(outOfGrant.ok, false);
  assert.equal(outOfGrant.error?.code, 'ACP_WEB_CAPABILITY_DENIED');
} finally {
  for (const child of children) child.kill('SIGTERM');
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
