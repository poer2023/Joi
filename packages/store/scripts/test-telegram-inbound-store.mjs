import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../src/sqlite.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-telegram-inbound-'));
const options = {
  dbPath: join(tempDir, 'joi.db'),
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(tempDir, 'logs'),
  backupDir: join(tempDir, 'backups'),
  version: 'test',
};

let store;
try {
  store = new JoiSQLiteStore(options);
  const persisted = store.persistTelegramInboundUpdates([{
    update_id: 100,
    message_id: 10,
    chat_id: 1234567890,
    from_id: 1234567890,
    chat_type: 'private',
    text: 'first durable Telegram task',
  }]);
  assert.deepEqual(persisted, { inserted: 1, offset: 101 });
  assert.deepEqual(store.persistTelegramInboundUpdates([{ update_id: 100, text: 'duplicate' }]), { inserted: 0, offset: 101 });
  assert.equal(store.getTelegramInboundOffset(), 101);
  assert.equal(store.claimTelegramInboundUpdate().update_id, 100);
  store.markTelegramInboundModelStarted(100);
  const response = await store.sendDeterministicChat({
    channel: 'telegram',
    message: 'durable inbound response source',
    runtime_mode: 'tool_calling',
  });
  store.attachTelegramInboundRun(100, response.run_id);
  store.markTelegramInboundReplyPending({ update_id: 100, response_text: response.response, run_id: response.run_id });
  assert.equal(store.claimTelegramInboundReply().update_id, 100);
  store.completeTelegramInboundUpdate({ update_id: 100, external_delivery_id: 'telegram:1234567890:10' });
  assert.equal(store.getTelegramInboundUpdate(100).status, 'completed');
  assert.equal(store.claimTelegramInboundUpdate(), undefined, 'completed update must never invoke the model again');

  store.persistTelegramInboundUpdates([{
    update_id: 101,
    message_id: 11,
    chat_id: 1234567890,
    from_id: 1234567890,
    chat_type: 'private',
    text: 'crash before model boundary',
  }]);
  assert.equal(store.claimTelegramInboundUpdate().update_id, 101);
  store.close();
  store = new JoiSQLiteStore(options);
  assert.equal(store.getTelegramInboundUpdate(101).status, 'pending', 'a pre-model claim is safe to recover');
  assert.equal(store.claimTelegramInboundUpdate().update_id, 101);
  store.completeTelegramInboundUpdate({ update_id: 101 });

  const recoverableResponse = await store.sendDeterministicChat({
    channel: 'telegram',
    message: 'completed model response recoverable after crash',
    runtime_mode: 'tool_calling',
  });
  store.persistTelegramInboundUpdates([{
    update_id: 102,
    message_id: 12,
    chat_id: 1234567890,
    from_id: 1234567890,
    chat_type: 'private',
    text: 'recover completed response without rerunning model',
  }]);
  assert.equal(store.claimTelegramInboundUpdate().update_id, 102);
  store.markTelegramInboundModelStarted(102);
  store.attachTelegramInboundRun(102, recoverableResponse.run_id);
  store.close();
  store = new JoiSQLiteStore(options);
  const recovered = store.getTelegramInboundUpdate(102);
  assert.equal(recovered.status, 'reply_pending');
  assert.equal(recovered.response_text, recoverableResponse.response);
  assert.equal(recovered.run_id, recoverableResponse.run_id);
  assert.equal(store.claimTelegramInboundUpdate(), undefined, 'recovered response must not start a second model run');
  assert.equal(store.claimTelegramInboundReply().update_id, 102);
  store.completeTelegramInboundUpdate({ update_id: 102, external_delivery_id: 'telegram:1234567890:12' });

  store.persistTelegramInboundUpdates([{
    update_id: 103,
    message_id: 13,
    chat_id: 1234567890,
    from_id: 1234567890,
    chat_type: 'private',
    text: 'unknown model outcome',
  }]);
  assert.equal(store.claimTelegramInboundUpdate().update_id, 103);
  store.markTelegramInboundModelStarted(103);
  store.close();
  store = new JoiSQLiteStore(options);
  assert.equal(store.getTelegramInboundUpdate(103).status, 'failed');
  assert.equal(store.getTelegramInboundUpdate(103).error_code, 'TELEGRAM_MODEL_OUTCOME_UNKNOWN');
  assert.equal(store.claimTelegramInboundUpdate(), undefined, 'unknown model outcome must be terminal, not rerun');

  store.persistTelegramInboundUpdates([{
    update_id: 104,
    message_id: 14,
    chat_id: 1234567890,
    from_id: 1234567890,
    chat_type: 'private',
    text: '/joi_status',
  }]);
  assert.equal(store.claimTelegramInboundUpdate().update_id, 104);
  store.markTelegramInboundReplyPending({ update_id: 104, response_text: 'status response' });
  assert.equal(store.claimTelegramInboundReply().update_id, 104);
  store.close();
  store = new JoiSQLiteStore(options);
  assert.equal(store.getTelegramInboundUpdate(104).status, 'reply_ambiguous');
  assert.equal(store.claimTelegramInboundReply(), undefined, 'reply with ambiguous acceptance must never be resent');
  assert.equal(store.getTelegramInboundOffset(), 105, 'durable Telegram offset must survive restarts');

  console.log('telegram inbound durability store tests passed');
} finally {
  try { store?.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
}
