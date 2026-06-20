import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  WorkerGatewayTask,
  WorkerRegisterRequest,
  WorkerTaskError,
  WorkerTaskResult,
} from '../../store/src/sqlite';

export type WorkerGatewayStore = {
  recordWorkerGatewayAudit(nodeID: string, action: string, status: string, reason: string, metadata?: Record<string, unknown>): void;
  upsertWorkerNode(req: WorkerRegisterRequest): void;
  workerGatewayNodeDenied(nodeID: string): { denied: boolean; reason: string };
  acceptWorkerGatewayNonce(nodeID: string, timestampHeader: string | undefined, nonce: string | undefined): void;
  heartbeatWorkerNode(nodeID: string): void;
  claimWorkerGatewayTask(nodeID: string): WorkerGatewayTask | null;
  workerNodeCapabilityAllowed(nodeID: string, capabilityID: string): boolean;
  ackWorkerGatewayTask(nodeID: string, taskID: string, result: WorkerTaskResult): void;
  failWorkerGatewayTask(nodeID: string, taskID: string, taskError: WorkerTaskError): void;
};

export type WorkerGatewayOptions = {
  store: WorkerGatewayStore;
  addr?: string;
  resolveToken?: () => Promise<string> | string;
  logger?: Pick<Console, 'info' | 'warn'>;
};

export type WorkerGatewayServer = {
  addr(): string;
  url(): string;
  close(): Promise<void>;
};

type GuardedRequest = {
  request: IncomingMessage;
  response: ServerResponse;
  nodeID: string;
};

const defaultAddr = '127.0.0.1:18081';

export async function startWorkerGateway(options: WorkerGatewayOptions): Promise<WorkerGatewayServer> {
  const gateway = new WorkerGateway(options);
  await gateway.listen();
  return gateway;
}

class WorkerGateway implements WorkerGatewayServer {
  private readonly server: Server;
  private readonly store: WorkerGatewayStore;
  private readonly resolveToken?: () => Promise<string> | string;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private readonly events = new Map<string, number[]>();
  private readonly locks = new Map<string, number>();

  constructor(options: WorkerGatewayOptions) {
    this.store = options.store;
    this.resolveToken = options.resolveToken;
    this.logger = options.logger || console;
    this.server = createServer((request, response) => {
      void this.route(request, response);
    });
    const parsed = parseListenAddr(options.addr || process.env.WORKER_GATEWAY_ADDR || defaultAddr);
    this.server.on('error', (error) => {
      this.logger.warn('worker gateway stopped', error);
    });
    this.listenOptions = parsed;
  }

  private listenOptions: { host: string; port: number };

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        this.logger.info('worker gateway listening', this.addr());
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.listenOptions.port, this.listenOptions.host);
    });
  }

  addr(): string {
    const address = this.server.address() as AddressInfo | null;
    if (!address) return '';
    return `${address.address}:${address.port}`;
  }

  url(): string {
    return `http://${this.addr()}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (request.method !== 'POST') {
      writeWorkerJSON(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (path === '/worker/register') {
      await this.guard(request, response, 'register', (guarded) => this.handleRegister(guarded));
      return;
    }
    if (path === '/worker/heartbeat') {
      await this.guard(request, response, 'heartbeat', (guarded) => this.handleHeartbeat(guarded));
      return;
    }
    if (path === '/worker/tasks/claim') {
      await this.guard(request, response, 'claim', (guarded) => this.handleClaim(guarded));
      return;
    }
    const ackMatch = path.match(/^\/worker\/tasks\/([^/]+)\/ack$/);
    if (ackMatch) {
      await this.guard(request, response, 'ack', (guarded) => this.handleAck(guarded, decodeURIComponent(ackMatch[1])));
      return;
    }
    const failMatch = path.match(/^\/worker\/tasks\/([^/]+)\/fail$/);
    if (failMatch) {
      await this.guard(request, response, 'fail', (guarded) => this.handleFail(guarded, decodeURIComponent(failMatch[1])));
      return;
    }
    writeWorkerJSON(response, 404, { ok: false, error: 'not_found' });
  }

  private async guard(
    request: IncomingMessage,
    response: ServerResponse,
    action: string,
    next: (guarded: GuardedRequest) => Promise<void>,
  ): Promise<void> {
    const nodeID = headerValue(request, 'x-worker-node-id');
    if (!nodeID) {
      writeWorkerJSON(response, 400, { ok: false, error: 'node_id_header_required' });
      return;
    }
    const authKey = remoteAuthKey(request);
    const lockedUntil = this.lockedUntil(authKey);
    if (lockedUntil > 0) {
      this.store.recordWorkerGatewayAudit(nodeID, action, 'denied', 'auth_lockout', { locked_until: new Date(lockedUntil).toISOString() });
      writeWorkerJSON(response, 429, { ok: false, error: 'auth_lockout' });
      return;
    }
    const expectedToken = (await this.currentToken()).trim();
    if (expectedToken) {
      const bearer = headerValue(request, 'authorization').replace(/^Bearer\s+/i, '').trim();
      const token = bearer || headerValue(request, 'x-worker-token');
      if (token !== expectedToken) {
        this.recordFailedAuth(authKey);
        this.store.recordWorkerGatewayAudit(nodeID, action, 'denied', 'bad_token', { remote_addr: request.socket.remoteAddress || '' });
        writeWorkerJSON(response, 401, { ok: false, error: 'permission_denied' });
        return;
      }
    }
    if (!workerNodeAllowed(nodeID)) {
      this.store.recordWorkerGatewayAudit(nodeID, action, 'denied', 'node_not_allowlisted', {});
      writeWorkerJSON(response, 403, { ok: false, error: 'node_not_allowlisted' });
      return;
    }
    const denied = this.store.workerGatewayNodeDenied(nodeID);
    if (denied.denied) {
      this.store.recordWorkerGatewayAudit(nodeID, action, 'denied', denied.reason, {});
      writeWorkerJSON(response, 403, { ok: false, error: denied.reason });
      return;
    }
    try {
      this.store.acceptWorkerGatewayNonce(nodeID, headerValue(request, 'x-worker-timestamp'), headerValue(request, 'x-worker-nonce'));
    } catch (error) {
      const reason = errorMessage(error);
      this.store.recordWorkerGatewayAudit(nodeID, action, 'denied', reason, {});
      writeWorkerJSON(response, 401, { ok: false, error: reason });
      return;
    }
    if (!this.rateAllowed(`${nodeID}:${action}`, rateLimitForAction(action), 60_000)) {
      this.store.recordWorkerGatewayAudit(nodeID, action, 'denied', 'rate_limited', {});
      writeWorkerJSON(response, 429, { ok: false, error: 'rate_limited' });
      return;
    }
    await next({ request, response, nodeID });
  }

  private async handleRegister({ request, response, nodeID }: GuardedRequest): Promise<void> {
    let body: WorkerRegisterRequest;
    try {
      body = await readJSON<WorkerRegisterRequest>(request, true);
    } catch (error) {
      writeWorkerJSON(response, 400, { ok: false, error: errorMessage(error) });
      return;
    }
    const requestNodeID = body.node_id?.trim() || nodeID;
    if (requestNodeID !== nodeID) {
      writeWorkerJSON(response, 400, { ok: false, error: 'node_id_mismatch' });
      return;
    }
    this.store.upsertWorkerNode({ ...body, node_id: nodeID });
    this.store.recordWorkerGatewayAudit(nodeID, 'register', 'allowed', 'registered', { capabilities: body.capabilities || [] });
    writeWorkerJSON(response, 200, { ok: true, node_id: nodeID });
  }

  private async handleHeartbeat({ request, response, nodeID }: GuardedRequest): Promise<void> {
    const body = await readJSON<WorkerRegisterRequest>(request, false);
    const requestNodeID = body.node_id?.trim() || nodeID;
    if (requestNodeID !== nodeID) {
      writeWorkerJSON(response, 400, { ok: false, error: 'node_id_mismatch' });
      return;
    }
    this.store.heartbeatWorkerNode(nodeID);
    this.store.recordWorkerGatewayAudit(nodeID, 'heartbeat', 'allowed', 'heartbeat', {});
    writeWorkerJSON(response, 200, { ok: true });
  }

  private async handleClaim({ request, response, nodeID }: GuardedRequest): Promise<void> {
    const body = await readJSON<{ node_id?: string }>(request, false);
    const requestNodeID = body.node_id?.trim() || nodeID;
    if (requestNodeID !== nodeID) {
      writeWorkerJSON(response, 400, { ok: false, error: 'node_id_mismatch' });
      return;
    }
    const task = this.store.claimWorkerGatewayTask(nodeID);
    if (task && !this.store.workerNodeCapabilityAllowed(nodeID, task.capability_id)) {
      this.store.failWorkerGatewayTask(nodeID, task.id, {
        code: 'permission_denied',
        message: 'node capability whitelist denied this task',
        details: { node_id: nodeID, capability: task.capability_id },
      });
      this.store.recordWorkerGatewayAudit(nodeID, 'claim', 'denied', 'capability_not_allowed', { task_id: task.id, capability: task.capability_id });
      writeWorkerJSON(response, 200, { ok: true, task: null });
      return;
    }
    this.store.recordWorkerGatewayAudit(nodeID, 'claim', 'allowed', 'claim', { task_id: task?.id || '' });
    writeWorkerJSON(response, 200, { ok: true, task });
  }

  private async handleAck({ request, response, nodeID }: GuardedRequest, taskID: string): Promise<void> {
    const body = await readJSON<WorkerTaskResult>(request, false);
    try {
      this.store.ackWorkerGatewayTask(nodeID, taskID, body);
    } catch (error) {
      const reason = errorMessage(error);
      this.store.recordWorkerGatewayAudit(nodeID, 'ack', 'denied', reason, { task_id: taskID });
      writeWorkerJSON(response, 500, { ok: false, error: reason });
      return;
    }
    this.store.recordWorkerGatewayAudit(nodeID, 'ack', 'allowed', 'task_ack', { task_id: taskID });
    writeWorkerJSON(response, 200, { ok: true });
  }

  private async handleFail({ request, response, nodeID }: GuardedRequest, taskID: string): Promise<void> {
    const body = await readJSON<WorkerTaskError>(request, false);
    try {
      this.store.failWorkerGatewayTask(nodeID, taskID, body);
    } catch (error) {
      const reason = errorMessage(error);
      this.store.recordWorkerGatewayAudit(nodeID, 'fail', 'denied', reason, { task_id: taskID });
      writeWorkerJSON(response, 500, { ok: false, error: reason });
      return;
    }
    this.store.recordWorkerGatewayAudit(nodeID, 'fail', 'allowed', 'task_fail', { task_id: taskID });
    writeWorkerJSON(response, 200, { ok: true });
  }

  private async currentToken(): Promise<string> {
    if (process.env.WORKER_TOKEN?.trim()) return process.env.WORKER_TOKEN.trim();
    return (await this.resolveToken?.())?.trim() || '';
  }

  private rateAllowed(key: string, limit: number, windowMs: number): boolean {
    if (limit <= 0) return true;
    const now = Date.now();
    const cutoff = now - windowMs;
    const events = (this.events.get(key) || []).filter((event) => event > cutoff);
    if (events.length >= limit) {
      this.events.set(key, events);
      return false;
    }
    events.push(now);
    this.events.set(key, events);
    return true;
  }

  private lockedUntil(key: string): number {
    const until = this.locks.get(key) || 0;
    if (until > Date.now()) return until;
    if (until) this.locks.delete(key);
    return 0;
  }

  private recordFailedAuth(key: string): void {
    if (this.rateAllowed(`authfail:${key}`, 5, 10 * 60_000)) return;
    this.locks.set(key, Date.now() + 10 * 60_000);
  }
}

function parseListenAddr(addr: string): { host: string; port: number } {
  const trimmed = addr.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  const separator = withoutProtocol.lastIndexOf(':');
  if (separator < 0) return { host: withoutProtocol || '127.0.0.1', port: 18081 };
  const host = withoutProtocol.slice(0, separator) || '127.0.0.1';
  const port = Number(withoutProtocol.slice(separator + 1));
  return { host, port: Number.isFinite(port) ? port : 18081 };
}

async function readJSON<T extends Record<string, unknown>>(request: IncomingMessage, strict: boolean): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : {} as T;
  } catch (error) {
    if (strict) throw error;
    return {} as T;
  }
}

function writeWorkerJSON(response: ServerResponse, status: number, payload: Record<string, unknown>): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || '';
  return typeof value === 'string' ? value.trim() : '';
}

function workerNodeAllowed(nodeID: string): boolean {
  const allowlist = process.env.WORKER_ALLOWED_NODE_IDS?.trim() || '';
  if (!allowlist) return true;
  return allowlist.split(',').map((item) => item.trim()).includes(nodeID);
}

function rateLimitForAction(action: string): number {
  switch (action) {
    case 'heartbeat':
      return 60;
    case 'claim':
      return 40;
    default:
      return 120;
  }
}

function remoteAuthKey(request: IncomingMessage): string {
  return request.socket.remoteAddress || '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
