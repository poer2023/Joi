import { randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import {
  desktopBindingMethods,
  type DesktopBindings,
  type TerminalSessionEvent,
  type TerminalSessionInfo,
  type TerminalSessionInputRequest,
  type TerminalSessionKillRequest,
  type TerminalSessionResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionStartRequest,
} from '../../../../packages/shared-types/src/desktop-api.ts';

const desktopIpcMethods = desktopBindingMethods;
type DesktopIpcMethod = keyof DesktopBindings;

export type JoiCommandHandler = (payload?: unknown) => Promise<unknown> | unknown;
export type JoiCommandHandlerMap = Record<DesktopIpcMethod, JoiCommandHandler>;

export type JoiCommandRequest = {
  action?:
    | 'ping'
    | 'describe'
    | 'invoke'
    | 'subscribe'
    | 'terminal_start'
    | 'terminal_input'
    | 'terminal_resize'
    | 'terminal_kill'
    | 'terminal_status'
    | 'acp_web';
  request_id?: string;
  method?: string;
  payload?: unknown;
  confirm?: boolean;
  topic?: 'run_events' | 'terminal_events';
  run_id?: string;
  terminal_id?: string;
  after_seq?: number;
  token?: string;
  capability?: string;
};

export type JoiCommandEnvelope = {
  ok: boolean;
  data: unknown;
  error: null | {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  trace_id: string;
};

export type JoiCommandHostOptions = {
  socketPath: string;
  handlers: JoiCommandHandlerMap;
  riskForMethod?: (method: DesktopIpcMethod) => string;
  maxRequestBytes?: number;
  hostInfo?: Record<string, unknown>;
  terminal?: {
    start(req?: TerminalSessionStartRequest): TerminalSessionInfo | Promise<TerminalSessionInfo>;
    input(req: TerminalSessionInputRequest): void | Promise<void>;
    resize(req: TerminalSessionResizeRequest): void | Promise<void>;
    kill(req: TerminalSessionKillRequest): void | Promise<void>;
    getStatus(id: string): TerminalSessionSnapshot | Promise<TerminalSessionSnapshot>;
  };
  replayRunEvents?: (runID: string, afterSeq: number) => unknown[] | Promise<unknown[]>;
  acpWeb?: {
    token?: string;
    authorize?: (token: string) => {
      permission_profile: string;
      capabilities: Iterable<string>;
    } | undefined;
    execute: (request: {
      capability: string;
      payload: Record<string, unknown>;
      request_id: string;
      permission_profile: string;
    }) => unknown | Promise<unknown>;
  };
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  onInvocation?: (event: {
    method: DesktopIpcMethod;
    risk: string;
    duration_ms: number;
    ok: boolean;
    error?: unknown;
  }) => void;
};

const activeHosts = new Map<string, Server>();
type StreamSubscription = {
  socket: Socket;
  traceID: string;
  topic: 'run_events' | 'terminal_events';
  runID?: string;
  terminalID?: string;
  lastSeq: number;
};
const streamSubscriptions = new Set<StreamSubscription>();
const terminalSeq = new Map<string, number>();

export const cliAuxiliaryOperations = [
  'onRunEvent',
  'terminal.start',
  'terminal.input',
  'terminal.resize',
  'terminal.kill',
  'terminal.getStatus',
  'terminal.onEvent',
  'app.getVersion',
  'app.openExternal',
] as const;

export function defaultJoiCommandSocketPath(userDataDir: string): string {
  return String(process.env.JOI_CLI_SOCKET || '').trim() || join(userDataDir, 'joi-cli.sock');
}

export function methodRequiresCliConfirmation(method: DesktopIpcMethod): boolean {
  return /^(?:ClearLogs|DeleteAutomation|DeleteConversationGroup|DeleteMCPServer|DeleteMemory|GenerateWorkerToken|PurgeConversation|RemovePlugin|RestoreBackup|RotateAutomationWebhookSecret|SaveSecret|SetupPhotonIMessage)$/u.test(method);
}

export async function dispatchJoiCommand(
  request: JoiCommandRequest,
  options: Pick<JoiCommandHostOptions, 'handlers' | 'riskForMethod' | 'hostInfo' | 'terminal' | 'acpWeb' | 'onInvocation'>,
): Promise<JoiCommandEnvelope> {
  const traceID = normalizedTraceID(request.request_id);
  const action = request.action || (request.method ? 'invoke' : 'ping');
  if (action === 'ping') {
    return successEnvelope(traceID, {
      status: 'ok',
      transport: 'unix',
      pid: process.pid,
      methods: desktopIpcMethods.length,
      auxiliary_operations: cliAuxiliaryOperations.length,
      interface_operations: desktopIpcMethods.length + cliAuxiliaryOperations.length,
      ...(options.hostInfo || {}),
    });
  }
  if (action === 'describe') {
    return successEnvelope(traceID, {
      transport: 'unix',
      host: options.hostInfo || {},
      methods: desktopIpcMethods.map((method) => ({
        name: method,
        command: pascalToKebab(method),
        risk: options.riskForMethod?.(method) || 'read_only',
        requires_confirmation: methodRequiresCliConfirmation(method),
      })),
      auxiliary: cliAuxiliaryOperations.map((name) => ({
        name,
        transport: name.startsWith('terminal.') || name === 'onRunEvent' ? 'unix_jsonl' : 'cli_native',
      })),
    });
  }
  if (action === 'acp_web') {
    return dispatchACPWebCommand(request, options, traceID);
  }
  if (action.startsWith('terminal_')) {
    if (!options.terminal) return errorEnvelope(traceID, 'TERMINAL_UNAVAILABLE', 'Persistent terminal service is unavailable');
    try {
      if (action === 'terminal_start') return successEnvelope(traceID, await options.terminal.start(request.payload as TerminalSessionStartRequest | undefined));
      if (action === 'terminal_input') {
        await options.terminal.input(request.payload as TerminalSessionInputRequest);
        return successEnvelope(traceID, { accepted: true });
      }
      if (action === 'terminal_resize') {
        await options.terminal.resize(request.payload as TerminalSessionResizeRequest);
        return successEnvelope(traceID, { accepted: true });
      }
      if (action === 'terminal_kill') {
        await options.terminal.kill(request.payload as TerminalSessionKillRequest);
        return successEnvelope(traceID, { accepted: true });
      }
      if (action === 'terminal_status') {
        const id = String(request.terminal_id || (request.payload as { id?: unknown } | undefined)?.id || '');
        return successEnvelope(traceID, await options.terminal.getStatus(id));
      }
    } catch (error) {
      return errorEnvelope(traceID, 'TERMINAL_COMMAND_FAILED', error instanceof Error ? error.message : String(error));
    }
  }
  if (action !== 'invoke') {
    return errorEnvelope(traceID, 'INVALID_REQUEST', `Unsupported command action: ${String(action)}`);
  }

  const method = String(request.method || '') as DesktopIpcMethod;
  if (!desktopIpcMethods.includes(method)) {
    return errorEnvelope(traceID, 'UNSUPPORTED_METHOD', `Unsupported Joi command: ${method || '(empty)'}`, { method });
  }
  const handler = options.handlers[method];
  if (!handler) {
    return errorEnvelope(traceID, 'HANDLER_UNAVAILABLE', `Joi command handler is unavailable: ${method}`, { method });
  }
  const risk = options.riskForMethod?.(method) || 'read_only';
  if (methodRequiresCliConfirmation(method) && request.confirm !== true) {
    return errorEnvelope(traceID, 'CONFIRMATION_REQUIRED', `${method} requires --yes`, {
      method,
      risk,
      retry_with: '--yes',
    });
  }

  const startedAt = Date.now();
  try {
    const data = await handler(request.payload);
    options.onInvocation?.({ method, risk, duration_ms: Date.now() - startedAt, ok: true });
    return successEnvelope(traceID, data ?? null);
  } catch (error) {
    options.onInvocation?.({ method, risk, duration_ms: Date.now() - startedAt, ok: false, error });
    return errorEnvelope(traceID, 'COMMAND_FAILED', error instanceof Error ? error.message : String(error), { method, risk });
  }
}

async function dispatchACPWebCommand(
  request: JoiCommandRequest,
  options: Pick<JoiCommandHostOptions, 'acpWeb'>,
  traceID: string,
): Promise<JoiCommandEnvelope> {
  const bridge = options.acpWeb;
  if (!bridge) return errorEnvelope(traceID, 'ACP_WEB_UNAVAILABLE', 'Joi ACP capability bridge is unavailable');
  const candidateToken = String(request.token || '');
  const grant = bridge.authorize?.(candidateToken)
    || (bridge.token && secureTokenEqual(candidateToken, bridge.token)
      ? { permission_profile: 'read_only', capabilities: ['web_search', 'web_extract'] }
      : undefined);
  if (!grant) return errorEnvelope(traceID, 'ACP_WEB_UNAUTHORIZED', 'Joi ACP capability bridge token is invalid');
  const capability = String(request.capability || '').trim();
  if (!new Set(grant.capabilities).has(capability)) {
    return errorEnvelope(traceID, 'ACP_WEB_CAPABILITY_DENIED', `Joi ACP capability bridge does not expose ${capability || '(empty)'}`, { capability });
  }
  const payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
    ? request.payload as Record<string, unknown>
    : {};
  try {
    return successEnvelope(traceID, await bridge.execute({
      capability,
      payload,
      request_id: traceID,
      permission_profile: grant.permission_profile,
    }));
  } catch (error) {
    return errorEnvelope(traceID, 'ACP_WEB_FAILED', error instanceof Error ? error.message : String(error), { capability });
  }
}

function secureTokenEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export async function startJoiCommandHost(options: JoiCommandHostOptions): Promise<Server> {
  const existing = activeHosts.get(options.socketPath);
  if (existing) return existing;
  prepareSocketPath(options.socketPath);
  const logger = options.logger || console;
  const maxRequestBytes = Math.max(1024, options.maxRequestBytes || 10 * 1024 * 1024);
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    void handleSocket(socket, options, maxRequestBytes);
  });
  server.on('error', (error) => logger.error(`Joi CLI command host failed: ${error.message}`));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.socketPath);
  });
  chmodSync(options.socketPath, 0o600);
  activeHosts.set(options.socketPath, server);
  server.unref();
  server.once('close', () => {
    activeHosts.delete(options.socketPath);
    unlinkSocket(options.socketPath);
  });
  logger.info(`Joi CLI command host listening on ${options.socketPath}`);
  return server;
}

export async function stopJoiCommandHost(socketPath?: string): Promise<void> {
  const targets = socketPath
    ? [[socketPath, activeHosts.get(socketPath)] as const]
    : [...activeHosts.entries()];
  await Promise.all(targets.map(async ([path, server]) => {
    if (!server) {
      unlinkSocket(path);
      return;
    }
    for (const subscription of [...streamSubscriptions]) {
      subscription.socket.destroy();
      streamSubscriptions.delete(subscription);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
}

export function publishJoiRunEvent(value: unknown): void {
  const event = normalizeRunEvent(value);
  if (!event) return;
  for (const subscription of [...streamSubscriptions]) {
    if (subscription.topic !== 'run_events') continue;
    if (subscription.runID && subscription.runID !== event.run_id) continue;
    sendStreamEvent(subscription, event);
  }
}

export function publishJoiTerminalEvent(value: TerminalSessionEvent): void {
  const event = normalizeTerminalEvent(value);
  for (const subscription of [...streamSubscriptions]) {
    if (subscription.topic !== 'terminal_events') continue;
    if (subscription.terminalID && subscription.terminalID !== value.id) continue;
    sendStreamEvent(subscription, event);
  }
}

async function handleSocket(socket: Socket, options: JoiCommandHostOptions, maxRequestBytes: number): Promise<void> {
  socket.setEncoding('utf8');
  let body = '';
  let overflowed = false;
  socket.on('data', (chunk) => {
    if (overflowed) return;
    body += String(chunk);
    if (Buffer.byteLength(body, 'utf8') > maxRequestBytes) {
      overflowed = true;
      socket.end(`${JSON.stringify(errorEnvelope(normalizedTraceID(), 'REQUEST_TOO_LARGE', 'CLI request exceeds the size limit'))}\n`);
    }
  });
  socket.on('error', () => undefined);
  socket.on('end', async () => {
    if (overflowed) return;
    let request: JoiCommandRequest;
    try {
      request = JSON.parse(body.trim() || '{}') as JoiCommandRequest;
    } catch (error) {
      socket.end(`${JSON.stringify(errorEnvelope(normalizedTraceID(), 'INVALID_JSON', error instanceof Error ? error.message : String(error)))}\n`);
      return;
    }
    if (request.action === 'subscribe') {
      await subscribeSocket(socket, request, options);
      return;
    }
    const response = await dispatchJoiCommand(request, options);
    socket.end(`${JSON.stringify(response)}\n`);
  });
}

async function subscribeSocket(socket: Socket, request: JoiCommandRequest, options: JoiCommandHostOptions): Promise<void> {
  const traceID = normalizedTraceID(request.request_id);
  const topic = request.topic;
  if (topic !== 'run_events' && topic !== 'terminal_events') {
    socket.end(`${JSON.stringify(errorEnvelope(traceID, 'INVALID_SUBSCRIPTION', 'topic must be run_events or terminal_events'))}\n`);
    return;
  }
  const subscription: StreamSubscription = {
    socket,
    traceID,
    topic,
    runID: String(request.run_id || '').trim() || undefined,
    terminalID: String(request.terminal_id || '').trim() || undefined,
    lastSeq: Math.max(0, Number(request.after_seq || 0)),
  };
  streamSubscriptions.add(subscription);
  socket.once('close', () => streamSubscriptions.delete(subscription));
  socket.write(`${JSON.stringify(successEnvelope(traceID, {
    subscription: 'started',
    topic,
    run_id: subscription.runID,
    terminal_id: subscription.terminalID,
    after_seq: subscription.lastSeq,
    format: 'jsonl',
  }))}\n`);

  if (topic === 'terminal_events' && subscription.terminalID && options.terminal) {
    try {
      const snapshot = await options.terminal.getStatus(subscription.terminalID);
      socket.write(`${JSON.stringify(successEnvelope(traceID, { subscription: 'snapshot', topic, snapshot }))}\n`);
      if (snapshot.session && ['exited', 'failed'].includes(snapshot.session.status)) socket.end();
    } catch (error) {
      socket.end(`${JSON.stringify(errorEnvelope(traceID, 'TERMINAL_STATUS_FAILED', error instanceof Error ? error.message : String(error)))}\n`);
    }
    return;
  }

  if (topic === 'run_events' && subscription.runID && options.replayRunEvents) {
    try {
      const events = await options.replayRunEvents(subscription.runID, subscription.lastSeq);
      for (const value of events) {
        const event = normalizeRunEvent(value);
        if (!event || event.run_id !== subscription.runID) continue;
        sendStreamEvent(subscription, event);
        if (socket.destroyed) break;
      }
    } catch (error) {
      socket.end(`${JSON.stringify(errorEnvelope(traceID, 'RUN_REPLAY_FAILED', error instanceof Error ? error.message : String(error)))}\n`);
    }
  }
}

function sendStreamEvent(subscription: StreamSubscription, event: Record<string, unknown>): void {
  if (subscription.socket.destroyed || !subscription.socket.writable) {
    streamSubscriptions.delete(subscription);
    return;
  }
  const seq = Math.max(0, Number(event.seq || 0));
  if (seq > 0 && seq <= subscription.lastSeq) return;
  if (seq > subscription.lastSeq) subscription.lastSeq = seq;
  subscription.socket.write(`${JSON.stringify(successEnvelope(subscription.traceID, {
    subscription: 'event',
    topic: subscription.topic,
    event,
  }))}\n`);
  const type = String(event.type || '');
  const terminal = event.terminal === true
    || /^run\.(?:completed|failed|cancelled)$/u.test(type)
    || /^terminal\.(?:exit|error)$/u.test(type);
  if (terminal && (subscription.runID || subscription.terminalID)) {
    streamSubscriptions.delete(subscription);
    subscription.socket.end();
  }
}

function normalizeRunEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const runID = String(record.run_id || (record.payload as Record<string, unknown> | undefined)?.run_id || '').trim();
  if (!runID) return null;
  const seq = Math.max(0, Number(record.seq || (record.payload as Record<string, unknown> | undefined)?.seq || 0));
  const type = String(record.type || record.event_type || 'run.event');
  return {
    ...record,
    id: String(record.id || `${runID}:${seq || randomUUID()}`),
    run_id: runID,
    seq,
    type,
    status: String(record.status || (record.payload as Record<string, unknown> | undefined)?.status || 'running'),
    created_at: String(record.created_at || record.timestamp || new Date().toISOString()),
  };
}

function normalizeTerminalEvent(value: TerminalSessionEvent): Record<string, unknown> {
  const seq = (terminalSeq.get(value.id) || 0) + 1;
  terminalSeq.set(value.id, seq);
  const type = `terminal.${value.type}`;
  const status = String(value.session?.status || (value.type === 'error' ? 'failed' : value.type === 'exit' ? 'completed' : 'running'));
  return {
    id: `${value.id}:${seq}`,
    run_id: value.id,
    terminal_id: value.id,
    seq,
    type,
    status,
    created_at: new Date().toISOString(),
    terminal: value.type === 'exit' || value.type === 'error',
    stdout: value.type === 'output' ? value.data || '' : undefined,
    stderr: value.type === 'error' ? value.error || '' : undefined,
    payload: value,
  };
}

function successEnvelope(traceID: string, data: unknown): JoiCommandEnvelope {
  return { ok: true, data, error: null, trace_id: traceID };
}

function errorEnvelope(traceID: string, code: string, message: string, details: Record<string, unknown> = {}): JoiCommandEnvelope {
  return { ok: false, data: null, error: { code, message, details }, trace_id: traceID };
}

function normalizedTraceID(value?: string): string {
  const candidate = String(value || '').trim();
  if (/^[A-Za-z0-9_.:-]{1,128}$/u.test(candidate)) return candidate;
  return `cli_${randomUUID().replace(/-/g, '')}`;
}

function prepareSocketPath(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket CLI path: ${path}`);
  unlinkSync(path);
}

function unlinkSocket(path: string): void {
  try {
    if (existsSync(path) && lstatSync(path).isSocket()) unlinkSync(path);
  } catch {
    // A concurrent replacement owns the path; leave it untouched.
  }
}

function pascalToKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
