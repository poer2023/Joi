import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowRunningApp = args.has('--allow-running-app');
const dbPath = resolveSQLitePath();
const backupRoot = join(dirname(dbPath), 'backups', `pre-conversation-flow-schema-${timestamp()}`);
const runningProcesses = runningJoiProcesses();

const audit = {
  ok: true,
  mode: apply ? 'apply' : 'dry-run',
  sqlite_path: dbPath,
  sqlite_exists: existsSync(dbPath),
  running_joi_processes: runningProcesses,
  backup_dir: apply ? backupRoot : '',
  before: {},
  after: {},
  applied: false,
};

if (!audit.sqlite_exists) {
  audit.ok = false;
  audit.error = 'production sqlite file does not exist';
  finish(audit);
}

let db;
try {
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  audit.before = schemaAudit(db);

  if (apply) {
    if (runningProcesses.length > 0 && !allowRunningApp) {
      audit.ok = false;
      audit.error = 'Joi.app is running; stop it first or pass --allow-running-app';
      finish(audit);
    }
    mkdirSync(backupRoot, { recursive: true });
    backupSQLiteFiles(dbPath, backupRoot);
    applyConversationClosureSchema(db);
    audit.applied = true;
    audit.after = schemaAudit(db);
  } else {
    audit.after = audit.before;
  }
} catch (error) {
  audit.ok = false;
  audit.error = error instanceof Error ? error.message : String(error);
} finally {
  db?.close();
}

finish(audit);

function finish(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
  process.exit(0);
}

function schemaAudit(db) {
  const requiredTables = ['principals', 'channel_identities', 'conversation_entry_links', 'task_entry_links', 'notification_deliveries'];
  const requiredColumns = {
    conversations: ['principal_id'],
    runs: ['principal_id', 'entry_channel', 'requested_mode', 'resolved_mode', 'mode_source', 'terminal_status', 'terminal_reason', 'resume_token', 'parent_run_id', 'redirected_from_run_id', 'cancel_requested_at', 'resumed_at'],
    turns: ['mode_resolution_id', 'user_intent_summary', 'assistant_message_id', 'stream_status', 'completed_at'],
    run_events: ['schema_version', 'conversation_id', 'item_type', 'item_id', 'parent_item_id', 'phase', 'visibility', 'source', 'terminal', 'payload_json', 'error_json', 'usage_json'],
    model_calls: ['streaming_enabled', 'first_delta_at', 'completed_at', 'finish_reason', 'usage_status', 'raw_finish_json'],
    tool_runs: ['turn_id', 'tool_call_id', 'purpose', 'approval_request_id', 'side_effect_level', 'idempotency_key', 'output_summary', 'artifact_id', 'error_code', 'error_message', 'completed_at'],
    product_tasks: ['principal_id', 'source_conversation_id', 'source_run_id', 'source_turn_id', 'mode_resolution_id', 'terminal_status', 'terminal_reason', 'evidence_summary', 'verification_status', 'last_projected_at'],
  };
  const missing = [];
  for (const table of requiredTables) {
    if (!tableExists(db, table)) missing.push(`table:${table}`);
  }
  for (const [table, columns] of Object.entries(requiredColumns)) {
    for (const column of columns) {
      if (!columnExists(db, table, column)) missing.push(`${table}.${column}`);
    }
  }
  return {
    schema_current: missing.length === 0,
    missing_schema: missing,
  };
}

function applyConversationClosureSchema(db) {
  const ensure = (table, column, definition) => {
    if (!columnExists(db, table, column)) {
      db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
    }
  };

  ensure('conversations', 'principal_id', 'TEXT');

  for (const [column, definition] of [
    ['principal_id', 'TEXT'],
    ['entry_channel', "TEXT NOT NULL DEFAULT 'desktop'"],
    ['requested_mode', "TEXT NOT NULL DEFAULT 'auto'"],
    ['resolved_mode', "TEXT NOT NULL DEFAULT 'chat_assist'"],
    ['mode_source', "TEXT NOT NULL DEFAULT 'automatic'"],
    ['terminal_status', 'TEXT'],
    ['terminal_reason', 'TEXT'],
    ['resume_token', 'TEXT'],
    ['parent_run_id', 'TEXT'],
    ['redirected_from_run_id', 'TEXT'],
    ['cancel_requested_at', 'TEXT'],
    ['resumed_at', 'TEXT'],
  ]) ensure('runs', column, definition);

  for (const [column, definition] of [
    ['mode_resolution_id', 'TEXT'],
    ['user_intent_summary', 'TEXT'],
    ['assistant_message_id', 'TEXT'],
    ['stream_status', "TEXT NOT NULL DEFAULT 'created'"],
    ['completed_at', 'TEXT'],
  ]) ensure('turns', column, definition);

  for (const [column, definition] of [
    ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['conversation_id', 'TEXT'],
    ['item_type', 'TEXT'],
    ['item_id', 'TEXT'],
    ['parent_item_id', 'TEXT'],
    ['phase', 'TEXT'],
    ['visibility', 'TEXT'],
    ['source', 'TEXT'],
    ['terminal', 'INTEGER NOT NULL DEFAULT 0'],
    ['payload_json', 'TEXT'],
    ['error_json', 'TEXT'],
    ['usage_json', 'TEXT'],
  ]) ensure('run_events', column, definition);

  for (const [column, definition] of [
    ['streaming_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['first_delta_at', 'TEXT'],
    ['completed_at', 'TEXT'],
    ['finish_reason', 'TEXT'],
    ['usage_status', "TEXT NOT NULL DEFAULT 'provider_missing'"],
    ['raw_finish_json', "TEXT NOT NULL DEFAULT '{}'"],
  ]) ensure('model_calls', column, definition);

  for (const [column, definition] of [
    ['turn_id', 'TEXT'],
    ['tool_call_id', 'TEXT'],
    ['purpose', "TEXT NOT NULL DEFAULT ''"],
    ['approval_request_id', 'TEXT'],
    ['side_effect_level', "TEXT NOT NULL DEFAULT 'none'"],
    ['idempotency_key', 'TEXT'],
    ['output_summary', 'TEXT'],
    ['artifact_id', 'TEXT'],
    ['error_code', 'TEXT'],
    ['error_message', 'TEXT'],
    ['completed_at', 'TEXT'],
  ]) ensure('tool_runs', column, definition);

  for (const [column, definition] of [
    ['principal_id', 'TEXT'],
    ['source_conversation_id', 'TEXT'],
    ['source_run_id', 'TEXT'],
    ['source_turn_id', 'TEXT'],
    ['mode_resolution_id', 'TEXT'],
    ['terminal_status', 'TEXT'],
    ['terminal_reason', 'TEXT'],
    ['evidence_summary', 'TEXT'],
    ['verification_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['last_projected_at', 'TEXT'],
  ]) ensure('product_tasks', column, definition);

  db.exec(`
    CREATE TABLE IF NOT EXISTS principals (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS channel_identities (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      external_thread_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'linked',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(channel, external_user_id, external_thread_id)
    );
    CREATE TABLE IF NOT EXISTS conversation_entry_links (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      channel_identity_id TEXT NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      external_thread_id TEXT NOT NULL DEFAULT '',
      external_message_id TEXT NOT NULL DEFAULT '',
      selection_reason TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(channel_identity_id, conversation_id)
    );
    CREATE TABLE IF NOT EXISTS task_entry_links (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      channel_identity_id TEXT NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
      product_task_id TEXT NOT NULL REFERENCES product_tasks(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      external_task_ref TEXT NOT NULL DEFAULT '',
      selection_reason TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(channel_identity_id, product_task_id)
    );
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
      channel_identity_id TEXT REFERENCES channel_identities(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      product_task_id TEXT REFERENCES product_tasks(id) ON DELETE SET NULL,
      open_loop_id TEXT REFERENCES open_loops(id) ON DELETE SET NULL,
      proactive_message_id TEXT REFERENCES proactive_messages(id) ON DELETE SET NULL,
      channel TEXT NOT NULL DEFAULT 'desktop',
      status TEXT NOT NULL DEFAULT 'pending',
      deep_link_target TEXT NOT NULL DEFAULT '',
      external_delivery_id TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      sent_at TEXT,
      opened_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_conversation_created ON run_events(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_run_events_type ON run_events(run_id, event_type);
    CREATE INDEX IF NOT EXISTS idx_run_events_item ON run_events(item_type, item_id);
    CREATE INDEX IF NOT EXISTS idx_principals_status ON principals(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_identities_principal ON channel_identities(principal_id, channel);
    CREATE INDEX IF NOT EXISTS idx_conversation_entry_links_conversation ON conversation_entry_links(conversation_id, channel);
    CREATE INDEX IF NOT EXISTS idx_task_entry_links_task ON task_entry_links(product_task_id, principal_id);
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_target ON notification_deliveries(conversation_id, product_task_id, status);
  `);
}

function backupSQLiteFiles(sourcePath, targetDir) {
  copyFileSync(sourcePath, join(targetDir, 'joi.db'));
  for (const suffix of ['-wal', '-shm']) {
    const candidate = `${sourcePath}${suffix}`;
    if (existsSync(candidate)) {
      copyFileSync(candidate, join(targetDir, `joi.db${suffix}`));
    }
  }
}

function resolveSQLitePath() {
  const explicit = process.env.JOI_SQLITE_PATH?.trim() || process.env.JOI_DESKTOP_SQLITE_PATH?.trim() || '';
  if (explicit) return resolve(explicit);
  const userDataDir = process.env.JOI_USER_DATA_DIR?.trim()
    || process.env.JOI_DESKTOP_USER_DATA_DIR?.trim()
    || join(homedir(), 'Library/Application Support/Joi');
  return join(resolve(userDataDir), 'joi.db');
}

function runningJoiProcesses() {
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
    return output.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes('/Applications/Joi.app/Contents/MacOS/Joi'))
      .map((line) => {
        const [pid, ...command] = line.split(/\s+/);
        return { pid: Number(pid), command: command.join(' ') };
      })
      .filter((item) => Number.isFinite(item.pid));
  } catch {
    return [];
  }
}

function tableExists(db, table) {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().some((row) => String(row.name) === column);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
