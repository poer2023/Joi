import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { KeychainSecretStore } from '../packages/secrets/src/keychain.ts';

const root = resolve(import.meta.dirname, '..');
const args = new Map(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf('=');
  return index === -1 ? [arg, 'true'] : [arg.slice(0, index), arg.slice(index + 1)];
}));
const timeoutMs = numberArg('--timeout-ms', 10 * 60 * 1000);
const intervalMs = numberArg('--interval-ms', 5000);
const outPath = args.has('--out') ? resolve(args.get('--out')) : '';
const requireNew = args.has('--require-new');
const proofToken = stringArg('--token', `joi-live-${randomBytes(3).toString('hex')}`);

loadLocalEnv(join(root, 'configs/secrets.local.env'));
const instructions = await liveInstructions();
const suggestedMessages = suggestedExternalMessages(proofToken);
const baselineAudit = runAudit(false, true);
const baseline = metricsFromAudit(baselineAudit);
process.stdout.write([
  'Joi live external handoff wait is read-only.',
  `Proof token: ${proofToken}`,
  `Telegram entry: ${instructions.telegram_bot_username || 'configured bot username unavailable'}`,
  `iMessage entry: ${instructions.imessage_assigned_number || 'configured assigned number unavailable'}`,
  `Baseline: external_runs=${baseline.external_runs} linked_external_desktop_tasks=${baseline.linked_external_desktop_tasks}`,
  `Fresh proof: ${requireNew ? 'requires a new linked handoff after this watcher starts' : 'accepts existing or new linked handoff evidence'}`,
  '',
  'To satisfy the live gate, send a real external message, then continue the same Product Task in Desktop.',
  `Suggested Telegram message: ${suggestedMessages.telegram}`,
  `Suggested iMessage message: ${suggestedMessages.imessage}`,
  'When a pending handoff appears, open Joi Desktop > 高级 > 诊断包 and click the pending handoff 继续 button.',
  '',
].join('\n'));

const startedAt = Date.now();
let lastAudit = null;
const samples = [];
do {
  lastAudit = runAudit(false, true);
  const current = metricsFromAudit(lastAudit);
  const linkedDelta = current.linked_external_desktop_tasks - baseline.linked_external_desktop_tasks;
  const externalRunDelta = current.external_runs - baseline.external_runs;
  const phase = phaseFromAudit(lastAudit, current, baseline);
  const pending = summarizePendingHandoffs(lastAudit.pending_external_handoffs || []);
  const linked = summarizeLinkedHandoffs(lastAudit.linked_live_handoffs || []);
  samples.push({
    observed_at: new Date().toISOString(),
    phase,
    status: lastAudit.status || 'unknown',
    readiness_ok: lastAudit.readiness?.ok === true,
    external_runs: current.external_runs,
    linked_external_desktop_tasks: current.linked_external_desktop_tasks,
    external_run_delta: externalRunDelta,
    linked_delta: linkedDelta,
    pending_external_handoffs: pending,
    linked_live_handoffs: linked,
  });
  process.stdout.write(`${new Date().toISOString()} phase=${phase} status=${lastAudit.status || 'unknown'} readiness=${lastAudit.readiness?.ok === true ? 'ok' : 'not_ok'} external_runs=${current.external_runs} linked_external_desktop_tasks=${current.linked_external_desktop_tasks} external_run_delta=${externalRunDelta} linked_delta=${linkedDelta} pending=${pending.length}\n`);
  if (pending.length > 0 && linkedDelta <= 0) {
    process.stdout.write(`Pending handoff detected: ${pending.map((item) => `${item.external_channel}:${item.product_task_id}`).join(', ')}. Continue it from Joi Desktop diagnostics, then keep this watcher running.\n`);
  }
  const hasProof = requireNew ? linkedDelta > 0 : current.linked_external_desktop_tasks > 0;
  if (hasProof) {
    const proof = runAudit(true, true);
    writeEvidence('proved', proof, baseline, samples, instructions);
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    process.exit(0);
  }
  if (Date.now() - startedAt > timeoutMs) break;
  await sleep(intervalMs);
} while (Date.now() - startedAt <= timeoutMs);

process.stdout.write(`${JSON.stringify(lastAudit, null, 2)}\n`);
writeEvidence('timeout', lastAudit, baseline, samples, instructions);
process.stderr.write(`Timed out waiting for live external handoff evidence after ${timeoutMs}ms.\n`);
process.exit(1);

function runAudit(requireLive, includeReadiness = false) {
  const args = ['--experimental-strip-types', join(root, 'scripts/desktop_live_external_handoff_audit.mjs')];
  if (requireLive) args.push('--require-live');
  if (includeReadiness) args.push('--include-readiness');
  if (proofToken) args.push(`--token=${proofToken}`);
  const output = execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function metricsFromAudit(audit) {
  return {
    external_runs: Number(audit?.metrics?.external_runs || 0),
    linked_external_desktop_tasks: Number(audit?.metrics?.linked_external_desktop_tasks || 0),
  };
}

function writeEvidence(status, audit, baseline, samples, instructions) {
  if (!outPath) return;
  const evidence = {
    generated_at: new Date().toISOString(),
    status,
    require_new: requireNew,
    proof_token: proofToken,
    timeout_ms: timeoutMs,
    interval_ms: intervalMs,
    baseline,
    final_metrics: metricsFromAudit(audit),
    final_status: audit?.status || 'unknown',
    readiness_ok: audit?.readiness?.ok === true,
    instructions,
    suggested_messages: suggestedMessages,
    pending_external_handoffs: summarizePendingHandoffs(audit?.pending_external_handoffs || []),
    linked_live_handoffs: summarizeLinkedHandoffs(audit?.linked_live_handoffs || []),
    samples,
    audit,
  };
  mkdirp(dirname(outPath));
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

function phaseFromAudit(audit, current, baseline) {
  const linkedDelta = current.linked_external_desktop_tasks - baseline.linked_external_desktop_tasks;
  const externalRunDelta = current.external_runs - baseline.external_runs;
  if (audit?.readiness?.checked && audit.readiness.ok !== true) return 'external_not_ready';
  if (requireNew ? linkedDelta > 0 : current.linked_external_desktop_tasks > 0) return 'live_handoff_linked';
  if ((audit?.pending_external_handoffs || []).length > 0 || externalRunDelta > 0) return 'awaiting_desktop_continuation';
  return 'awaiting_external_input';
}

function summarizePendingHandoffs(handoffs) {
  return handoffs.slice(0, 5).map((handoff) => ({
    external_channel: handoff?.external_channel || '',
    external_run_id: handoff?.external_run_id || '',
    product_task_id: handoff?.product_task_id || '',
    external_status: handoff?.external_status || '',
    latest_task_status: handoff?.latest_task_status || '',
    latest_task_title: handoff?.latest_task_title || '',
  }));
}

function summarizeLinkedHandoffs(handoffs) {
  return handoffs.slice(0, 5).map((handoff) => ({
    external_channel: handoff?.external_channel || '',
    external_run_id: handoff?.external_run_id || '',
    desktop_run_id: handoff?.desktop_run_id || '',
    product_task_id: handoff?.product_task_id || '',
    external_status: handoff?.external_status || '',
    desktop_status: handoff?.desktop_status || '',
  }));
}

function suggestedExternalMessages(token) {
  return {
    telegram: `认真执行：Joi live handoff smoke ${token}。请创建一个可在 Desktop 继续的只读 Product Task，完成后简短回复。`,
    imessage: `查询刚才同一个跨入口任务的进展，token ${token}。`,
  };
}

async function liveInstructions() {
  const keychain = new KeychainSecretStore();
  const dbPath = resolveSQLitePath();
  const settings = readSettings(dbPath);
  const token = await resolveSecret(keychain, 'TELEGRAM_BOT_TOKEN');
  let telegramBotUsername = '';
  if (token) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const payload = await response.json().catch(() => ({}));
      const username = String(payload?.result?.username || '').trim();
      telegramBotUsername = username ? `@${username}` : '';
    } catch {
      telegramBotUsername = '';
    }
  }
  return {
    telegram_bot_username: telegramBotUsername,
    imessage_assigned_number: settings['imessage.assigned_number'] || '',
  };
}

async function resolveSecret(keychain, name) {
  const envValue = process.env[name]?.trim() || '';
  if (envValue) return envValue;
  return (await keychain.get(name)) || '';
}

function readSettings(dbPath) {
  if (!existsSync(dbPath)) return {};
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='desktop_settings'`).get()) return {};
    const rows = db.prepare(`SELECT key, value FROM desktop_settings`).all();
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value || '')]));
  } catch {
    return {};
  } finally {
    db?.close();
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

function loadLocalEnv(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
    process.env[key] = unquoteEnvValue(trimmed.slice(index + 1).trim());
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function numberArg(name, fallback) {
  const value = Number(args.get(name) || '');
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringArg(name, fallback) {
  const value = String(args.get(name) || '').trim();
  return value || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
