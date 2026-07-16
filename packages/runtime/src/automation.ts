import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';

// joi-log-coverage: covered-by Electron automation runner/webhook app_logs around these pure helpers.
export type AutomationScheduleConfig = {
  type?: 'cron' | 'once' | 'interval' | 'daily' | 'weekly' | string;
  cron?: string;
  expression?: string;
  rrule?: string;
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

export type AutomationTaskCompletion = {
  status?: string;
  terminal_status?: string;
  terminal_reason?: string;
  verification?: {
    status?: string;
    summary?: string;
  };
};

export function automationTaskCompletionFailure(task: AutomationTaskCompletion | undefined): { code: string; message: string } | undefined {
  if (!task) return undefined;
  const status = String(task.status || '').trim().toLowerCase();
  const terminalStatus = String(task.terminal_status || '').trim().toLowerCase();
  const verificationStatus = String(task.verification?.status || '').trim().toLowerCase();
  if (status !== 'blocked' && terminalStatus !== 'blocked' && verificationStatus !== 'failed') return undefined;
  return {
    code: 'TASK_VERIFICATION_FAILED',
    message: task.verification?.summary?.trim()
      || task.terminal_reason?.trim()
      || 'Automation task verification failed.',
  };
}

export function computeNextAutomationFire(
  config: AutomationScheduleConfig,
  from: Date = new Date(),
  options: { timezone?: string; last_fire_at?: string } = {},
): string | undefined {
  const type = String(config.type || (config.rrule ? 'rrule' : config.cron || config.expression ? 'cron' : 'once')).toLowerCase();
  const timezone = String(config.timezone || options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  if (type === 'rrule' || config.rrule) {
    return computeNextRRuleFire(String(config.rrule || config.expression || ''), from, {
      timezone,
      last_fire_at: options.last_fire_at,
    });
  }
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

export function computeNextRRuleFire(
  value: string,
  from: Date = new Date(),
  options: { timezone?: string; last_fire_at?: string } = {},
): string | undefined {
  const parsed = parseRRule(value);
  if (!parsed.FREQ) throw new Error('automation RRULE requires FREQ');
  const timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dtstart = parseRRuleDate(parsed.DTSTART, timezone);
  const count = positiveRRuleInteger(parsed.COUNT, 0);
  if (count === 1) {
    if (options.last_fire_at) return undefined;
    return dtstart && dtstart > from ? dtstart.toISOString() : undefined;
  }
  const until = parseRRuleDate(parsed.UNTIL, timezone);
  const anchor = dtstart || parseDate(options.last_fire_at) || from;
  const interval = positiveRRuleInteger(parsed.INTERVAL, 1);
  const expression = cronExpressionForRRule(parsed, anchor, timezone);
  let cursor = dtstart && dtstart > from
    ? new Date(dtstart.getTime() - 60_000)
    : from;
  const iterator = CronExpressionParser.parse(expression, { currentDate: cursor, tz: timezone });
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const candidate = iterator.next().toDate();
    if (dtstart && candidate < dtstart) continue;
    if (until && candidate > until) return undefined;
    if (!rruleIntervalMatches(parsed.FREQ, candidate, anchor, interval, timezone)) continue;
    return candidate.toISOString();
  }
  throw new Error('automation RRULE did not produce a bounded next occurrence');
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

type ParsedRRule = Record<string, string>;

function parseRRule(value: string): ParsedRRule {
  const parsed: ParsedRRule = {};
  for (const rawLine of value.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^DTSTART(?:;[^:]*)?:/i.test(line)) {
      parsed.DTSTART = line.slice(line.indexOf(':') + 1).trim();
      continue;
    }
    const body = line.replace(/^RRULE:/i, '');
    for (const part of body.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 1) continue;
      parsed[part.slice(0, separator).trim().toUpperCase()] = part.slice(separator + 1).trim();
    }
  }
  return parsed;
}

function cronExpressionForRRule(rule: ParsedRRule, anchor: Date, timezone: string): string {
  const frequency = rule.FREQ.toUpperCase();
  const anchorParts = zonedDateParts(anchor, timezone);
  const minutes = rruleNumberList(rule.BYMINUTE, 0, 59, [anchorParts.minute]);
  const hours = rruleNumberList(rule.BYHOUR, 0, 23, [anchorParts.hour]);
  const weekdays = rruleWeekdays(rule.BYDAY);
  const monthDays = rruleNumberList(rule.BYMONTHDAY, 1, 31, [anchorParts.day]);
  if (frequency === 'MINUTELY') return `* * * * ${weekdays || '*'}`;
  if (frequency === 'HOURLY') return `${minutes.join(',')} * * * ${weekdays || '*'}`;
  if (frequency === 'DAILY') return `${minutes.join(',')} ${hours.join(',')} * * ${weekdays || '*'}`;
  if (frequency === 'WEEKLY') return `${minutes.join(',')} ${hours.join(',')} * * ${weekdays || weekdayNumber(anchorParts.weekday)}`;
  if (frequency === 'MONTHLY') return `${minutes.join(',')} ${hours.join(',')} ${monthDays.join(',')} * ${weekdays || '*'}`;
  throw new Error(`unsupported automation RRULE frequency: ${frequency}`);
}

function rruleIntervalMatches(frequency: string, candidate: Date, anchor: Date, interval: number, timezone: string): boolean {
  if (interval <= 1) return true;
  const candidateParts = zonedDateParts(candidate, timezone);
  const anchorParts = zonedDateParts(anchor, timezone);
  const candidateDay = Date.UTC(candidateParts.year, candidateParts.month - 1, candidateParts.day) / 86_400_000;
  const anchorDay = Date.UTC(anchorParts.year, anchorParts.month - 1, anchorParts.day) / 86_400_000;
  let distance = 0;
  switch (frequency.toUpperCase()) {
    case 'MINUTELY':
      distance = Math.floor((candidate.getTime() - anchor.getTime()) / 60_000);
      break;
    case 'HOURLY':
      distance = Math.floor((candidate.getTime() - anchor.getTime()) / 3_600_000);
      break;
    case 'DAILY':
      distance = candidateDay - anchorDay;
      break;
    case 'WEEKLY':
      distance = Math.floor(candidateDay / 7) - Math.floor(anchorDay / 7);
      break;
    case 'MONTHLY':
      distance = candidateParts.year * 12 + candidateParts.month - (anchorParts.year * 12 + anchorParts.month);
      break;
    default:
      return false;
  }
  return distance >= 0 && distance % interval === 0;
}

function rruleNumberList(value: string | undefined, min: number, max: number, fallback: number[]): number[] {
  const values = String(value || '').split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= min && item <= max);
  return values.length > 0 ? [...new Set(values)] : fallback;
}

function rruleWeekdays(value: string | undefined): string {
  const mapped = String(value || '').split(',')
    .map((item) => item.trim().toUpperCase().replace(/^[+-]?\d+/, ''))
    .map((item) => ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 })[item])
    .filter((item): item is number => item !== undefined);
  return [...new Set(mapped)].join(',');
}

function weekdayNumber(value: string): number {
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[value] ?? 1;
}

function positiveRRuleInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRRuleDate(value: string | undefined, timezone: string): Date | undefined {
  if (!value) return undefined;
  if (/^\d{8}T\d{6}Z$/i.test(value)) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(value);
    if (!match) return undefined;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/i.exec(value);
  if (!match) return parseDate(value);
  return zonedDateFromParts({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  }, timezone);
}

function zonedDateFromParts(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timezone: string): Date {
  const wallClockUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = new Date(wallClockUTC);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedDateParts(candidate, timezone);
    const observedUTC = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const correction = wallClockUTC - observedUTC;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

function zonedDateParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    second: Number(value('second')),
    weekday: value('weekday'),
  };
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
