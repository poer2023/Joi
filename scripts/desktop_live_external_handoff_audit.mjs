import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs.filter((arg) => !arg.startsWith('--out=') && !arg.startsWith('--token=')));
const outArg = rawArgs.find((arg) => arg.startsWith('--out='));
const outPath = outArg ? resolve(outArg.slice('--out='.length)) : '';
const tokenArg = rawArgs.find((arg) => arg.startsWith('--token='));
const proofToken = tokenArg ? tokenArg.slice('--token='.length).trim() : '';
const requireLive = args.has('--require-live');
const includeReadiness = args.has('--include-readiness') || args.has('--check-readiness');
const root = resolve(import.meta.dirname, '..');
const dbPath = resolveSQLitePath();

const audit = {
  ok: true,
  sqlite_path: dbPath,
  sqlite_exists: existsSync(dbPath),
  proof_token: proofToken || undefined,
  token_filter_applied: Boolean(proofToken),
  schema_current: false,
  missing_schema: [],
  external_channels_seen: [],
  linked_live_handoffs: [],
  pending_external_handoffs: [],
  metrics: {
    external_runs: 0,
    desktop_runs: 0,
    linked_external_desktop_tasks: 0,
  },
  readiness: {
    checked: false,
    ok: false,
    credentials: {},
    checks: {},
    services: {},
  },
  status: 'unknown',
  next_action: '',
};

if (audit.sqlite_exists) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const requiredTables = ['runs', 'messages', 'product_tasks', 'task_entry_links', 'channel_identities'];
    if (proofToken) requiredTables.push('turn_items');
    const requiredRunColumns = ['entry_channel', 'principal_id', 'user_message_id', 'metadata'];
    const requiredTaskColumns = ['principal_id', 'source_run_id', 'source_conversation_id'];
    const missing = [
      ...requiredTables.filter((table) => !tableExists(db, table)).map((table) => `table:${table}`),
      ...requiredRunColumns.filter((column) => !columnExists(db, 'runs', column)).map((column) => `runs.${column}`),
      ...requiredTaskColumns.filter((column) => !columnExists(db, 'product_tasks', column)).map((column) => `product_tasks.${column}`),
    ];
    audit.missing_schema = missing;
    audit.schema_current = missing.length === 0;

    if (audit.schema_current) {
      const rows = db.prepare(
        `WITH run_tasks AS (
           SELECT r.id AS run_id,
                  r.entry_channel,
                  r.principal_id,
                  r.conversation_id,
                  r.status,
                  r.terminal_status,
                  r.metadata AS run_metadata,
                  COALESCE(m.content, '') AS user_message,
                  COALESCE(
                    NULLIF(json_extract(r.metadata, '$.product_task_id'), ''),
                    pt_latest.id,
                    pt_source.id
                  ) AS product_task_id,
                  r.created_at
           FROM runs r
           LEFT JOIN messages m ON m.id = r.user_message_id
           LEFT JOIN product_tasks pt_latest ON pt_latest.latest_run_id = r.id
           LEFT JOIN product_tasks pt_source ON pt_source.source_run_id = r.id
           WHERE r.entry_channel IN ('desktop', 'telegram', 'imessage')
         )
         SELECT ext.entry_channel AS external_channel,
                ext.run_id AS external_run_id,
                desktop.run_id AS desktop_run_id,
                ext.product_task_id,
                ext.principal_id,
                ext.conversation_id,
                ext.status AS external_status,
                desktop.status AS desktop_status,
                ext.created_at AS external_created_at,
                desktop.created_at AS desktop_created_at
         FROM run_tasks ext
         JOIN run_tasks desktop ON desktop.product_task_id = ext.product_task_id
         LEFT JOIN product_tasks pt ON pt.id = ext.product_task_id
         WHERE ext.entry_channel IN ('telegram', 'imessage')
           AND desktop.entry_channel = 'desktop'
           AND COALESCE(ext.product_task_id, '') <> ''
           ${tokenWhere('ext', 'pt')}
         ORDER BY datetime(ext.created_at) DESC
         LIMIT 20`,
      ).all(...tokenParams(8));
      const pendingRows = db.prepare(
        `WITH run_tasks AS (
           SELECT r.id AS run_id,
                  r.entry_channel,
                  r.principal_id,
                  r.conversation_id,
                  r.status,
                  r.terminal_status,
                  r.metadata AS run_metadata,
                  COALESCE(m.content, '') AS user_message,
                  COALESCE(
                    NULLIF(json_extract(r.metadata, '$.product_task_id'), ''),
                    pt_latest.id,
                    pt_source.id
                  ) AS product_task_id,
                  r.created_at
           FROM runs r
           LEFT JOIN messages m ON m.id = r.user_message_id
           LEFT JOIN product_tasks pt_latest ON pt_latest.latest_run_id = r.id
           LEFT JOIN product_tasks pt_source ON pt_source.source_run_id = r.id
           WHERE r.entry_channel IN ('desktop', 'telegram', 'imessage')
         )
         SELECT ext.entry_channel AS external_channel,
                ext.run_id AS external_run_id,
                ext.product_task_id,
                ext.principal_id,
                ext.conversation_id,
                ext.status AS external_status,
                ext.created_at AS external_created_at,
                pt.status AS latest_task_status,
                pt.title AS latest_task_title
         FROM run_tasks ext
         LEFT JOIN product_tasks pt ON pt.id = ext.product_task_id
         WHERE ext.entry_channel IN ('telegram', 'imessage')
           AND COALESCE(ext.product_task_id, '') <> ''
           AND NOT EXISTS (
             SELECT 1
             FROM run_tasks desktop
             WHERE desktop.entry_channel = 'desktop'
               AND desktop.product_task_id = ext.product_task_id
           )
           ${tokenWhere('ext', 'pt')}
         ORDER BY datetime(ext.created_at) DESC
         LIMIT 20`,
      ).all(...tokenParams(8));
      const externalChannels = db.prepare(
        `SELECT DISTINCT r.entry_channel AS channel
         FROM runs r
         WHERE r.entry_channel IN ('telegram', 'imessage')
         ORDER BY channel`,
      ).all().map((row) => String(row.channel));
      const externalRuns = countAuditRuns(db, 'external');
      const desktopRuns = countAuditRuns(db, 'desktop');
      audit.external_channels_seen = externalChannels;
      audit.linked_live_handoffs = rows.map((row) => ({
        external_channel: String(row.external_channel),
        external_run_id: String(row.external_run_id),
        desktop_run_id: String(row.desktop_run_id),
        product_task_id: String(row.product_task_id),
        principal_id: String(row.principal_id || ''),
        conversation_id: String(row.conversation_id || ''),
        external_status: String(row.external_status || ''),
        desktop_status: String(row.desktop_status || ''),
        external_created_at: String(row.external_created_at || ''),
        desktop_created_at: String(row.desktop_created_at || ''),
      }));
      audit.pending_external_handoffs = pendingRows.map((row) => ({
        external_channel: String(row.external_channel),
        external_run_id: String(row.external_run_id),
        product_task_id: String(row.product_task_id),
        principal_id: String(row.principal_id || ''),
        conversation_id: String(row.conversation_id || ''),
        external_status: String(row.external_status || ''),
        external_created_at: String(row.external_created_at || ''),
        latest_task_status: String(row.latest_task_status || ''),
        latest_task_title: String(row.latest_task_title || ''),
      }));
      audit.metrics = {
        external_runs: externalRuns,
        desktop_runs: desktopRuns,
        linked_external_desktop_tasks: rows.length,
      };
    }
  } catch (error) {
    audit.ok = false;
    audit.error = error instanceof Error ? error.message : String(error);
  } finally {
    db?.close();
  }
}

if (includeReadiness) {
  audit.readiness = runReadinessCheck();
}

audit.status = classifyAudit(audit);
audit.next_action = nextActionForStatus(audit.status);

if (requireLive && audit.linked_live_handoffs.length === 0) {
  audit.ok = false;
  if (!audit.schema_current) {
    audit.error = 'production sqlite schema is not current enough for live handoff audit';
  } else if (includeReadiness && !audit.readiness.ok) {
    audit.error = 'external entry readiness failed before live handoff evidence could be proven';
  } else {
    audit.error = 'no live external-to-desktop handoff evidence found';
  }
}

const output = `${JSON.stringify(audit, null, 2)}\n`;
if (outPath) {
  writeFileSync(outPath, output);
}
process.stdout.write(output);

if (!audit.ok) {
  process.exit(1);
}

function resolveSQLitePath() {
  const explicit = process.env.JOI_SQLITE_PATH?.trim() || process.env.JOI_DESKTOP_SQLITE_PATH?.trim() || '';
  if (explicit) return resolve(explicit);
  const userDataDir = process.env.JOI_USER_DATA_DIR?.trim()
    || process.env.JOI_DESKTOP_USER_DATA_DIR?.trim()
    || join(homedir(), 'Library/Application Support/Joi');
  return join(resolve(userDataDir), 'joi.db');
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

function runTasksCTE() {
  return `WITH run_tasks AS (
    SELECT r.id AS run_id,
           r.entry_channel,
           r.principal_id,
           r.conversation_id,
           r.status,
           r.terminal_status,
           r.metadata AS run_metadata,
           COALESCE(m.content, '') AS user_message,
           COALESCE(
             NULLIF(json_extract(r.metadata, '$.product_task_id'), ''),
             pt_latest.id,
             pt_source.id
           ) AS product_task_id,
           r.created_at
    FROM runs r
    LEFT JOIN messages m ON m.id = r.user_message_id
    LEFT JOIN product_tasks pt_latest ON pt_latest.latest_run_id = r.id
    LEFT JOIN product_tasks pt_source ON pt_source.source_run_id = r.id
    WHERE r.entry_channel IN ('desktop', 'telegram', 'imessage')
  )`;
}

function countAuditRuns(db, kind) {
  const entryWhere = kind === 'desktop'
    ? `ext.entry_channel = 'desktop'`
    : `ext.entry_channel IN ('telegram', 'imessage')`;
  const row = db.prepare(
    `${runTasksCTE()}
     SELECT COUNT(DISTINCT ext.run_id) AS count
     FROM run_tasks ext
     LEFT JOIN product_tasks pt ON pt.id = ext.product_task_id
     WHERE ${entryWhere}
       ${tokenWhere('ext', 'pt')}`,
  ).get(...tokenParams(8));
  return Number(row?.count || 0);
}

function tokenWhere(runAlias, taskAlias) {
  if (!proofToken) return '';
  return `AND (
    instr(COALESCE(${runAlias}.user_message, ''), ?) > 0
    OR instr(COALESCE(${runAlias}.run_metadata, ''), ?) > 0
    OR instr(COALESCE(${taskAlias}.title, ''), ?) > 0
    OR instr(COALESCE(${taskAlias}.description, ''), ?) > 0
    OR instr(COALESCE(${taskAlias}.summary, ''), ?) > 0
    OR instr(COALESCE(${taskAlias}.metadata, ''), ?) > 0
    OR EXISTS (
      SELECT 1
      FROM messages token_msg
      WHERE token_msg.conversation_id = ${runAlias}.conversation_id
        AND instr(COALESCE(token_msg.content, ''), ?) > 0
    )
    OR EXISTS (
      SELECT 1
      FROM turn_items token_item
      WHERE token_item.run_id = ${runAlias}.run_id
        AND instr(
          COALESCE(token_item.content, '') || ' ' || COALESCE(token_item.arguments, '') || ' ' || COALESCE(token_item.output, ''),
          ?
        ) > 0
    )
  )`;
}

function tokenParams(count) {
  return proofToken ? Array(count).fill(proofToken) : [];
}

function runReadinessCheck() {
  const readiness = {
    checked: true,
    ok: false,
    credentials: {},
    checks: {},
    services: {},
  };
  try {
    const output = execFileSync(process.execPath, [
      '--experimental-strip-types',
      join(root, 'scripts/desktop_external_status.mjs'),
      '--require-external',
      '--check-connections',
    ], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    readiness.ok = Boolean(parsed.ok);
    readiness.credentials = parsed.credentials || {};
    readiness.checks = parsed.checks || {};
    readiness.services = parsed.services || {};
    return readiness;
  } catch (error) {
    const output = error?.stdout?.toString?.() || '';
    if (output.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(output);
        readiness.ok = Boolean(parsed.ok);
        readiness.credentials = parsed.credentials || {};
        readiness.checks = parsed.checks || {};
        readiness.services = parsed.services || {};
        readiness.missing = parsed.missing || [];
        readiness.failed_checks = parsed.failed_checks || [];
        readiness.failed_services = parsed.failed_services || [];
      } catch {
        readiness.error = output.trim();
      }
    } else {
      readiness.error = error instanceof Error ? error.message : String(error);
    }
    return readiness;
  }
}

function classifyAudit(currentAudit) {
  if (!currentAudit.sqlite_exists) return 'sqlite_missing';
  if (!currentAudit.schema_current) return 'schema_missing';
  if (currentAudit.linked_live_handoffs.length > 0) return 'live_handoff_linked';
  if (includeReadiness && !currentAudit.readiness.ok) return 'external_not_ready';
  if (currentAudit.metrics.external_runs > 0) return 'awaiting_desktop_continuation';
  return 'awaiting_external_input';
}

function nextActionForStatus(status) {
  const actions = {
    sqlite_missing: 'Start Joi once so the production SQLite database exists.',
    schema_missing: 'Run pnpm joi:prod-schema:migrate, then rerun the live audit.',
    external_not_ready: 'Fix Telegram/iMessage credential or connection checks, then rerun the live audit.',
    awaiting_external_input: 'Send a real Telegram or iMessage task, then continue the same task in Desktop.',
    awaiting_desktop_continuation: 'Open Desktop recent tasks and continue the external-origin task so the same Product Task has a Desktop run.',
    live_handoff_linked: 'Live external-to-Desktop handoff evidence is present.',
  };
  return actions[status] || '';
}
