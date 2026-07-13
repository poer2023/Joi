import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../src/sqlite.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-notification-delivery-'));

try {
  const store = new JoiSQLiteStore({
    dbPath: join(tempDir, 'joi.db'),
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'test',
  });
  try {
    const chat = await store.sendDeterministicChat({
      message: 'notification delivery audit smoke',
      runtime_mode: 'tool_calling',
      input_mode: 'chat_assist',
    });
    const notificationID = 'notif_tg_store_success';
    const firstClaim = store.claimOutboundNotificationDelivery({
      id: notificationID,
      dedup_key: 'automation:auto_store:trigger:one:success',
      run_id: chat.run_id,
      conversation_id: chat.conversation_id,
      channel: 'telegram',
      target: '1234567890',
      summary: 'store success',
      metadata: { origin: 'automation' },
    });
    assert.equal(firstClaim.claimed, true);
    assert.equal(firstClaim.status, 'sending');
    const duplicateClaim = store.claimOutboundNotificationDelivery({
      id: notificationID,
      dedup_key: 'automation:auto_store:trigger:one:success',
      run_id: chat.run_id,
      conversation_id: chat.conversation_id,
      channel: 'telegram',
      target: '1234567890',
    });
    assert.equal(duplicateClaim.claimed, false, 'the deterministic delivery id must suppress duplicates');
    const delivered = store.completeOutboundNotificationDelivery({
      id: notificationID,
      run_id: chat.run_id,
      external_delivery_id: 'telegram:1234567890:42',
      target: '1234567890',
      summary: 'store success',
    });
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.external_delivery_id, 'telegram:1234567890:42');
    assert.equal(store.getRunTrace(chat.run_id).events?.some((event) => event.event_type === 'notification.sent' && event.item_id === notificationID), true);

    const failedID = 'notif_tg_store_failure';
    assert.equal(store.claimOutboundNotificationDelivery({
      id: failedID,
      dedup_key: 'automation:auto_store:trigger:two:success',
      run_id: chat.run_id,
      conversation_id: chat.conversation_id,
      channel: 'telegram',
      target: '1234567890',
      summary: 'store failure',
    }).claimed, true);
    const failed = store.failOutboundNotificationDelivery({
      id: failedID,
      run_id: chat.run_id,
      target: '1234567890',
      error_code: 'TELEGRAM_API_ERROR',
      error_message: 'Unauthorized [redacted]',
      summary: 'store failure',
    });
    assert.equal(failed.status, 'send_failed');
    assert.equal(failed.metadata.error_message, 'Unauthorized [redacted]');
    assert.equal(store.getRunTrace(chat.run_id).events?.some((event) => event.event_type === 'notification.failed' && event.item_id === failedID), true);

    const retryID = 'notif_tg_store_retry';
    const retryRequest = {
      id: retryID,
      dedup_key: 'automation:auto_store:trigger:retry:success',
      run_id: chat.run_id,
      conversation_id: chat.conversation_id,
      channel: 'telegram',
      target: '1234567890',
      summary: 'store retry',
      max_attempts: 2,
      backoff_seconds: [0],
      metadata: { origin: 'automation', delivery_payload: { text: 'retry payload', disable_link_preview: false } },
    };
    assert.equal(store.claimOutboundNotificationDelivery(retryRequest).claimed, true);
    const retryFailed = store.failOutboundNotificationDelivery({
      id: retryID,
      run_id: chat.run_id,
      target: '1234567890',
      error_code: 'TELEGRAM_API_RETRYABLE',
      error_message: 'Service unavailable',
      summary: 'store retry',
      retryable: true,
    });
    assert.equal(retryFailed.status, 'send_failed');
    assert.equal(retryFailed.metadata.attempt_count, 1);
    assert.equal(retryFailed.metadata.retryable, 1);
    assert.equal(store.listDueOutboundNotificationRetries({ channel: 'telegram' }).some((item) => item.id === retryID), true);
    const retryClaim = store.claimOutboundNotificationDelivery(retryRequest);
    assert.equal(retryClaim.claimed, true, 'a due transient failure must be reclaimed');
    assert.equal(retryClaim.delivery.metadata.attempt_count, 2);
    assert.equal(store.completeOutboundNotificationDelivery({
      id: retryID,
      run_id: chat.run_id,
      external_delivery_id: 'telegram:1234567890:43',
      target: '1234567890',
      summary: 'store retry',
    }).status, 'delivered');
    assert.equal(store.claimOutboundNotificationDelivery(retryRequest).claimed, false, 'a delivered retry record must never be reclaimed');
    assert.equal(store.getRunTrace(chat.run_id).events?.some((event) => event.event_type === 'notification.retrying' && event.item_id === retryID), true);

    const automation = store.saveAutomation({
      kind: 'schedule',
      name: 'Atomic notification outbox',
      trigger_config: { type: 'interval', every_minutes: 60 },
      prompt_template: 'atomic outbox test',
      notification_policy: { channel: 'telegram' },
    });
    const trigger = store.enqueueAutomationTrigger({
      automation_id: automation.id,
      trigger_type: 'manual',
      dedup_key: 'atomic-outbox-trigger',
      fire_at: new Date(Date.now() - 1_000).toISOString(),
    }).trigger;
    const claimedTrigger = store.claimDueAutomationTrigger(new Date().toISOString());
    assert.equal(claimedTrigger.trigger.id, trigger.id);
    const automationRun = store.recordAutomationRunStarted({
      automation_id: automation.id,
      trigger_id: trigger.id,
      run_id: chat.run_id,
    });
    const atomicNotificationID = 'notif_tg_atomic_outbox';
    store.recordAutomationRunCompleted({
      automation_run_id: automationRun.id,
      run_id: chat.run_id,
      output_summary: 'atomic outbox complete',
      notification_delivery: {
        id: atomicNotificationID,
        dedup_key: 'automation:atomic:success',
        run_id: chat.run_id,
        conversation_id: chat.conversation_id,
        channel: 'telegram',
        target: '1234567890',
        summary: 'atomic outbox complete',
        metadata: { origin: 'automation', delivery_payload: { text: 'atomic outbox complete' } },
      },
    });
    assert.equal(store.listAutomationRuns({ automation_id: automation.id }).runs[0].status, 'succeeded');
    assert.equal(store.getOutboundNotificationDelivery(atomicNotificationID).status, 'pending', 'automation success and its durable outbox row must commit together');
    assert.equal(store.listDueOutboundNotificationRetries({ channel: 'telegram' }).some((item) => item.id === atomicNotificationID), true);
    assert.equal(store.getRunTrace(chat.run_id).events.some((event) => event.event_type === 'notification.queued' && event.item_id === atomicNotificationID), true);

    const leaseClaim = store.claimOutboundNotificationDelivery({
      id: atomicNotificationID,
      dedup_key: 'automation:atomic:success',
      run_id: chat.run_id,
      conversation_id: chat.conversation_id,
      channel: 'telegram',
      target: '1234567890',
    });
    assert.equal(leaseClaim.claimed, true);
    assert.equal(leaseClaim.delivery.status, 'sending');
    assert.ok(leaseClaim.delivery.metadata.lease_expires_at);
    const reclaimed = store.reclaimExpiredOutboundNotificationLeases({
      channel: 'telegram',
      now: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(reclaimed.some((delivery) => delivery.id === atomicNotificationID), true);
    assert.equal(store.getOutboundNotificationDelivery(atomicNotificationID).status, 'acceptance_unknown');
    assert.equal(store.listDueOutboundNotificationRetries({ channel: 'telegram' }).some((item) => item.id === atomicNotificationID), false, 'an expired send lease must be reclaimed for diagnosis, never blindly resent');
    assert.equal(store.getRunTrace(chat.run_id).events.some((event) => event.event_type === 'notification.delivery_unknown' && event.item_id === atomicNotificationID), true);

    const auditFailureID = 'notif_tg_confirmed_audit_failure';
    assert.equal(store.claimOutboundNotificationDelivery({
      id: auditFailureID,
      dedup_key: 'automation:audit-failure:success',
      run_id: chat.run_id,
      conversation_id: chat.conversation_id,
      channel: 'telegram',
      target: '1234567890',
    }).claimed, true);
    const auditFailure = store.failOutboundNotificationDelivery({
      id: auditFailureID,
      run_id: chat.run_id,
      target: '1234567890',
      error_code: 'TELEGRAM_ACCEPTANCE_UNKNOWN_PERSISTENCE',
      error_message: 'Telegram returned message_id but local completion audit failed.',
      external_delivery_id: 'telegram:1234567890:99',
      acceptance_unknown: true,
    });
    assert.equal(auditFailure.status, 'acceptance_unknown');
    assert.equal(auditFailure.external_delivery_id, 'telegram:1234567890:99');
    assert.equal(auditFailure.metadata.acceptance, 'confirmed');
    assert.equal(auditFailure.metadata.retryable, 0);
    assert.equal(store.listDueOutboundNotificationRetries({ channel: 'telegram' }).some((item) => item.id === auditFailureID), false);
    console.log('notification delivery store tests passed');
  } finally {
    store.close();
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
