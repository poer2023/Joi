import assert from 'node:assert/strict';
import {
  apiErrorShape,
  apiShape,
  computeNextAutomationFire,
  createWebhookSignature,
  renderAutomationPrompt,
  scheduleDedupKey,
  shouldCoalesceMissedFire,
  verifyWebhookSignature,
  webhookDedupKey,
} from '../src/automation.ts';

const base = new Date('2026-01-01T00:00:00.000Z');

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
