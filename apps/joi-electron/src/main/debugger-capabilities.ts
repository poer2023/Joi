import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { IPty } from 'node-pty';
import type { WorkspaceSettings } from '../../../../packages/shared-types/src/desktop-api';
import { resolveWorkspacePath } from '../../../../packages/runtime/src/capabilities.ts';

type DebuggerSession = {
  id: string;
  target: string;
  cwd: string;
  pty: IPty;
  output: string;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'exited' | 'failed';
  pid: number;
  started_at: string;
};

const require = createRequire(import.meta.url);
const maxOutputChars = 160_000;

export class NativeDebuggerManager {
  private readonly sessions = new Map<string, DebuggerSession>();

  async execute(
    capability: 'debugger_attach' | 'debugger_breakpoint' | 'debugger_step' | 'debugger_evaluate' | 'debugger_threads' | 'debugger_stack' | 'debugger_locals' | 'debugger_watchpoint' | 'debugger_memory' | 'debugger_stop',
    inputs: Record<string, unknown>,
    settings: WorkspaceSettings,
    permissionProfile: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (permissionProfile !== 'danger_full_access') throw new Error(`${capability} requires danger_full_access`);
    switch (capability) {
      case 'debugger_attach':
        return this.start(inputs, settings, signal);
      case 'debugger_breakpoint':
        return this.breakpoint(inputs, settings, signal);
      case 'debugger_step':
        return this.step(inputs, signal);
      case 'debugger_evaluate':
        return this.evaluate(inputs, signal);
      case 'debugger_threads':
        return this.inspect(this.requiredSession(inputs.session_id), 'debugger_threads', 'thread list', signal);
      case 'debugger_stack':
        return this.inspect(this.requiredSession(inputs.session_id), 'debugger_stack', inputs.all_threads === true ? 'thread backtrace all' : 'thread backtrace', signal);
      case 'debugger_locals':
        return this.inspect(this.requiredSession(inputs.session_id), 'debugger_locals', 'frame variable', signal);
      case 'debugger_watchpoint':
        return this.watchpoint(inputs, signal);
      case 'debugger_memory':
        return this.memory(inputs, signal);
      case 'debugger_stop':
        return this.stop(inputs);
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      try { session.pty.kill(); } catch { /* already exited */ }
    }
    this.sessions.clear();
  }

  private async start(inputs: Record<string, unknown>, settings: WorkspaceSettings, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const targetInput = stringInput(inputs.target);
    if (!targetInput) throw new Error('debugger_attach target is required');
    const target = resolveWorkspacePath(targetInput, settings);
    if (!statSync(target).isFile()) throw new Error('debugger target must be a file');
    const cwd = stringInput(inputs.cwd) ? resolveWorkspacePath(stringInput(inputs.cwd), settings) : dirname(target);
    const args = Array.isArray(inputs.args)
      ? inputs.args.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 64)
      : [];
    if (args.some((item) => item.length > 2_000 || /[\0\r\n]/.test(item))) throw new Error('invalid debugger target argument');
    ensureNodePtySpawnHelperExecutable();
    const nodePty = require('node-pty') as typeof import('node-pty');
    const pty = nodePty.spawn('/usr/bin/lldb', ['--no-lldbinit', '--', target, ...args], {
      name: 'dumb', cols: 120, rows: 32, cwd,
      env: debuggerEnvironment(cwd),
    });
    const id = `debug_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const session: DebuggerSession = {
      id, target, cwd, pty, output: '', status: 'starting', pid: pty.pid, started_at: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    pty.onData((data) => { session.output = `${session.output}${data}`.slice(-maxOutputChars); });
    pty.onExit(() => { session.status = session.status === 'stopped' ? 'stopped' : 'exited'; });
    await this.waitForPrompt(session, 0, signal, 15_000);
    session.status = 'ready';
    return {
      status: 'completed', capability: 'debugger_attach', mode: 'native_lldb_pty_v1',
      session: sessionSummary(session),
      output: cleanDebuggerOutput(session.output).slice(-8_000),
      summary: `Native LLDB session ${id} is ready for ${target}.`,
    };
  }

  private async breakpoint(inputs: Record<string, unknown>, settings: WorkspaceSettings, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = this.requiredSession(inputs.session_id);
    const symbol = stringInput(inputs.symbol);
    const pathInput = stringInput(inputs.path);
    let command = '';
    if (symbol) {
      if (!/^[A-Za-z_~][A-Za-z0-9_:.<>~+-]{0,300}$/.test(symbol)) throw new Error('invalid debugger breakpoint symbol');
      command = `breakpoint set --name ${symbol}`;
    } else {
      if (!pathInput) throw new Error('debugger_breakpoint requires symbol or path');
      const path = resolveWorkspacePath(pathInput, settings);
      const line = boundedInteger(inputs.line, 1, 1, 10_000_000);
      command = `breakpoint set --file \"${escapeLLDBString(path)}\" --line ${line}`;
    }
    const output = await this.command(session, command, signal, 15_000);
    if (!/Breakpoint\s+\d+:/i.test(output)) throw new Error(`LLDB did not confirm the breakpoint: ${output.slice(-1_000)}`);
    return {
      status: 'completed', capability: 'debugger_breakpoint', mode: 'native_lldb_pty_v1',
      session_id: session.id, output, summary: `Set an LLDB breakpoint in session ${session.id}.`,
    };
  }

  private async step(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = this.requiredSession(inputs.session_id);
    const action = stringInput(inputs.action).toLowerCase();
    const commands: Record<string, string> = {
      run: 'run', continue: 'continue', next: 'next', step: 'step', finish: 'finish', kill: 'process kill',
    };
    const command = commands[action];
    if (!command) throw new Error(`unsupported debugger step action: ${action}`);
    session.status = 'running';
    const output = await this.command(session, command, signal, action === 'run' || action === 'continue' ? 60_000 : 30_000);
    session.status = 'ready';
    return {
      status: 'completed', capability: 'debugger_step', mode: 'native_lldb_pty_v1',
      session_id: session.id, action, output,
      process_state: debuggerProcessState(output),
      summary: `LLDB ${action} completed in session ${session.id}.`,
    };
  }

  private async evaluate(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = this.requiredSession(inputs.session_id);
    const expression = stringInput(inputs.expression);
    if (!expression) throw new Error('debugger_evaluate expression is required');
    if (expression.length > 2_000 || /[\0\r\n]/.test(expression)) throw new Error('invalid debugger expression');
    const output = await this.command(session, `expression -- ${expression}`, signal, 20_000);
    return {
      status: 'completed', capability: 'debugger_evaluate', mode: 'native_lldb_pty_v1',
      session_id: session.id, expression, output,
      summary: `Evaluated a native expression in LLDB session ${session.id}.`,
    };
  }

  private async inspect(session: DebuggerSession, capability: string, command: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const output = await this.command(session, command, signal, 20_000);
    return {
      status: 'completed', capability, mode: 'native_lldb_pty_v2', session_id: session.id, output,
      summary: `Read ${capability.replace('debugger_', '')} from LLDB session ${session.id}.`,
    };
  }

  private async watchpoint(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = this.requiredSession(inputs.session_id);
    const variable = stringInput(inputs.variable);
    const expression = stringInput(inputs.expression);
    let command = '';
    if (variable) {
      if (!/^[A-Za-z_][A-Za-z0-9_.>\[\]-]{0,300}$/.test(variable)) throw new Error('invalid watchpoint variable');
      command = `watchpoint set variable ${variable}`;
    } else if (expression) {
      if (expression.length > 1_000 || /[\0\r\n]/.test(expression)) throw new Error('invalid watchpoint expression');
      command = `watchpoint set expression -- ${expression}`;
    } else {
      throw new Error('debugger_watchpoint requires variable or expression');
    }
    const output = await this.command(session, command, signal, 20_000);
    if (!/Watchpoint created|Watchpoint \d+/i.test(output)) throw new Error(`LLDB did not confirm the watchpoint: ${output.slice(-1_000)}`);
    return {
      status: 'completed', capability: 'debugger_watchpoint', mode: 'native_lldb_pty_v2',
      session_id: session.id, output, summary: `Set a watchpoint in LLDB session ${session.id}.`,
    };
  }

  private async memory(inputs: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = this.requiredSession(inputs.session_id);
    const address = stringInput(inputs.address);
    if (!/^(0x[0-9a-fA-F]+|[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z0-9_]+)$/.test(address)) throw new Error('debugger_memory address is invalid');
    const count = boundedInteger(inputs.count, 32, 1, 512);
    const format = stringInput(inputs.format) || 'x';
    if (!/^[A-Za-z]$/.test(format)) throw new Error('debugger_memory format is invalid');
    const output = await this.command(session, `memory read --count ${count} --format ${format} ${address}`, signal, 20_000);
    return {
      status: 'completed', capability: 'debugger_memory', mode: 'native_lldb_pty_v2',
      session_id: session.id, address, count, output, summary: `Read ${count} memory item(s) in LLDB session ${session.id}.`,
    };
  }

  private stop(inputs: Record<string, unknown>): Record<string, unknown> {
    const session = this.requiredSession(inputs.session_id);
    session.status = 'stopped';
    try { session.pty.write('process kill\rquit\r'); } catch { /* already exited */ }
    try { session.pty.kill(); } catch { /* already exited */ }
    this.sessions.delete(session.id);
    return {
      status: 'completed', capability: 'debugger_stop', mode: 'native_lldb_pty_v1',
      session_id: session.id, disposed: true, summary: `Disposed native LLDB session ${session.id}.`,
    };
  }

  private requiredSession(value: unknown): DebuggerSession {
    const id = stringInput(value);
    if (!id) throw new Error('debugger session_id is required');
    const session = this.sessions.get(id);
    if (!session) throw new Error(`debugger session not found: ${id}`);
    if (session.status === 'exited' || session.status === 'failed' || session.status === 'stopped') {
      throw new Error(`debugger session is not active: ${id}`);
    }
    return session;
  }

  private async command(session: DebuggerSession, command: string, signal?: AbortSignal, timeoutMS = 20_000): Promise<string> {
    const start = session.output.length;
    session.pty.write(`${command}\r`);
    await this.waitForPrompt(session, start, signal, timeoutMS);
    return cleanDebuggerOutput(session.output.slice(start)).trim().slice(-20_000);
  }

  private async waitForPrompt(session: DebuggerSession, start: number, signal?: AbortSignal, timeoutMS = 20_000): Promise<void> {
    const began = Date.now();
    while (Date.now() - began < timeoutMS) {
      if (signal?.aborted) {
        const error = new Error('debugger operation aborted');
        error.name = 'AbortError';
        throw error;
      }
      const output = cleanDebuggerOutput(session.output.slice(start));
      if (/\(lldb\)\s*$/.test(output)) return;
      if (session.status === 'exited' || session.status === 'failed') throw new Error('LLDB exited before returning a prompt');
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`LLDB prompt timed out: ${cleanDebuggerOutput(session.output.slice(start)).slice(-1_000)}`);
  }
}

function sessionSummary(session: DebuggerSession): Record<string, unknown> {
  return {
    id: session.id, target: session.target, cwd: session.cwd, status: session.status,
    pid: session.pid, started_at: session.started_at, backend: 'lldb',
  };
}

function debuggerProcessState(output: string): string {
  if (/stop reason\s*=/i.test(output)) return 'stopped';
  if (/exited with status/i.test(output)) return 'exited';
  if (/Process \d+ launched/i.test(output)) return 'launched';
  return 'ready';
}

function cleanDebuggerOutput(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[78]/g, '')
    .replace(/\r/g, '');
}

function escapeLLDBString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\"/g, '\\"').replace(/[\r\n\0]/g, '');
}

function debuggerEnvironment(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'dumb', NO_COLOR: '1', PWD: cwd };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function ensureNodePtySpawnHelperExecutable(): void {
  const resolved = require.resolve('node-pty');
  const packageRoot = resolve(dirname(resolved), '..');
  const helper = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  const candidates = [helper, helper.replace('app.asar', 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try { chmodSync(candidate, 0o755); } catch { /* best effort */ }
  }
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
