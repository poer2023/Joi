import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalSessionInputRequest,
  TerminalSessionKillRequest,
  TerminalSessionResizeRequest,
  TerminalSessionSnapshot,
  TerminalSessionStartRequest,
} from '../../../../packages/shared-types/src/desktop-api';
import type { IPty } from 'node-pty';

type NodePtyModule = typeof import('node-pty');

type TerminalRecord = {
  info: TerminalSessionInfo;
  output: string;
  pty?: IPty;
};

type TerminalLogSink = (event: TerminalSessionEvent) => void;
type TerminalEventListener = (event: TerminalSessionEvent) => void;

const require = createRequire(import.meta.url);
const MAX_BUFFER_CHARS = 80_000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalRecord>();
  private window: BrowserWindow | null = null;
  private nodePty: NodePtyModule | null = null;
  private logSink: TerminalLogSink | null = null;
  private readonly listeners = new Set<TerminalEventListener>();

  attachWindow(window: BrowserWindow) {
    this.window = window;
  }

  detachWindow(window: BrowserWindow) {
    if (this.window === window) {
      this.window = null;
    }
  }

  setLogSink(sink: TerminalLogSink | null) {
    this.logSink = sink;
  }

  onEvent(listener: TerminalEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(payload?: TerminalSessionStartRequest): TerminalSessionInfo {
    const id = normalizeID(payload?.id) || `term_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const existing = this.sessions.get(id);
    if (existing && (existing.info.status === 'starting' || existing.info.status === 'running')) {
      return existing.info;
    }

    const cols = normalizeDimension(payload?.cols, DEFAULT_COLS, 24, 240);
    const rows = normalizeDimension(payload?.rows, DEFAULT_ROWS, 8, 80);
    const shell = resolveShell(payload?.shell);
    const cwd = resolveCwd(payload?.cwd);
    const info: TerminalSessionInfo = {
      id,
      shell,
      cwd,
      status: 'starting',
      cols,
      rows,
      started_at: new Date().toISOString(),
    };
    const record: TerminalRecord = { info, output: '' };
    this.sessions.set(id, record);
    this.emit({ id, type: 'status', session: info });

    try {
      ensureNodePtySpawnHelperExecutable();
      const pty = this.loadNodePty().spawn(shell, shellArgs(shell), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: terminalEnv(shell, cwd),
      });
      record.pty = pty;
      record.info = {
        ...record.info,
        status: 'running',
        pid: pty.pid,
      };
      pty.onData((data) => {
        record.output = appendBuffer(record.output, data);
        this.emit({ id, type: 'output', data });
      });
      pty.onExit((event) => {
        record.info = {
          ...record.info,
          status: 'exited',
          exit_code: event.exitCode,
          signal: event.signal,
          exited_at: new Date().toISOString(),
        };
        record.pty = undefined;
        this.emit({ id, type: 'exit', session: record.info });
      });
      this.emit({ id, type: 'status', session: record.info });
      return record.info;
    } catch (error) {
      record.info = {
        ...record.info,
        status: 'failed',
        error: safeErrorMessage(error),
        exited_at: new Date().toISOString(),
      };
      this.emit({ id, type: 'error', error: record.info.error, session: record.info });
      return record.info;
    }
  }

  input(payload: TerminalSessionInputRequest) {
    const session = this.sessions.get(normalizeID(payload.id));
    if (!session?.pty || session.info.status !== 'running') return;
    if (typeof payload.data !== 'string' || payload.data.length === 0) return;
    session.pty.write(payload.data);
  }

  resize(payload: TerminalSessionResizeRequest) {
    const session = this.sessions.get(normalizeID(payload.id));
    if (!session?.pty || session.info.status !== 'running') return;
    const cols = normalizeDimension(payload.cols, session.info.cols || DEFAULT_COLS, 24, 240);
    const rows = normalizeDimension(payload.rows, session.info.rows || DEFAULT_ROWS, 8, 80);
    session.pty.resize(cols, rows);
    session.info = { ...session.info, cols, rows };
  }

  kill(payload: TerminalSessionKillRequest) {
    const session = this.sessions.get(normalizeID(payload.id));
    if (!session) return;
    if (session.pty && session.info.status === 'running') {
      session.pty.kill();
    }
    session.info = {
      ...session.info,
      status: session.info.status === 'running' ? 'exited' : session.info.status,
      exited_at: session.info.exited_at || new Date().toISOString(),
    };
    session.pty = undefined;
    this.emit({ id: session.info.id, type: 'exit', session: session.info });
  }

  getStatus(id: string): TerminalSessionSnapshot {
    const session = this.sessions.get(normalizeID(id));
    return {
      session: session?.info,
      output: session?.output || '',
    };
  }

  dispose() {
    for (const session of this.sessions.values()) {
      if (session.pty && session.info.status === 'running') {
        session.pty.kill();
      }
      session.pty = undefined;
    }
    this.sessions.clear();
    this.window = null;
  }

  private loadNodePty(): NodePtyModule {
    if (!this.nodePty) {
      this.nodePty = require('node-pty') as NodePtyModule;
    }
    return this.nodePty;
  }

  private emit(event: TerminalSessionEvent) {
    this.logSink?.(event);
    for (const listener of this.listeners) listener(event);
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('joi:terminal:event', event);
  }
}

function ensureNodePtySpawnHelperExecutable() {
  const resolved = require.resolve('node-pty');
  const packageRoot = resolve(dirname(resolved), '..');
  const helperRelative = join('prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  const candidates = [
    join(packageRoot, helperRelative),
    join(packageRoot.replace('app.asar', 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked'), helperRelative),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      chmodSync(candidate, 0o755);
    } catch {
      // Best effort: packaged app permissions may already be correct or immutable.
    }
  }
}

function terminalEnv(shell: string, cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHELL: shell,
    TERM: 'xterm-256color',
    COLORTERM: process.env.COLORTERM || 'truecolor',
    PWD: cwd,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function resolveShell(input?: string): string {
  const candidates = [
    input,
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const shell = resolve(candidate);
      if (statSync(shell).isFile()) return shell;
    } catch {
      // Try the next candidate.
    }
  }
  return '/bin/sh';
}

function shellArgs(shell: string): string[] {
  const name = basename(shell);
  if (name === 'zsh' || name === 'bash') {
    return ['-l'];
  }
  return [];
}

function resolveCwd(input?: string): string {
  const candidates = [
    input,
    process.env.HOME,
    process.cwd(),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const cwd = resolve(candidate);
      if (statSync(cwd).isDirectory()) return cwd;
    } catch {
      // Try the next candidate.
    }
  }
  return process.cwd();
}

function normalizeDimension(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

function normalizeID(id: unknown): string {
  return typeof id === 'string' ? id.trim().slice(0, 80) : '';
}

function appendBuffer(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= MAX_BUFFER_CHARS) return combined;
  return combined.slice(combined.length - MAX_BUFFER_CHARS);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'terminal session failed');
}
