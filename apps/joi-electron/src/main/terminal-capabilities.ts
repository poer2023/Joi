import type {
  TerminalSessionInfo,
  TerminalSessionInputRequest,
  TerminalSessionKillRequest,
  TerminalSessionSnapshot,
  TerminalSessionStartRequest,
} from '../../../../packages/shared-types/src/desktop-api';
import { validateFullAccessCommandInput } from '../../../../packages/runtime/src/workspace-exec.ts';

export type TerminalCapabilityManager = {
  start(payload?: TerminalSessionStartRequest): TerminalSessionInfo;
  input(payload: TerminalSessionInputRequest): void;
  kill(payload: TerminalSessionKillRequest): void;
  getStatus(id: string): TerminalSessionSnapshot;
};

export function executeShellStartCapability(
  inputs: Record<string, unknown>,
  manager: TerminalCapabilityManager,
  defaultCwd: string,
  permissionProfile: string,
): Record<string, unknown> {
  assertDangerFullAccess(permissionProfile, 'shell_start');
  const session = manager.start({
    cwd: stringInput(inputs.cwd) || defaultCwd,
    shell: stringInput(inputs.shell) || undefined,
    cols: numberInput(inputs.cols),
    rows: numberInput(inputs.rows),
  });
  return {
    status: session.status === 'failed' ? 'failed' : 'completed',
    session,
    summary: session.status === 'failed'
      ? `Persistent shell failed to start: ${session.error || 'unknown error'}`
      : `Persistent shell ${session.id} started in ${session.cwd}.`,
    mode: 'shell_start_v1_node_pty',
  };
}

export function executeShellWriteCapability(
  inputs: Record<string, unknown>,
  manager: TerminalCapabilityManager,
  permissionProfile: string,
): Record<string, unknown> {
  assertDangerFullAccess(permissionProfile, 'shell_write');
  const sessionID = stringInput(inputs.session_id);
  const data = typeof inputs.data === 'string' ? inputs.data : '';
  if (!sessionID) throw new Error('shell_write session_id is required');
  if (!data) throw new Error('shell_write data is required');
  if (data.length > 20_000) throw new Error('shell_write data exceeds 20000 characters');
  const before = manager.getStatus(sessionID);
  if (!before.session) throw new Error(`terminal session not found: ${sessionID}`);
  if (before.session.status !== 'running') throw new Error(`terminal session is not running: ${sessionID}`);
  validateTerminalInput(data);
  manager.input({ id: sessionID, data });
  return {
    status: 'completed',
    session_id: sessionID,
    bytes_written: Buffer.byteLength(data),
    session_status: manager.getStatus(sessionID).session?.status || before.session.status,
    summary: `Wrote validated input to persistent shell ${sessionID}.`,
    mode: 'shell_write_v1_full_access_blacklist',
  };
}

export function executeShellOutputCapability(
  inputs: Record<string, unknown>,
  manager: TerminalCapabilityManager,
): Record<string, unknown> {
  const sessionID = stringInput(inputs.session_id);
  if (!sessionID) throw new Error('shell_output session_id is required');
  const snapshot = manager.getStatus(sessionID);
  if (!snapshot.session) throw new Error(`terminal session not found: ${sessionID}`);
  const maxChars = boundedInteger(inputs.max_chars, 20_000, 1_000, 80_000);
  const output = snapshot.output || '';
  const start = Math.max(0, output.length - maxChars);
  return {
    status: 'completed',
    session: snapshot.session,
    output: output.slice(start),
    output_start: start,
    output_chars: output.length - start,
    output_truncated: start > 0,
    summary: `Read recent output from persistent shell ${sessionID}.`,
    mode: 'shell_output_v1_bounded_tail',
  };
}

export function executeShellKillCapability(
  inputs: Record<string, unknown>,
  manager: TerminalCapabilityManager,
  permissionProfile: string,
): Record<string, unknown> {
  assertDangerFullAccess(permissionProfile, 'shell_kill');
  const sessionID = stringInput(inputs.session_id);
  if (!sessionID) throw new Error('shell_kill session_id is required');
  const before = manager.getStatus(sessionID);
  if (!before.session) throw new Error(`terminal session not found: ${sessionID}`);
  manager.kill({ id: sessionID });
  const after = manager.getStatus(sessionID);
  return {
    status: 'completed',
    session: after.session || before.session,
    summary: `Terminated persistent shell ${sessionID}.`,
    mode: 'shell_kill_v1_node_pty',
  };
}

function validateTerminalInput(data: string): void {
  if (data === '\u0003' || data === '\u0004') return;
  if (/[\u0000-\u0002\u0005-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(data)) {
    throw new Error('shell_write contains unsupported control characters');
  }
  const command = data.replace(/[\r\n]+$/u, '').trim();
  if (!command) throw new Error('shell_write command is empty');
  validateFullAccessCommandInput(command, 'shell_write');
}

function assertDangerFullAccess(permissionProfile: string, capability: string): void {
  if (permissionProfile !== 'danger_full_access') {
    throw new Error(`${capability} requires danger_full_access permission profile`);
  }
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberInput(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
