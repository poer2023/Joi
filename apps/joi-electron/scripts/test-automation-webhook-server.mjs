import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../..');
const outDir = mkdtempSync(join(tmpdir(), 'joi-automation-webhook-'));
const esbuildBin = [
  join(root, 'node_modules', '.pnpm', 'esbuild@0.27.7', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  join(root, 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild'),
  join(root, 'node_modules', '.bin', 'esbuild'),
].find((candidate) => existsSync(candidate)) || 'node_modules/.bin/esbuild';

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `
    export { AutomationWebhookServer, automationWebhookSecretRef } from '${root}/apps/joi-electron/src/main/automation-webhook.ts';
    export { createWebhookSignature } from '${root}/packages/runtime/src/automation.ts';
  `);
  execFileSync(esbuildBin, [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2020',
    '--outfile=' + bundle,
  ], { cwd: root, stdio: 'inherit' });

  const { AutomationWebhookServer, automationWebhookSecretRef, createWebhookSignature } = await import(pathToFileURL(bundle).href);
  const secret = 'webhook-test-secret';
  const automations = new Map();
  const triggers = new Map();
  let requestDrainCount = 0;

  function addAutomation(id, slug, enabled = true, secretConfigured = true) {
    const automation = {
      id,
      kind: 'webhook',
      slug,
      name: slug,
      enabled,
      trigger_config: { dedup_json_field: 'event_id' },
      prompt_template: 'Webhook {{payload.event_id}}',
      input_mode: 'background_task',
      permission_profile: 'read_only',
      preferred_node: 'main-node',
      allow_worker: false,
      conversation_id: undefined,
      principal_id: undefined,
      dedup_policy: { dedup_json_field: 'event_id' },
      retry_policy: {},
      max_concurrency: 1,
      notification_policy: {},
      metadata: {},
    };
    automations.set(id, automation);
    automations.set(slug, automation);
    if (secretConfigured) secretsByRef.set(automationWebhookSecretRef(id), secret);
    return automation;
  }

  const secretsByRef = new Map();
  const valid = addAutomation('auto_valid', 'valid-hook');
  const rate = addAutomation('auto_rate', 'rate-hook');
  const disabled = addAutomation('auto_disabled', 'disabled-hook', false);
  addAutomation('auto_missing_secret', 'missing-secret-hook', true, false);

  const store = {
    getAutomation(id) {
      const automation = automations.get(String(id));
      if (!automation) throw new Error(`Automation not found: ${id}`);
      return automation;
    },
    enqueueAutomationTrigger(req) {
      const key = `${req.automation_id}:${req.dedup_key}`;
      const existing = triggers.get(key);
      if (existing) return { trigger: existing, deduped: true };
      const trigger = {
        id: `trigger_${triggers.size + 1}`,
        automation_id: req.automation_id,
        trigger_type: req.trigger_type || 'webhook',
        dedup_key: req.dedup_key,
        payload: req.payload || {},
        status: 'pending',
        fire_at: req.fire_at,
        attempt_count: 0,
      };
      triggers.set(key, trigger);
      return { trigger, deduped: false };
    },
  };
  const secrets = {
    async resolve(name) {
      return secretsByRef.get(String(name)) || '';
    },
  };
  const server = new AutomationWebhookServer({
    store,
    secrets,
    runner: { requestDrain: () => { requestDrainCount += 1; } },
    addr: '127.0.0.1:0',
    logger: { info() {}, warn() {}, error() {} },
  });

  await server.start();
  const base = server.urlBase();

  async function post(slug, body, options = {}) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const signature = options.signature ?? createWebhookSignature(options.secret || secret, timestamp, rawBody);
    const response = await fetch(`${base}/automation/webhooks/${slug}`, {
      method: options.method || 'POST',
      headers: {
        'content-type': options.contentType ?? 'application/json',
        'x-joi-signature': `t=${timestamp},v1=${signature}`,
        ...(options.deliveryID ? { 'x-joi-delivery-id': options.deliveryID } : {}),
        ...(options.authorization ? { authorization: options.authorization } : {}),
      },
      body: rawBody,
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    {
      const response = await post('missing-hook', { event_id: 'missing' });
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    }
    {
      const response = await fetch(`${base}/automation/webhooks/${valid.slug}`, { method: 'GET' });
      assert.equal(response.status, 405);
      assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
    }
    {
      const response = await post(valid.slug, { event_id: 'valid-1', ok: true }, { deliveryID: 'delivery-1', authorization: 'Bearer secret-token' });
      assert.equal(response.status, 202);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.deduped, false);
      assert.equal(response.body.data.trigger_id, 'trigger_1');
      const trigger = [...triggers.values()].find((item) => item.id === 'trigger_1');
      assert.equal(trigger.payload._webhook.headers.authorization, '[redacted]');
      assert.equal(trigger.payload._webhook.headers['x-joi-signature'], '[redacted]');
    }
    {
      const response = await post(valid.slug, { event_id: 'valid-1', ok: true }, { deliveryID: 'delivery-1' });
      assert.equal(response.status, 202);
      assert.equal(response.body.data.deduped, true);
      assert.equal(response.body.data.trigger_id, 'trigger_1');
    }
    {
      const response = await post(valid.slug, { event_id: 'bad-signature' }, { signature: '00'.repeat(32) });
      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'BAD_SIGNATURE');
    }
    {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
      const response = await post(valid.slug, { event_id: 'stale' }, { timestamp: staleTimestamp });
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, 'STALE_SIGNATURE');
    }
    {
      const response = await post(valid.slug, 'not-json');
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'INVALID_PAYLOAD');
    }
    {
      const response = await post(valid.slug, { event_id: 'text' }, { contentType: 'text/plain' });
      assert.equal(response.status, 415);
      assert.equal(response.body.error.code, 'INVALID_PAYLOAD');
    }
    {
      const response = await post(valid.slug, JSON.stringify({ body: 'x'.repeat(256 * 1024) }));
      assert.equal(response.status, 413);
      assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
    }
    {
      const response = await post(disabled.slug, { event_id: 'disabled' });
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'AUTOMATION_DISABLED');
    }
    {
      const response = await post('missing-secret-hook', { event_id: 'missing-secret' });
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, 'WEBHOOK_SECRET_MISSING');
    }
    for (let index = 0; index < 60; index += 1) {
      const response = await post(rate.slug, { event_id: `rate-${index}` });
      assert.equal(response.status, 202);
    }
    {
      const response = await post(rate.slug, { event_id: 'rate-limited' });
      assert.equal(response.status, 429);
      assert.equal(response.body.error.code, 'RATE_LIMITED');
    }
    assert.ok(requestDrainCount >= 62);
    console.log('automation webhook server tests passed');
  } finally {
    await server.close();
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
