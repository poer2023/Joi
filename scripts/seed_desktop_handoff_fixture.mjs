import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../packages/store/src/sqlite.ts';

const root = resolve(import.meta.dirname, '..');
const dbPath = process.argv[2] ? resolve(process.argv[2]) : '';
const evidencePath = process.argv[3] ? resolve(process.argv[3]) : '';

if (!dbPath) {
  console.error('usage: node --experimental-strip-types scripts/seed_desktop_handoff_fixture.mjs <sqlite-path> [evidence-json-path]');
  process.exit(2);
}

mkdirSync(dirname(dbPath), { recursive: true });
const store = new JoiSQLiteStore({
  dbPath,
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(dirname(dbPath), 'logs'),
  backupDir: join(dirname(dbPath), 'backups'),
  version: 'e2e-handoff-fixture',
});

try {
  store['exec']('PRAGMA busy_timeout=5000');
  store['exec'](
    `INSERT INTO desktop_settings(key,value,updated_at)
     VALUES('onboarding.completed','true',datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='true', updated_at=datetime('now')`,
  );

  const suffix = Date.now().toString(36);
  const conversationID = `conv_e2e_tg_handoff_${suffix}`;
  const telegramChat = store.recordToolCallingChat({
    conversation_id: conversationID,
    channel: 'telegram',
    user_id: 'telegram:e2e-user',
    message: '从 Telegram 开始一个 Joi 跨入口任务：整理本地闭环验收证据。',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'e2e-handoff-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'e2e-handoff-model',
    selected_agent_id: 'general_agent',
    final_message: 'Telegram entry created a Desktop-visible task.',
    tool_results: [],
    usage: { input_tokens: 12, output_tokens: 8 },
    model_responses: [{ id: `chatcmpl_tg_handoff_${suffix}`, choices: [{ message: { content: 'Telegram entry created a Desktop-visible task.' } }] }],
  });
  const telegramTrace = store.getRunTrace(telegramChat.run_id);
  const productTaskID = telegramChat.product_task?.id || '';
  const principalID = telegramTrace.principal_id || '';
  assert.ok(productTaskID, 'telegram handoff run must create a product task');
  assert.ok(principalID, 'telegram handoff run must resolve a principal');
  assert.equal(telegramTrace.entry_channel, 'telegram');
  assert.ok(telegramTrace.events?.some((event) => event.event_type === 'handoff.linked' || event.event_type === 'handoff.created'), 'telegram run must record a handoff event');

  const desktopChat = store.recordToolCallingChat({
    conversation_id: conversationID,
    channel: 'desktop',
    user_id: 'desktop_user',
    principal_id: principalID,
    product_task_id: productTaskID,
    message: '在桌面继续刚才 Telegram 的任务，并确认它没有创建重复任务。',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'e2e-handoff-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'e2e-handoff-model',
    selected_agent_id: 'general_agent',
    final_message: 'Desktop continued the same Telegram-originated task.',
    tool_results: [],
    usage: { input_tokens: 10, output_tokens: 8 },
    model_responses: [{ id: `chatcmpl_desktop_handoff_${suffix}`, choices: [{ message: { content: 'Desktop continued the same Telegram-originated task.' } }] }],
  });
  assert.equal(desktopChat.product_task?.id, productTaskID, 'desktop continuation must reuse the same product task');

  const desktopTrace = store.getRunTrace(desktopChat.run_id);
  assert.ok(desktopTrace.events?.some((event) => event.event_type === 'handoff.linked'), 'desktop continuation must record a linked handoff event');
  const imessageChat = store.recordToolCallingChat({
    conversation_id: conversationID,
    channel: 'imessage',
    user_id: 'imessage:+15550001111',
    principal_id: principalID,
    product_task_id: productTaskID,
    message: '从 iMessage 查询刚才同一个 Joi 跨入口任务的进展。',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'e2e-handoff-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'e2e-handoff-model',
    selected_agent_id: 'general_agent',
    final_message: 'iMessage queried the same Desktop-visible task.',
    tool_results: [],
    usage: { input_tokens: 9, output_tokens: 7 },
    model_responses: [{ id: `chatcmpl_imessage_handoff_${suffix}`, choices: [{ message: { content: 'iMessage queried the same Desktop-visible task.' } }] }],
  });
  assert.equal(imessageChat.product_task?.id, productTaskID, 'imessage progress query must reuse the same product task');

  const imessageTrace = store.getRunTrace(imessageChat.run_id);
  assert.equal(imessageTrace.entry_channel, 'imessage');
  assert.equal(imessageTrace.principal_id, principalID);
  assert.ok(imessageTrace.events?.some((event) => event.event_type === 'handoff.linked'), 'imessage continuation must record a linked handoff event');
  const principalTasks = store.listProductTasks({ principal_id: principalID, limit: 50 }).tasks.filter((task) => task.id === productTaskID);
  const conversationTasks = store.listProductTasks({ conversation_id: conversationID, limit: 50 }).tasks.filter((task) => task.id === productTaskID);
  const telegramTasks = store.listProductTasks({ channel: 'telegram', limit: 50 }).tasks.filter((task) => task.id === productTaskID);
  const imessageTasks = store.listProductTasks({ channel: 'imessage', limit: 50 }).tasks.filter((task) => task.id === productTaskID);
  assert.equal(principalTasks.length, 1, 'principal task lookup must find exactly one task');
  assert.equal(conversationTasks.length, 1, 'conversation task lookup must find exactly one task');
  assert.equal(telegramTasks.length, 1, 'telegram task lookup must find exactly one task');
  assert.equal(imessageTasks.length, 1, 'imessage task lookup must find exactly one task');

  const report = store.getRecentRunClosureReport({ limit: 25 });
  assert.ok(report.metrics.runs_with_handoff_events >= 3, 'closure report must count handoff runs');
  assert.equal(report.metrics.execution_runs_with_task_or_refusal, report.metrics.execution_runs, 'closure report must count all handoff runs as task-covered execution');
  assert.equal(report.metrics.completed_tasks_with_evidence, report.metrics.completed_tasks, 'closure report must count completed handoff task evidence');

  const evidence = {
    generated_at: new Date().toISOString(),
    sqlite_path: dbPath,
    conversation_id: conversationID,
    principal_id: principalID,
    product_task_id: productTaskID,
    telegram_run_id: telegramChat.run_id,
    desktop_run_id: desktopChat.run_id,
    imessage_run_id: imessageChat.run_id,
    no_duplicate_task: true,
    external_flows: [
      { channel: 'telegram', run_id: telegramChat.run_id, desktop_run_id: desktopChat.run_id, product_task_id: productTaskID, principal_id: principalID },
      { channel: 'imessage', run_id: imessageChat.run_id, desktop_run_id: desktopChat.run_id, product_task_id: productTaskID, principal_id: principalID },
    ],
    closure_metrics: report.metrics,
  };

  if (evidencePath) {
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  store.close();
}
