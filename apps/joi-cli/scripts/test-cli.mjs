import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { desktopBindingMethods as desktopIpcMethods } from '../../../packages/shared-types/src/desktop-api.ts';
import {
  cliAuxiliaryOperations,
  publishJoiRunEvent,
  publishJoiTerminalEvent,
  startJoiCommandHost,
  stopJoiCommandHost,
} from '../../joi-electron/src/main/command-host.ts';

const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'apps/joi-cli/src/joi.mjs');
const temp = await mkdtemp(join(tmpdir(), 'joi-cli-test-'));
const socketPath = join(temp, 'joi.sock');
const invocations = [];
const handlers = Object.fromEntries(desktopIpcMethods.map((method) => [method, async (payload) => {
  invocations.push({ method, payload });
  if (method === 'GetSystemHealth') return { sqlite: true, runtime: 'cli_test' };
  if (method === 'ListCapabilities') return { capabilities: [{ id: 'test-capability' }] };
  return { method, payload };
}]));
const terminalCalls = [];
const runEventHistory = [];
let terminalInfo = { id: 'term_test', shell: '/bin/zsh', cwd: temp, status: 'running', cols: 80, rows: 24 };
const terminalAdapter = {
  start(req = {}) {
    terminalInfo = { ...terminalInfo, ...req, id: req.id || terminalInfo.id, status: 'running' };
    terminalCalls.push(['start', req]);
    return terminalInfo;
  },
  input(req) { terminalCalls.push(['input', req]); },
  resize(req) {
    terminalInfo = { ...terminalInfo, cols: req.cols, rows: req.rows };
    terminalCalls.push(['resize', req]);
  },
  kill(req) {
    terminalInfo = { ...terminalInfo, status: 'exited' };
    terminalCalls.push(['kill', req]);
  },
  getStatus() { return { session: terminalInfo, output: 'snapshot-output' }; },
};

await startJoiCommandHost({
  socketPath,
  handlers,
  riskForMethod: (method) => method.startsWith('Delete') ? 'state_change' : 'read_only',
  terminal: terminalAdapter,
  replayRunEvents: (runID, afterSeq) => runEventHistory.filter((event) => event.run_id === runID && event.seq > afterSeq),
  logger: { info() {}, warn() {}, error() {} },
});

try {
  const commands = await runCLI(['commands', '--compact', '--no-start']);
  assert.equal(commands.code, 0, commands.stderr);
  const described = JSON.parse(commands.stdout);
  assert.equal(described.ok, true);
  assert.equal(described.data.methods.length, desktopIpcMethods.length);
  assert.deepEqual(described.data.methods.map((item) => item.name).sort(), [...desktopIpcMethods].sort());
  assert.equal(described.data.auxiliary.length, cliAuxiliaryOperations.length);

  const health = await runCLI(['health', '--compact', '--no-start']);
  assert.deepEqual(JSON.parse(health.stdout).data, { sqlite: true, runtime: 'cli_test' });

  const capabilities = await runCLI(['call', 'list-capabilities', '--compact', '--no-start']);
  assert.equal(JSON.parse(capabilities.stdout).data.capabilities[0].id, 'test-capability');

  const pluginInstall = await runCLI(['plugins', 'install', 'https://github.com/poer2023/joi-codex-acp-plugin', '--compact', '--no-start']);
  assert.equal(pluginInstall.code, 0, pluginInstall.stderr);
  assert.deepEqual(JSON.parse(pluginInstall.stdout).data.payload, {
    source: 'https://github.com/poer2023/joi-codex-acp-plugin',
  });

  const blocked = await runCLI(['invoke', 'DeleteMemory', '--json', '{"id":"mem_test"}', '--compact', '--no-start']);
  assert.equal(blocked.code, 3);
  assert.equal(JSON.parse(blocked.stdout).error.code, 'CONFIRMATION_REQUIRED');

  const allowed = await runCLI(['invoke', 'DeleteMemory', '--set', 'id=mem_test', '--yes', '--compact', '--no-start']);
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout).data.payload, { id: 'mem_test' });

  const chat = await runCLI(['chat', 'CLI test message', '--set', 'conversation_id=conv_test', '--compact', '--no-start']);
  assert.equal(chat.code, 0, chat.stderr);
  const chatPayload = JSON.parse(chat.stdout).data.payload;
  assert.equal(chatPayload.message, 'CLI test message');
  assert.equal(chatPayload.conversation_id, 'conv_test');
  assert.equal(chatPayload.channel, 'cli');

  const terminalExec = await runCLI(['terminal', 'exec', process.execPath, '-e', 'process.stdout.write("CLI_TERMINAL_OK")', '--compact']);
  assert.equal(terminalExec.code, 0, terminalExec.stderr);
  assert.equal(JSON.parse(terminalExec.stdout).data.stdout, 'CLI_TERMINAL_OK');

  const terminalStart = await runCLI(['terminal', 'start', '--set', 'id=term_test', '--compact', '--no-start']);
  assert.equal(JSON.parse(terminalStart.stdout).data.status, 'running');
  await runCLI(['terminal', 'input', 'term_test', 'printf PTY_OK\\n', '--compact', '--no-start']);
  await runCLI(['terminal', 'resize', 'term_test', '--set', 'cols=100', '--set', 'rows=30', '--compact', '--no-start']);
  const terminalStatus = await runCLI(['terminal', 'status', 'term_test', '--compact', '--no-start']);
  assert.equal(JSON.parse(terminalStatus.stdout).data.session.cols, 100);

  const runFollow = runCLI(['run', 'run_stream_test', '--follow', '--timeout', '3', '--no-start']);
  setTimeout(() => {
    const started = { id: 'evt_1', run_id: 'run_stream_test', seq: 1, type: 'run.started', status: 'running' };
    const completed = { id: 'evt_2', run_id: 'run_stream_test', seq: 2, type: 'run.completed', status: 'succeeded', terminal: true };
    runEventHistory.push(started, completed);
    publishJoiRunEvent(started);
    publishJoiRunEvent(completed);
  }, 120);
  const runStream = await runFollow;
  assert.equal(runStream.code, 0, runStream.stderr);
  const runEvents = runStream.stdout.split('\n').map((line) => JSON.parse(line));
  assert(runEvents.some((event) => event.type === 'run.started' && event.created_at));
  assert(runEvents.some((event) => event.type === 'run.completed' && event.seq === 2));

  terminalInfo = { ...terminalInfo, status: 'running' };
  const terminalAttach = runCLI(['terminal', 'attach', 'term_test', '--timeout', '3', '--no-start']);
  setTimeout(() => {
    publishJoiTerminalEvent({ id: 'term_test', type: 'output', data: 'PTY_STREAM_OK' });
    publishJoiTerminalEvent({ id: 'term_test', type: 'exit', session: { ...terminalInfo, status: 'exited', exit_code: 0 } });
  }, 120);
  const terminalStream = await terminalAttach;
  assert.equal(terminalStream.code, 0, terminalStream.stderr);
  const terminalEvents = terminalStream.stdout.split('\n').map((line) => JSON.parse(line));
  assert(terminalEvents.some((event) => event.type === 'terminal.output' && event.stdout === 'PTY_STREAM_OK'));
  assert(terminalEvents.some((event) => event.type === 'terminal.exit' && event.terminal === true));

  const terminalKill = await runCLI(['terminal', 'kill', 'term_test', '--compact', '--no-start']);
  assert.equal(terminalKill.code, 0, terminalKill.stderr);
  assert(terminalCalls.some(([type]) => type === 'input'));
  assert(terminalCalls.some(([type]) => type === 'resize'));
  assert(terminalCalls.some(([type]) => type === 'kill'));

  assert(invocations.some((item) => item.method === 'DeleteMemory'));
  assert(invocations.some((item) => item.method === 'SendChat'));
  console.log(`Joi CLI contract passed: ${desktopIpcMethods.length + cliAuxiliaryOperations.length} interface operations covered (${desktopIpcMethods.length} business + ${cliAuxiliaryOperations.length} auxiliary)`);
} finally {
  await stopJoiCommandHost(socketPath);
  await rm(temp, { recursive: true, force: true });
}

function runCLI(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, JOI_CLI_SOCKET: socketPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', rejectRun);
    child.on('exit', (code) => resolveRun({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
