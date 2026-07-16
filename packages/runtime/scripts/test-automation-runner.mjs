import assert from 'node:assert/strict';
import {
  automationTaskCompletionFailure,
  apiErrorShape,
  apiShape,
  computeNextAutomationFire,
  computeNextRRuleFire,
  createWebhookSignature,
  renderAutomationPrompt,
  scheduleDedupKey,
  shouldCoalesceMissedFire,
  verifyWebhookSignature,
  webhookDedupKey,
} from '../src/automation.ts';

const base = new Date('2026-01-01T00:00:00.000Z');

assert.equal(automationTaskCompletionFailure(undefined), undefined);
assert.equal(automationTaskCompletionFailure({ status: 'completed', verification: { status: 'passed' } }), undefined);
assert.deepEqual(
  automationTaskCompletionFailure({
    status: 'blocked',
    terminal_status: 'blocked',
    verification: { status: 'failed', summary: 'Verification failed.' },
  }),
  { code: 'TASK_VERIFICATION_FAILED', message: 'Verification failed.' },
);

assert.equal(
  computeNextAutomationFire({ type: 'cron', expression: '*/5 * * * *', timezone: 'UTC' }, base),
  '2026-01-01T00:05:00.000Z',
);

assert.equal(
  computeNextAutomationFire({ type: 'interval', every_seconds: 60 }, base, { last_fire_at: '2025-12-31T23:59:30.000Z' }),
  '2026-01-01T00:00:30.000Z',
);

assert.equal(
  computeNextAutomationFire({ type: 'daily', time: '09:30', timezone: 'UTC' }, base),
  '2026-01-01T09:30:00.000Z',
);

assert.equal(
  computeNextAutomationFire({ type: 'weekly', weekday: 'friday', time: '10:00', timezone: 'UTC' }, base),
  '2026-01-02T10:00:00.000Z',
);

assert.equal(
  computeNextRRuleFire('FREQ=DAILY;BYHOUR=9;BYMINUTE=30;BYSECOND=0', base, { timezone: 'UTC' }),
  '2026-01-01T09:30:00.000Z',
);
assert.equal(
  computeNextRRuleFire('DTSTART:20260101T013000\nRRULE:FREQ=HOURLY;INTERVAL=6;BYMINUTE=30;BYSECOND=0', new Date('2026-01-01T02:00:00.000Z'), { timezone: 'UTC' }),
  '2026-01-01T07:30:00.000Z',
);
assert.equal(
  computeNextRRuleFire('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=0;BYSECOND=0', new Date('2026-01-02T09:00:00.000Z'), { timezone: 'UTC' }),
  '2026-01-05T08:00:00.000Z',
);
assert.equal(
  computeNextRRuleFire('DTSTART:20260102T120000\nRRULE:FREQ=DAILY;COUNT=1', base, { timezone: 'UTC' }),
  '2026-01-02T12:00:00.000Z',
);

assert.equal(computeNextAutomationFire({ type: 'once', run_at: '2025-12-31T00:00:00.000Z' }, base), undefined);
assert.equal(shouldCoalesceMissedFire('2025-12-31T23:00:00.000Z', base), true);
assert.equal(shouldCoalesceMissedFire('2026-01-01T01:00:00.000Z', base), false);
assert.equal(scheduleDedupKey('auto_a', '2026-01-01T00:00:00.000Z'), 'schedule:auto_a:2026-01-01T00:00:00.000Z');

const prompt = renderAutomationPrompt('Hello {{payload.user.name}} {{payload.secret}} {{env.HOME}} {{automation.name}}', {
  automation: { name: 'Daily' },
  trigger: { dedup_key: 'd1' },
  payload: { user: { name: 'Hao' }, secret: 'explicit' },
});
assert.equal(prompt, 'Hello Hao explicit  Daily');

const body = JSON.stringify({ event_id: 'evt_1', value: 42 });
const timestamp = 1770000000;
const secret = 'test-secret';
const signature = createWebhookSignature(secret, timestamp, body);
assert.equal(
  verifyWebhookSignature({
    header: `t=${timestamp},v1=${signature}`,
    secret,
    rawBody: body,
    nowSeconds: timestamp + 10,
  }).ok,
  true,
);
assert.equal(
  verifyWebhookSignature({
    header: `t=${timestamp},v1=${signature}`,
    secret,
    rawBody: body,
    nowSeconds: timestamp + 600,
  }).error_code,
  'STALE_SIGNATURE',
);
assert.equal(
  verifyWebhookSignature({
    header: `t=${timestamp},v1=00${signature.slice(2)}`,
    secret,
    rawBody: body,
    nowSeconds: timestamp + 10,
  }).error_code,
  'BAD_SIGNATURE',
);

assert.equal(
  webhookDedupKey({
    headers: { 'X-Joi-Delivery-Id': 'delivery_1' },
    payload: { event_id: 'evt_1' },
    rawBody: body,
    jsonField: 'event_id',
  }),
  'delivery:delivery_1',
);
assert.equal(
  webhookDedupKey({
    headers: {},
    payload: { event_id: 'evt_1' },
    rawBody: body,
    jsonField: 'event_id',
  }),
  'json:event_id:evt_1',
);
assert.match(
  webhookDedupKey({
    headers: {},
    payload: {},
    rawBody: body,
  }),
  /^body:[a-f0-9]{64}$/,
);

assert.deepEqual(apiShape('trace_1', { id: 'ok' }), { ok: true, data: { id: 'ok' }, error: null, trace_id: 'trace_1' });
assert.deepEqual(apiErrorShape('trace_2', 'BAD_SIGNATURE', 'bad'), {
  ok: false,
  data: null,
  error: { code: 'BAD_SIGNATURE', message: 'bad', details: {} },
  trace_id: 'trace_2',
});

console.log('automation runtime tests passed');
