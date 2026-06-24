import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';

// joi-log-coverage: covered-by Electron automation runner/webhook app_logs around these pure helpers.
export type AutomationScheduleConfig = {
  type?: 'cron' | 'once' | 'interval' | 'daily' | 'weekly' | string;
  cron?: string;
  expression?: string;
  run_at?: string;
  at?: string;
  every_seconds?: number;
  every_minutes?: number;
  interval_seconds?: number;
  time?: string;
  weekday?: number | string;
  timezone?: string;
};

export type AutomationTemplateContext = {
  automation: Record<string, unknown>;
  trigger: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type WebhookSignatureResult = {
  ok: boolean;
  timestamp?: number;
  error_code?: string;
  message?: string;
};

export type ApiShape<T> = {
  ok: boolean;
  data: T | null;
  error: null | {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  trace_id: string;
};

export function computeNextAutomationFire(
  config: AutomationScheduleConfig,
  from: Date = new Date(),
  options: { timezone?: string; last_fire_at?: string } = {},
): string | undefined {
  const type = String(config.type || (config.cron || config.expression ? 'cron' : 'once')).toLowerCase();
  const timezone = String(config.timezone || options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  if (type === 'cron') {
    const expression = String(config.cron || config.expression || '').trim();
    assertFiveFieldCron(expression);
    return CronExpressionParser.parse(expression, { currentDate: from, tz: timezone }).next().toDate().toISOString();
  }
  if (type === 'once') {
    const runAt = parseDate(config.run_at || config.at);
    if (!runAt || runAt <= from) return undefined;
    return runAt.toISOString();
  }
  if (type === 'interval') {
    const seconds = positiveScheduleIntervalSeconds(config);
    const base = parseDate(options.last_fire_at) || parseDate(config.run_at || config.at) || from;
    const next = new Date(base.getTime() + seconds * 1000);
    while (next <= from) next.setSeconds(next.getSeconds() + seconds);
    return next.toISOString();
  }
  if (type === 'daily') {
    const { hour, minute } = parseScheduleTime(config.time || '09:00');
    return CronExpressionParser.parse(`${minute} ${hour} * * *`, { currentDate: from, tz: timezone }).next().toDate().toISOString();
  }
  if (type === 'weekly') {
    const { hour, minute } = parseScheduleTime(config.time || '09:00');
    const weekday = normalizeWeekday(config.weekday ?? 1);
    return CronExpressionParser.parse(`${minute} ${hour} * * ${weekday}`, { currentDate: from, tz: timezone }).next().toDate().toISOString();
  }
  throw new Error(`unsupported automation schedule type: ${type}`);
}

export function shouldCoalesceMissedFire(nextFireAt: string | undefined, now: Date = new Date()): boolean {
  if (!nextFireAt) return true;
  const next = parseDate(nextFireAt);
  return Boolean(next && next <= now);
}

export function scheduleDedupKey(automationID: string, fireAt: string): string {
  return `schedule:${automationID}:${fireAt}`;
}

export function renderAutomationPrompt(template: string, context: AutomationTemplateContext): string {
  const source = template.trim() || '请处理这个自动化任务。payload 摘要：{{payload}}';
  return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    if (!isAllowedTemplatePath(path)) return '';
    const value = path === 'payload'
      ? context.payload
      : path === 'automation'
        ? context.automation
        : path === 'trigger'
          ? context.trigger
          : getPathValue(context, path);
    return stringifyPromptValue(value);
  }).slice(0, 12000);
}

export function createWebhookSignature(secret: string, timestamp: number, rawBody: string | Buffer): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const payload = Buffer.concat([Buffer.from(`${timestamp}.`), body]);
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(input: {
  header?: string;
  secret: string;
  rawBody: string | Buffer;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): WebhookSignatureResult {
  const parsed = parseJoiSignatureHeader(input.header || '');
  if (!parsed.timestamp || !parsed.v1) {
    return { ok: false, error_code: 'BAD_SIGNATURE', message: 'Missing webhook signature' };
  }
  const now = input.nowSeconds || Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - parsed.timestamp);
  if (skew > (input.maxSkewSeconds ?? 300)) {
    return { ok: false, timestamp: parsed.timestamp, error_code: 'STALE_SIGNATURE', message: 'Webhook signature timestamp is stale' };
  }
  const expected = createWebhookSignature(input.secret, parsed.timestamp, input.rawBody);
  if (!safeHexEqual(expected, parsed.v1)) {
    return { ok: false, timestamp: parsed.timestamp, error_code: 'BAD_SIGNATURE', message: 'Webhook signature mismatch' };
  }
  return { ok: true, timestamp: parsed.timestamp };
}

export function webhookDedupKey(input: {
  headers: Record<string, string | undefined>;
  payload: Record<string, unknown>;
  rawBody: string | Buffer;
  jsonField?: string;
}): string {
  const deliveryID = headerValue(input.headers, 'x-joi-delivery-id');
  if (deliveryID) return `delivery:${deliveryID}`;
  if (input.jsonField) {
    const value = getPathValue({ payload: input.payload }, input.jsonField.startsWith('payload.') ? input.jsonField : `payload.${input.jsonField}`);
    if (value !== undefined && value !== null && String(value).trim()) return `json:${input.jsonField}:${String(value).trim()}`;
  }
  const body = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody);
  return `body:${createHash('sha256').update(body).digest('hex')}`;
}

export function redactWebhookHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    const value = Array.isArray(rawValue) ? rawValue.join(',') : String(rawValue || '');
    if (['authorization', 'cookie', 'x-joi-signature'].includes(lower) || lower.includes('secret')) {
      redacted[lower] = '[redacted]';
    } else {
      redacted[lower] = value;
    }
  }
  return redacted;
}

export function apiShape<T>(traceID: string, data: T): ApiShape<T> {
  return { ok: true, data, error: null, trace_id: traceID };
}

export function apiErrorShape(traceID: string, code: string, message: string, details: Record<string, unknown> = {}): ApiShape<never> {
  return {
    ok: false,
    data: null,
    error: { code, message, details },
    trace_id: traceID,
  };
}

function assertFiveFieldCron(expression: string): void {
  const parts = expression.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) throw new Error('automation cron expressions must use 5 fields');
}

function positiveScheduleIntervalSeconds(config: AutomationScheduleConfig): number {
  const seconds = Number(config.every_seconds ?? config.interval_seconds ?? Number(config.every_minutes || 0) * 60);
  if (!Number.isFinite(seconds) || seconds < 1) throw new Error('interval automation requires a positive interval');
  return Math.floor(seconds);
}

function parseScheduleTime(value: string): { hour: number; minute: number } {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`invalid schedule time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`invalid schedule time: ${value}`);
  return { hour, minute };
}

function normalizeWeekday(value: number | string): number {
  if (typeof value === 'number') return Math.max(0, Math.min(6, Math.floor(value)));
  const normalized = value.trim().toLowerCase();
  const names: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };
  if (normalized in names) return names[normalized];
  const number = Number(normalized);
  if (Number.isFinite(number)) return Math.max(0, Math.min(6, Math.floor(number)));
  return 1;
}

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function isAllowedTemplatePath(path: string): boolean {
  return path === 'payload'
    || path === 'automation'
    || path === 'trigger'
    || path.startsWith('payload.')
    || path.startsWith('automation.')
    || path.startsWith('trigger.');
}

function getPathValue(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split('.')) {
    if (!part) return undefined;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringifyPromptValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).slice(0, 4000);
}

function parseJoiSignatureHeader(header: string): { timestamp?: number; v1?: string } {
  const output: { timestamp?: number; v1?: string } = {};
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key?.trim() === 't') output.timestamp = Number(value);
    if (key?.trim() === 'v1') output.v1 = value?.trim();
  }
  return output;
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function headerValue(headers: Record<string, string | undefined>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value || '').trim();
  }
  return '';
}
