import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../packages/store/src/sqlite.ts';

const root = resolve(import.meta.dirname, '..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-live-handoff-audit-'));

try {
  const dbPath = join(tempDir, 'joi.db');
  const evidencePath = join(tempDir, 'handoff-evidence.json');
  const store = new JoiSQLiteStore({
    dbPath,
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'live-handoff-audit-test',
  });
  store.close();

  {
    const audit = runAudit(dbPath);
    assert.equal(audit.ok, true);
    assert.equal(audit.schema_current, true);
    assert.equal(audit.metrics.external_runs, 0);
    assert.equal(audit.metrics.linked_external_desktop_tasks, 0);
    assert.deepEqual(audit.pending_external_handoffs, []);
    assert.equal(audit.status, 'awaiting_external_input');
    assert.equal(audit.next_action, 'Send a real Telegram or iMessage task, then continue the same task in Desktop.');
  }

  const pendingSuffix = Date.now().toString(36);
  const pendingStore = new JoiSQLiteStore({
    dbPath,
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'live-handoff-pending-test',
  });
  let pendingChat;
  try {
    pendingChat = pendingStore.recordToolCallingChat({
      conversation_id: `conv_pending_handoff_${pendingSuffix}`,
      channel: 'telegram',
      user_id: 'telegram:pending-user',
      message: '从 Telegram 创建一个等待桌面继续的任务。',
      input_mode: 'serious_task',
      runtime_mode: 'tool_calling',
      model_name: 'e2e-handoff-model',
    }, {
      status: 'completed',
      provider: 'openai_compatible',
      model_name: 'e2e-handoff-model',
      selected_agent_id: 'general_agent',
      final_message: 'External task is waiting for Desktop continuation.',
      tool_results: [],
      usage: { input_tokens: 8, output_tokens: 6 },
      model_responses: [{ id: `chatcmpl_pending_handoff_${pendingSuffix}`, choices: [{ message: { content: 'External task is waiting for Desktop continuation.' } }] }],
    });
  } finally {
    pendingStore.close();
  }

  {
    const audit = runAudit(dbPath);
    assert.equal(audit.ok, true);
    assert.equal(audit.schema_current, true);
    assert.equal(audit.metrics.external_runs, 1);
    assert.equal(audit.metrics.linked_external_desktop_tasks, 0);
    assert.equal(audit.pending_external_handoffs.length, 1);
    assert.equal(audit.pending_external_handoffs[0].external_channel, 'telegram');
    assert.equal(audit.pending_external_handoffs[0].external_run_id, pendingChat.run_id);
    assert.equal(audit.pending_external_handoffs[0].product_task_id, pendingChat.product_task?.id);
    assert.equal(audit.status, 'awaiting_desktop_continuation');
    assert.equal(audit.next_action, 'Open Desktop recent tasks and continue the external-origin task so the same Product Task has a Desktop run.');
  }

  {
    const audit = runAudit(dbPath, ['--token=not-present-in-fixture']);
    assert.equal(audit.ok, true);
    assert.equal(audit.schema_current, true);
    assert.equal(audit.token_filter_applied, true);
    assert.equal(audit.metrics.external_runs, 0);
    assert.equal(audit.metrics.linked_external_desktop_tasks, 0);
    assert.deepEqual(audit.pending_external_handoffs, []);
    assert.equal(audit.status, 'awaiting_external_input');
  }

  const proofToken = `joi-proof-${pendingSuffix}`;
  const tokenStore = new JoiSQLiteStore({
    dbPath,
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'live-handoff-token-test',
  });
  let tokenTelegramChat;
  let tokenDesktopChat;
  try {
    tokenTelegramChat = tokenStore.recordToolCallingChat({
      conversation_id: `conv_token_handoff_${pendingSuffix}`,
      channel: 'telegram',
      user_id: 'telegram:token-user',
      message: `认真执行：Joi live handoff smoke ${proofToken}。`,
      input_mode: 'serious_task',
      runtime_mode: 'tool_calling',
      model_name: 'e2e-handoff-model',
    }, {
      status: 'completed',
      provider: 'openai_compatible',
      model_name: 'e2e-handoff-model',
      selected_agent_id: 'general_agent',
      final_message: 'External token task is waiting for Desktop continuation.',
      tool_results: [],
      usage: { input_tokens: 8, output_tokens: 6 },
      model_responses: [{ id: `chatcmpl_token_external_${pendingSuffix}`, choices: [{ message: { content: 'External token task is waiting for Desktop continuation.' } }] }],
    });
    const tokenTrace = tokenStore.getRunTrace(tokenTelegramChat.run_id);
    tokenDesktopChat = tokenStore.recordToolCallingChat({
      conversation_id: tokenTrace.conversation_id || `conv_token_handoff_${pendingSuffix}`,
      channel: 'desktop',
      user_id: 'desktop_user',
      principal_id: tokenTrace.principal_id,
      product_task_id: tokenTelegramChat.product_task?.id,
      message: '在 Desktop 继续刚才外部入口创建的 token 任务。',
      input_mode: 'serious_task',
      runtime_mode: 'tool_calling',
      model_name: 'e2e-handoff-model',
    }, {
      status: 'completed',
      provider: 'openai_compatible',
      model_name: 'e2e-handoff-model',
      selected_agent_id: 'general_agent',
      final_message: 'Desktop continued the same token task.',
      tool_results: [],
      usage: { input_tokens: 8, output_tokens: 6 },
      model_responses: [{ id: `chatcmpl_token_desktop_${pendingSuffix}`, choices: [{ message: { content: 'Desktop continued the same token task.' } }] }],
    });
  } finally {
    tokenStore.close();
  }

  {
    const audit = runAudit(dbPath, [`--token=${proofToken}`, '--require-live']);
    assert.equal(audit.ok, true);
    assert.equal(audit.schema_current, true);
    assert.equal(audit.proof_token, proofToken);
    assert.equal(audit.token_filter_applied, true);
    assert.equal(audit.metrics.external_runs, 1);
    assert.equal(audit.metrics.linked_external_desktop_tasks, 1);
    assert.equal(audit.linked_live_handoffs.length, 1);
    assert.equal(audit.linked_live_handoffs[0].external_run_id, tokenTelegramChat.run_id);
    assert.equal(audit.linked_live_handoffs[0].desktop_run_id, tokenDesktopChat.run_id);
    assert.equal(audit.linked_live_handoffs[0].product_task_id, tokenTelegramChat.product_task?.id);
    assert.equal(audit.status, 'live_handoff_linked');
  }

  execFileSync(process.execPath, [
    '--experimental-strip-types',
    join(root, 'scripts/seed_desktop_handoff_fixture.mjs'),
    dbPath,
    evidencePath,
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  {
    const audit = runAudit(dbPath, ['--require-live']);
    assert.equal(audit.ok, true);
    assert.equal(audit.schema_current, true);
    assert.ok(audit.metrics.external_runs >= 2);
    assert.ok(audit.metrics.linked_external_desktop_tasks >= 2);
    assert.equal(audit.status, 'live_handoff_linked');
    assert.equal(audit.next_action, 'Live external-to-Desktop handoff evidence is present.');
    assert.ok(audit.linked_live_handoffs.some((handoff) => handoff.external_channel === 'telegram'));
    assert.ok(audit.linked_live_handoffs.some((handoff) => handoff.external_channel === 'imessage'));
  }

  console.log('desktop live external handoff audit tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function runAudit(dbPath, extraArgs = []) {
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types',
    join(root, 'scripts/desktop_live_external_handoff_audit.mjs'),
    ...extraArgs,
  ], {
    cwd: root,
    env: {
      ...process.env,
      JOI_SQLITE_PATH: dbPath,
      JOI_USER_DATA_DIR: tempDir,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}
