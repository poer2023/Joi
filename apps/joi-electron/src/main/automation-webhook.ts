import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { AutomationDefinition } from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import {
  apiErrorShape,
  apiShape,
  redactWebhookHeaders,
  verifyWebhookSignature,
  webhookDedupKey,
} from '../../../../packages/runtime/src/automation';

const defaultWebhookAddr = '127.0.0.1:18082';
const webhookBodyLimitBytes = 256 * 1024;
const webhookRateLimitPerMinute = 60;

type AutomationWebhookAppLogInput = Parameters<JoiSQLiteStore['recordAppLog']>[0];

export type AutomationWebhookServerOptions = {
  store: JoiSQLiteStore;
  secrets: KeychainSecretStore;
  runner?: { requestDrain(): void };
  addr?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
};

export class AutomationWebhookServer {
  private store: JoiSQLiteStore;
  private secrets: KeychainSecretStore;
  private runner?: { requestDrain(): void };
  private addr: string;
  private logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private server?: Server;
  private rateBuckets = new Map<string, { minute: number; count: number }>();

  constructor(options: AutomationWebhookServerOptions) {
    this.store = options.store;
    this.secrets = options.secrets;
    this.runner = options.runner;
    this.addr = options.addr || process.env.JOI_AUTOMATION_WEBHOOK_ADDR || defaultWebhookAddr;
    this.logger = options.logger || console;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const { host, port } = parseAddr(this.addr);
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        resolve();
      };
      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(port, host);
    });
    this.logger.info?.(`automation webhook server listening on ${this.urlBase()}`);
    recordAutomationWebhookAppLog(this.store, this.logger, {
      level: 'info',
      risk_level: 'state_change',
      category: 'automation',
      feature_key: 'automation.webhook.started',
      source: 'electron_automation_webhook',
      message: 'automation webhook server started',
      payload: { host, port },
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    recordAutomationWebhookAppLog(this.store, this.logger, {
      level: 'info',
      risk_level: 'state_change',
      category: 'automation',
      feature_key: 'automation.webhook.stopped',
      source: 'electron_automation_webhook',
      message: 'automation webhook server stopped',
    });
  }

  urlBase(): string {
    const address = this.server?.address();
    if (address && typeof address !== 'string') {
      return `http://${address.address}:${address.port}`;
    }
    const { host, port } = parseAddr(this.addr);
    return `http://${host}:${port}`;
  }

  endpointFor(automation: AutomationDefinition): string {
    return `${this.urlBase()}/automation/webhooks/${encodeURIComponent(automation.slug)}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const traceID = `trace_webhook_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (req.method !== 'POST') {
        this.recordWebhookRejected(traceID, 'METHOD_NOT_ALLOWED', 405, req);
        sendJSON(res, 405, apiErrorShape(traceID, 'METHOD_NOT_ALLOWED', 'Only POST is allowed.'));
        return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const match = url.pathname.match(/^\/automation\/webhooks\/([^/]+)$/);
      if (!match) {
        this.recordWebhookRejected(traceID, 'NOT_FOUND', 404, req);
        sendJSON(res, 404, apiErrorShape(traceID, 'NOT_FOUND', 'Webhook route not found.'));
        return;
      }
      const slug = decodeURIComponent(match[1] || '');
      const automation = this.lookupWebhookAutomation(slug);
      if (!automation) {
        this.recordWebhookRejected(traceID, 'NOT_FOUND', 404, req, { slug });
        sendJSON(res, 404, apiErrorShape(traceID, 'NOT_FOUND', 'Webhook automation not found.'));
        return;
      }
      if (!automation.enabled) {
        this.recordWebhookRejected(traceID, 'AUTOMATION_DISABLED', 409, req, { automation_id: automation.id, slug });
        sendJSON(res, 409, apiErrorShape(traceID, 'AUTOMATION_DISABLED', 'Automation is disabled.'));
        return;
      }
      if (!this.takeRateLimit(slug, remoteAddressFor(req) || '127.0.0.1')) {
        this.recordWebhookRejected(traceID, 'RATE_LIMITED', 429, req, { automation_id: automation.id, slug });
        sendJSON(res, 429, apiErrorShape(traceID, 'RATE_LIMITED', 'Webhook rate limit exceeded.'));
        return;
      }
      if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
        this.recordWebhookRejected(traceID, 'INVALID_PAYLOAD', 415, req, { automation_id: automation.id, slug });
        sendJSON(res, 415, apiErrorShape(traceID, 'INVALID_PAYLOAD', 'Webhook body must be JSON.'));
        return;
      }
      const rawBody = await readRequestBody(req, webhookBodyLimitBytes);
      const secret = await this.secrets.resolve(automationWebhookSecretRef(automation.id));
      if (!secret) {
        this.recordWebhookRejected(traceID, 'WEBHOOK_SECRET_MISSING', 503, req, { automation_id: automation.id, slug });
        sendJSON(res, 503, apiErrorShape(traceID, 'WEBHOOK_SECRET_MISSING', 'Webhook secret is not configured.'));
        return;
      }
      const signature = verifyWebhookSignature({
        header: String(req.headers['x-joi-signature'] || ''),
        secret,
        rawBody,
      });
      if (!signature.ok) {
        this.recordWebhookRejected(traceID, signature.error_code || 'BAD_SIGNATURE', signature.error_code === 'STALE_SIGNATURE' ? 401 : 403, req, { automation_id: automation.id, slug });
        sendJSON(res, signature.error_code === 'STALE_SIGNATURE' ? 401 : 403, apiErrorShape(traceID, signature.error_code || 'BAD_SIGNATURE', signature.message || 'Bad webhook signature.'));
        return;
      }
      const payload = parseJSONObject(rawBody);
      const jsonField = String(automation.dedup_policy.dedup_json_field || automation.trigger_config.dedup_json_field || '').trim();
      const dedupKey = webhookDedupKey({
        headers: headerMap(req),
        payload,
        rawBody,
        jsonField,
      });
      const accepted = this.store.enqueueAutomationTrigger({
        automation_id: automation.id,
        trigger_type: 'webhook',
        dedup_key: dedupKey,
        payload: {
          ...payload,
          _webhook: {
            trace_id: traceID,
            received_at: new Date().toISOString(),
            headers: redactWebhookHeaders(req.headers),
            remote_address: remoteAddressFor(req),
          },
        },
        fire_at: new Date().toISOString(),
      });
      recordAutomationWebhookAppLog(this.store, this.logger, {
        level: 'info',
        risk_level: 'state_change',
        category: 'automation',
        feature_key: 'automation.webhook.accepted',
        source: 'electron_automation_webhook',
        message: 'automation webhook accepted',
        item_type: 'automation_trigger',
        item_id: accepted.trigger.id,
        payload: {
          trace_id: traceID,
          automation_id: automation.id,
          slug,
          deduped: accepted.deduped,
          remote_address: remoteAddressFor(req),
        },
      });
      this.runner?.requestDrain();
      sendJSON(res, 202, apiShape(traceID, {
        trigger_id: accepted.trigger.id,
        deduped: accepted.deduped,
      }));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (err as Error & { code?: string }).code || (err.message.includes('too large') ? 'PAYLOAD_TOO_LARGE' : 'WEBHOOK_ERROR');
      const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'AUTOMATION_DISABLED' ? 409 : code === 'INVALID_PAYLOAD' ? 400 : 500;
      this.recordWebhookRejected(traceID, code, status, req, undefined, err);
      sendJSON(res, status, apiErrorShape(traceID, code, err.message));
    }
  }

  private recordWebhookRejected(traceID: string, code: string, status: number, req: IncomingMessage, payload: Record<string, unknown> = {}, error?: Error): void {
    recordAutomationWebhookAppLog(this.store, this.logger, {
      level: status >= 500 ? 'error' : 'warn',
      risk_level: 'state_change',
      category: 'automation',
      feature_key: 'automation.webhook.rejected',
      source: 'electron_automation_webhook',
      message: 'automation webhook rejected',
      payload: {
        trace_id: traceID,
        code,
        status,
        method: req.method || '',
        remote_address: remoteAddressFor(req),
        ...payload,
      },
      error: error ? { code, message: error.message } : undefined,
    });
  }

  private lookupWebhookAutomation(slug: string): AutomationDefinition | undefined {
    try {
      const automation = this.store.getAutomation(slug);
      return automation.kind === 'webhook' ? automation : undefined;
    } catch (error) {
      if (error instanceof Error && /automation not found/i.test(error.message)) return undefined;
      throw error;
    }
  }

  private takeRateLimit(slug: string, ip: string): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `${slug}:${ip}`;
    const existing = this.rateBuckets.get(key);
    if (!existing || existing.minute !== minute) {
      this.rateBuckets.set(key, { minute, count: 1 });
      return true;
    }
    if (existing.count >= webhookRateLimitPerMinute) return false;
    existing.count += 1;
    return true;
  }
}

export function automationWebhookSecretRef(automationID: string): string {
  return `JOI_AUTOMATION_WEBHOOK_SECRET_${automationID.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export function newAutomationWebhookSecret(): string {
  return `joi_whsec_${randomBytes(32).toString('hex')}`;
}

function parseAddr(addr: string): { host: string; port: number } {
  const [host, portText] = addr.split(':');
  const port = Number(portText || 0);
  if (!host || !Number.isFinite(port) || port < 0) return { host: '127.0.0.1', port: 18082 };
  return { host, port };
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(body)}\n`);
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error('Webhook body is too large.') as Error & { code?: string };
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseJSONObject(body: Buffer): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through.
  }
  const error = new Error('Webhook body must be a JSON object.') as Error & { code?: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

function headerMap(req: IncomingMessage): Record<string, string | undefined> {
  const output: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    output[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return output;
}

function remoteAddressFor(req: IncomingMessage): string {
  const socket = req.socket;
  return socket && typeof socket.remoteAddress === 'string' ? socket.remoteAddress : '';
}

function recordAutomationWebhookAppLog(store: JoiSQLiteStore, logger: Pick<Console, 'warn'>, input: AutomationWebhookAppLogInput): void {
  try {
    store.recordAppLog(input);
  } catch (error) {
    logger.warn('automation webhook app log write failed', error);
  }
}
