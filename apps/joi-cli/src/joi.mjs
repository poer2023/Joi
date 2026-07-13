#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLI_VERSION = '0.1.1';
const DEFAULT_TIMEOUT_MS = 300_000;

await main(process.argv.slice(2));

async function main(argv) {
  const parsed = parseArgs(argv);
  const [command = 'help', ...positionals] = parsed.positionals;

  if (parsed.flags.help || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'version' || parsed.flags.version) {
    process.stdout.write(`joi ${CLI_VERSION}\n`);
    return;
  }
  if (command === 'gui') {
    const result = spawnSync('/usr/bin/open', ['-a', appBundlePath()], { stdio: 'inherit' });
    process.exitCode = result.status || 0;
    return;
  }
  if (command === 'open') {
    const target = positionals.join(' ').trim();
    if (!target) throwUsage('open requires a URL or path');
    const result = spawnSync('/usr/bin/open', [target], { stdio: 'inherit' });
    process.exitCode = result.status || 0;
    return;
  }
  if (command === 'terminal') {
    const action = positionals.shift() || 'start';
    if (action === 'exec') {
      if (positionals.length === 0) throwUsage('terminal exec requires a command');
      const response = await runTerminalCommand(positionals, parsed.flags.timeoutMs);
      emit(response, parsed);
      setExitCode(response);
      return;
    }
    await runPersistentTerminalAction(action, positionals, parsed);
    return;
  }
  if (command === 'watch') {
    const topic = positionals.shift() || 'runs';
    if (topic === 'runs' || topic === 'run') {
      const runID = positionals.shift();
      await streamSubscription({ topic: 'run_events', run_id: runID, after_seq: parsed.flags.afterSeq }, parsed);
      return;
    }
    if (topic === 'terminal') {
      const terminalID = positionals.shift();
      await streamSubscription({ topic: 'terminal_events', terminal_id: terminalID, after_seq: parsed.flags.afterSeq }, parsed);
      return;
    }
    throwUsage(`Unsupported watch topic: ${topic}`);
  }
  if (command === 'run' && parsed.flags.follow) {
    const runID = positionals.shift();
    if (!runID) throwUsage('run --follow requires a run id');
    await streamSubscription({ topic: 'run_events', run_id: runID, after_seq: parsed.flags.afterSeq }, parsed);
    return;
  }

  if (command === 'status') {
    const response = await requestOrOffline({ action: 'ping', request_id: newTraceID() }, parsed, false);
    emit(response, parsed);
    setExitCode(response);
    return;
  }
  if (command === 'daemon') {
    if ((positionals[0] || 'status') === 'start') {
      const response = await requestOrOffline({ action: 'ping', request_id: newTraceID() }, parsed, true);
      emit(response, parsed);
      setExitCode(response);
      return;
    }
    const response = await requestOrOffline({ action: 'ping', request_id: newTraceID() }, parsed, false);
    emit(response, parsed);
    setExitCode(response);
    return;
  }
  if (command === 'commands') {
    const response = await requestOrOffline({ action: 'describe', request_id: newTraceID() }, parsed, true);
    emit(response, parsed);
    setExitCode(response);
    return;
  }

  const invocation = await resolveInvocation(command, positionals, parsed);
  const response = await requestOrOffline({
    action: 'invoke',
    request_id: newTraceID(),
    method: invocation.method,
    payload: invocation.payload,
    confirm: parsed.flags.yes,
  }, parsed, !parsed.flags.noStart);
  emit(response, parsed);
  setExitCode(response);
}

async function resolveInvocation(command, positionals, parsed) {
  if (command === 'invoke' || command === 'call') {
    const requested = positionals.shift();
    if (!requested) throwUsage(`${command} requires a DesktopBinding method or kebab-case command`);
    const method = command === 'invoke' && /^[A-Z]/.test(requested)
      ? requested
      : await resolveMethodName(requested, parsed);
    return { method, payload: await payloadForInvocation(parsed, positionals) };
  }

  if (command === 'chat') {
    if (positionals[0] === 'send') positionals.shift();
    const message = positionals.join(' ').trim();
    if (!message && !hasStructuredPayload(parsed)) throwUsage('chat requires a message or structured payload');
    const overrides = await structuredPayload(parsed);
    return {
      method: 'SendChat',
      payload: {
        channel: 'cli',
        user_id: 'cli_user',
        runtime_mode: 'tool_calling',
        permission_profile: 'read_only',
        message,
        ...(isRecord(overrides) ? overrides : {}),
      },
    };
  }

  const alias = aliasInvocation(command, positionals);
  if (alias) {
    const overrides = await structuredPayload(parsed);
    return {
      method: alias.method,
      payload: mergeAliasPayload(alias.payload, overrides),
    };
  }

  const method = await resolveMethodName(command, parsed);
  return { method, payload: await payloadForInvocation(parsed, positionals) };
}

function aliasInvocation(command, positionals) {
  switch (command) {
    case 'health': return { method: 'GetSystemHealth' };
    case 'settings': return { method: 'GetSettings' };
    case 'capabilities': return { method: 'ListCapabilities' };
    case 'skills': return { method: 'ListSkills' };
    case 'mcp': return { method: 'ListMCPServers' };
    case 'models': return { method: 'ListSavedModels', payload: {} };
    case 'automations': return { method: 'ListAutomations', payload: {} };
    case 'conversations': return { method: 'ListConversations', payload: {} };
    case 'memory': return { method: 'ListMemories', payload: {} };
    case 'tasks': return { method: 'ListProductTasks', payload: {} };
    case 'artifacts': return { method: 'ListArtifacts', payload: {} };
    case 'nodes': return { method: 'ListNodes' };
    case 'approvals': return { method: 'ListPendingApprovals' };
    case 'logs': return { method: 'ListLogs', payload: {} };
    case 'backups': return { method: 'ListBackups' };
    case 'diagnostics': return { method: 'ExportDiagnostics' };
    case 'run': {
      const id = positionals.shift();
      if (!id) throwUsage('run requires a run id');
      return { method: 'GetRunTrace', payload: id };
    }
    case 'plugins': {
      const action = positionals.shift() || 'list';
      if (action === 'list') return { method: 'ListPlugins' };
      if (action === 'install') {
        const source = positionals.shift();
        if (!source) throwUsage('plugins install requires a GitHub URL');
        return { method: 'InstallPluginFromGitHub', payload: { source } };
      }
      if (action === 'remove') {
        const id = positionals.shift();
        if (!id) throwUsage('plugins remove requires an id');
        return { method: 'RemovePlugin', payload: id };
      }
      if (action === 'test') {
        const plugin_id = positionals.shift();
        if (!plugin_id) throwUsage('plugins test requires an id');
        return { method: 'TestPluginProvider', payload: { plugin_id } };
      }
      throwUsage(`Unsupported plugins action: ${action}`);
    }
    default: return null;
  }
}

async function resolveMethodName(value, parsed) {
  if (/^[A-Z][A-Za-z0-9]+$/.test(value)) return value;
  const response = await requestOrOffline({ action: 'describe', request_id: newTraceID() }, parsed, !parsed.flags.noStart);
  if (!response.ok) {
    emit(response, parsed);
    setExitCode(response);
    process.exit();
  }
  const match = response.data?.methods?.find((item) => item.command === value || item.name === value);
  if (!match) throwUsage(`Unknown Joi command: ${value}`);
  return match.name;
}

async function payloadForInvocation(parsed, positionals) {
  const structured = await structuredPayload(parsed);
  if (structured !== undefined) return structured;
  if (positionals.length === 0) return undefined;
  if (positionals.length === 1) return parseScalar(positionals[0]);
  throwUsage('Multiple payload arguments are ambiguous; use --json, --input, --stdin, or --set');
}

async function structuredPayload(parsed) {
  if (parsed.flags.json !== undefined) return parseJson(parsed.flags.json, '--json');
  if (parsed.flags.input) return parseJson(await readFile(parsed.flags.input, 'utf8'), parsed.flags.input);
  if (parsed.flags.stdin) return parseJson(await readStdin(), 'stdin');
  if (parsed.flags.set.length > 0) {
    const result = {};
    for (const item of parsed.flags.set) {
      const separator = item.indexOf('=');
      if (separator <= 0) throwUsage(`Invalid --set value: ${item}`);
      setNestedValue(result, item.slice(0, separator), parseScalar(item.slice(separator + 1)));
    }
    return result;
  }
  return undefined;
}

function hasStructuredPayload(parsed) {
  return parsed.flags.json !== undefined || parsed.flags.input || parsed.flags.stdin || parsed.flags.set.length > 0;
}

function mergeAliasPayload(base, overrides) {
  if (overrides === undefined) return base;
  if (isRecord(base) && isRecord(overrides)) return { ...base, ...overrides };
  return overrides;
}

async function requestOrOffline(request, parsed, autoStart) {
  try {
    return await requestSocket(request, parsed.flags.timeoutMs);
  } catch (firstError) {
    if (!autoStart) return offlineEnvelope(firstError);
    try {
      await startRuntime(parsed.flags.timeoutMs);
      return await requestSocket(request, parsed.flags.timeoutMs);
    } catch (error) {
      return offlineEnvelope(error);
    }
  }
}

function requestSocket(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath());
    let body = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Joi CLI request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(JSON.stringify(request)));
    socket.on('data', (chunk) => { body += String(chunk); });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (!body.trim()) {
        reject(new Error('Joi CLI command host returned no data'));
        return;
      }
      try {
        resolve(JSON.parse(body.trim()));
      } catch (error) {
        reject(new Error(`Invalid Joi CLI response: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function runPersistentTerminalAction(action, positionals, parsed) {
  let request;
  if (action === 'start') {
    request = { action: 'terminal_start', payload: await structuredPayload(parsed) };
  } else if (action === 'input') {
    const id = positionals.shift();
    if (!id || positionals.length === 0) throwUsage('terminal input requires an id and data');
    request = { action: 'terminal_input', payload: { id, data: positionals.join(' ') } };
  } else if (action === 'resize') {
    const id = positionals.shift();
    if (!id) throwUsage('terminal resize requires an id');
    const payload = await structuredPayload(parsed);
    request = { action: 'terminal_resize', payload: { id, ...(isRecord(payload) ? payload : {}) } };
  } else if (action === 'kill') {
    const id = positionals.shift();
    if (!id) throwUsage('terminal kill requires an id');
    request = { action: 'terminal_kill', payload: { id } };
  } else if (action === 'status') {
    const id = positionals.shift();
    if (!id) throwUsage('terminal status requires an id');
    request = { action: 'terminal_status', terminal_id: id };
  } else if (action === 'attach') {
    const id = positionals.shift();
    if (!id) throwUsage('terminal attach requires an id');
    await streamSubscription({ topic: 'terminal_events', terminal_id: id, after_seq: parsed.flags.afterSeq }, parsed);
    return;
  } else {
    throwUsage(`Unsupported terminal action: ${action}`);
  }
  const response = await requestOrOffline({ ...request, request_id: newTraceID() }, parsed, !parsed.flags.noStart);
  emit(response, parsed);
  setExitCode(response);
}

async function streamSubscription(subscription, parsed) {
  const readiness = await requestOrOffline({ action: 'ping', request_id: newTraceID() }, parsed, !parsed.flags.noStart);
  if (!readiness.ok) {
    emit(readiness, parsed);
    setExitCode(readiness);
    return;
  }
  return new Promise((resolveStream) => {
    const traceID = newTraceID();
    const socket = connect(socketPath());
    let buffer = '';
    let settled = false;
    let timer;
    const finish = (code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onInterrupt);
      if (!socket.destroyed) socket.destroy();
      if (code !== 0) process.exitCode = code;
      resolveStream();
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        writeStreamEvent({
          id: `${traceID}:timeout`,
          run_id: subscription.run_id || subscription.terminal_id || traceID,
          seq: 0,
          type: 'subscription.timed_out',
          status: 'failed',
          created_at: new Date().toISOString(),
          stderr: `No stream event received for ${parsed.flags.timeoutMs}ms`,
          terminal: true,
        });
        finish(1);
      }, parsed.flags.timeoutMs);
    };
    const onInterrupt = () => finish(130);
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onInterrupt);
    resetTimer();
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(JSON.stringify({
      action: 'subscribe',
      request_id: traceID,
      ...subscription,
    })));
    socket.on('data', (chunk) => {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        resetTimer();
        let envelope;
        try {
          envelope = JSON.parse(line);
        } catch (error) {
          writeStreamEvent({
            id: `${traceID}:invalid-json`,
            run_id: subscription.run_id || subscription.terminal_id || traceID,
            seq: 0,
            type: 'subscription.failed',
            status: 'failed',
            created_at: new Date().toISOString(),
            stderr: error instanceof Error ? error.message : String(error),
            terminal: true,
          });
          finish(1);
          return;
        }
        if (!envelope.ok) {
          writeStreamEvent({
            id: `${traceID}:failed`,
            run_id: subscription.run_id || subscription.terminal_id || traceID,
            seq: 0,
            type: 'subscription.failed',
            status: 'failed',
            created_at: new Date().toISOString(),
            stderr: envelope.error?.message || 'subscription failed',
            terminal: true,
          });
          finish(1);
          return;
        }
        const data = envelope.data || {};
        if (data.subscription === 'event' && data.event) {
          writeStreamEvent(data.event);
        } else if (data.subscription === 'snapshot') {
          writeStreamEvent({
            id: `${traceID}:snapshot`,
            run_id: subscription.terminal_id || traceID,
            terminal_id: subscription.terminal_id,
            seq: 0,
            type: 'terminal.snapshot',
            status: data.snapshot?.session?.status || 'unknown',
            created_at: new Date().toISOString(),
            payload: data.snapshot,
            terminal: ['exited', 'failed'].includes(data.snapshot?.session?.status),
          });
        } else if (data.subscription === 'started') {
          writeStreamEvent({
            id: `${traceID}:started`,
            run_id: subscription.run_id || subscription.terminal_id || traceID,
            terminal_id: subscription.terminal_id,
            seq: Number(subscription.after_seq || 0),
            type: 'subscription.started',
            status: 'running',
            created_at: new Date().toISOString(),
            payload: data,
          });
        }
      }
    });
    socket.on('error', (error) => {
      writeStreamEvent({
        id: `${traceID}:socket-error`,
        run_id: subscription.run_id || subscription.terminal_id || traceID,
        seq: 0,
        type: 'subscription.failed',
        status: 'failed',
        created_at: new Date().toISOString(),
        stderr: error.message,
        terminal: true,
      });
      finish(1);
    });
    socket.on('close', () => finish(process.exitCode || 0));
  });
}

function writeStreamEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function runTerminalCommand(argv, timeoutMs) {
  return new Promise((resolveRun) => {
    const traceID = newTraceID();
    const startedAt = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const appendBounded = (current, chunk) => `${current}${String(chunk)}`.slice(-10 * 1024 * 1024);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveRun({
        ok: false,
        data: null,
        error: { code: 'TERMINAL_START_FAILED', message: error.message, details: { command: argv[0] } },
        trace_id: traceID,
      });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolveRun({
          ok: false,
          data: null,
          error: { code: 'TERMINAL_TIMEOUT', message: `Command timed out after ${timeoutMs}ms`, details: { command: argv[0] } },
          trace_id: traceID,
        });
        return;
      }
      resolveRun({
        ok: code === 0,
        data: {
          command: argv,
          cwd: process.cwd(),
          stdout,
          stderr,
          exit_code: code,
          signal,
          duration_ms: Date.now() - startedAt,
        },
        error: code === 0 ? null : { code: 'TERMINAL_EXIT_NONZERO', message: `Command exited with code ${code ?? 'unknown'}`, details: { signal } },
        trace_id: traceID,
      });
    });
  });
}

async function startRuntime(timeoutMs) {
  const binary = appBinaryPath();
  const env = { ...process.env, JOI_CLI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, ['--joi-cli-headless'], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  const deadline = Date.now() + Math.min(timeoutMs, 20_000);
  let lastError;
  while (Date.now() < deadline) {
    await sleep(160);
    try {
      const response = await requestSocket({ action: 'ping', request_id: newTraceID() }, 1_000);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Joi runtime did not become ready: ${lastError instanceof Error ? lastError.message : 'socket unavailable'}`);
}

function parseArgs(argv) {
  const flags = {
    help: false,
    version: false,
    yes: false,
    noStart: false,
    compact: false,
    raw: false,
    stdin: false,
    follow: false,
    afterSeq: 0,
    json: undefined,
    input: '',
    set: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (value === '--help' || value === '-h') flags.help = true;
    else if (value === '--version' || value === '-V') flags.version = true;
    else if (value === '--yes' || value === '-y') flags.yes = true;
    else if (value === '--no-start') flags.noStart = true;
    else if (value === '--compact') flags.compact = true;
    else if (value === '--raw') flags.raw = true;
    else if (value === '--stdin') flags.stdin = true;
    else if (value === '--follow' || value === '-f') flags.follow = true;
    else if (value === '--json') flags.json = requireFlagValue(argv, ++index, value);
    else if (value === '--input') flags.input = requireFlagValue(argv, ++index, value);
    else if (value === '--set') flags.set.push(requireFlagValue(argv, ++index, value));
    else if (value === '--timeout') flags.timeoutMs = Math.max(1, Number(requireFlagValue(argv, ++index, value))) * 1_000;
    else if (value === '--after-seq') flags.afterSeq = Math.max(0, Number(requireFlagValue(argv, ++index, value)));
    else if (value.startsWith('--json=')) flags.json = value.slice(7);
    else if (value.startsWith('--input=')) flags.input = value.slice(8);
    else if (value.startsWith('--set=')) flags.set.push(value.slice(6));
    else if (value.startsWith('--timeout=')) flags.timeoutMs = Math.max(1, Number(value.slice(10))) * 1_000;
    else if (value.startsWith('--after-seq=')) flags.afterSeq = Math.max(0, Number(value.slice(12)));
    else positionals.push(value);
  }
  if (!Number.isFinite(flags.timeoutMs)) throwUsage('--timeout must be a number of seconds');
  if (!Number.isFinite(flags.afterSeq)) throwUsage('--after-seq must be a number');
  return { flags, positionals };
}

function requireFlagValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined) throwUsage(`${flag} requires a value`);
  return value;
}

function parseJson(value, source) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throwUsage(`Invalid JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseScalar(value) {
  const trimmed = String(value).trim();
  if (trimmed === '') return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function setNestedValue(target, dottedKey, value) {
  const parts = dottedKey.split('.').filter(Boolean);
  if (parts.length === 0) throwUsage(`Invalid --set key: ${dottedKey}`);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function emit(response, parsed) {
  if (parsed.flags.raw && response.ok) {
    if (typeof response.data === 'string') process.stdout.write(`${response.data}\n`);
    else process.stdout.write(`${JSON.stringify(response.data, null, parsed.flags.compact ? 0 : 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(response, null, parsed.flags.compact ? 0 : 2)}\n`);
}

function setExitCode(response) {
  if (response.ok) return;
  process.exitCode = response.error?.code === 'CONFIRMATION_REQUIRED' ? 3 : response.error?.code === 'RUNTIME_OFFLINE' ? 4 : 1;
}

function offlineEnvelope(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: 'RUNTIME_OFFLINE',
      message: error instanceof Error ? error.message : String(error),
      details: { socket: socketPath(), app_binary: appBinaryPath() },
    },
    trace_id: newTraceID(),
  };
}

function appBundlePath() {
  return String(process.env.JOI_APP_BUNDLE || '/Applications/Joi.app');
}

function appBinaryPath() {
  return String(process.env.JOI_APP_BINARY || `${appBundlePath()}/Contents/MacOS/Joi`);
}

function socketPath() {
  const userData = String(process.env.JOI_USER_DATA_DIR || process.env.JOI_DESKTOP_USER_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Joi'));
  return String(process.env.JOI_CLI_SOCKET || join(userData, 'joi-cli.sock'));
}

function newTraceID() {
  return `cli_${randomUUID().replaceAll('-', '')}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { body += String(chunk); });
    process.stdin.on('end', () => resolve(body));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwUsage(message) {
  process.stderr.write(`${message}\nRun joi help for usage.\n`);
  process.exit(2);
}

function printHelp() {
  process.stdout.write(`Joi CLI ${CLI_VERSION}\n\n`);
  process.stdout.write('Usage:\n');
  process.stdout.write('  joi health\n');
  process.stdout.write('  joi chat <message> [--set permission_profile=read_only]\n');
  process.stdout.write('  joi commands\n');
  process.stdout.write('  joi invoke <DesktopBinding> [payload options]\n');
  process.stdout.write('  joi call <kebab-command> [payload options]\n');
  process.stdout.write('  joi plugins list|install <github-url>|test <id>|remove <id> --yes\n');
  process.stdout.write('  joi settings|models|capabilities|skills|mcp|automations|conversations\n');
  process.stdout.write('  joi memory|tasks|artifacts|nodes|approvals|logs|backups|diagnostics\n');
  process.stdout.write('  joi run <run-id>\n');
  process.stdout.write('  joi run <run-id> --follow [--after-seq N]\n');
  process.stdout.write('  joi watch runs [run-id] | joi watch terminal [terminal-id]\n');
  process.stdout.write('  joi daemon start|status\n');
  process.stdout.write('  joi terminal exec <command> [args...]\n');
  process.stdout.write('  joi terminal start|input|resize|kill|status|attach\n');
  process.stdout.write('  joi open <url-or-path>\n');
  process.stdout.write('  joi gui\n\n');
  process.stdout.write('Payload options:\n');
  process.stdout.write('  --json <json>      JSON payload\n');
  process.stdout.write('  --input <path>     Read JSON payload from file\n');
  process.stdout.write('  --stdin            Read JSON payload from stdin\n');
  process.stdout.write('  --set key=value    Build an object payload; repeatable, dotted keys supported\n');
  process.stdout.write('  --yes              Confirm destructive or secret-changing commands\n');
  process.stdout.write('  --raw              Print data only\n');
  process.stdout.write('  --compact          Compact JSON\n');
  process.stdout.write('  --timeout <sec>    Request timeout, default 300\n');
  process.stdout.write('  --no-start         Do not auto-start the hidden Joi runtime\n');
}
