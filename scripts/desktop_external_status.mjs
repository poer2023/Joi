import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KeychainSecretStore } from '../packages/secrets/src/keychain.ts';
import { testPhotonIMessageConnection } from '../packages/runtime/src/imessage.ts';
import { testTelegramConnection } from '../packages/runtime/src/telegram.ts';

const args = new Set(process.argv.slice(2));
const requireExternal = args.has('--require-external');
const checkConnections = args.has('--check-connections');
const outputText = args.has('--text');

const root = resolve(import.meta.dirname, '..');
loadLocalEnv(join(root, 'configs/secrets.local.env'));

const keychain = new KeychainSecretStore();
const sqlitePath = resolveSQLitePath();
const settings = readSettings(sqlitePath);

const telegramToken = await resolvedSecret('TELEGRAM_BOT_TOKEN');
const photonProjectSecret = await resolvedSecret('PHOTON_PROJECT_SECRET');
const photonDashboardToken = await resolvedSecret('PHOTON_DASHBOARD_TOKEN');
const telegramAllowedUsers = resolvedSetting('TELEGRAM_ALLOWED_USER_IDS', 'telegram.allowed_user_ids');
const photonProjectID = resolvedSetting('PHOTON_PROJECT_ID', 'imessage.photon_project_id');

const requirements = {
  TELEGRAM_BOT_TOKEN: Boolean(telegramToken.value),
  TELEGRAM_ALLOWED_USER_IDS: Boolean(telegramAllowedUsers.value),
  PHOTON_PROJECT_ID: Boolean(photonProjectID.value),
  PHOTON_PROJECT_SECRET: Boolean(photonProjectSecret.value),
  PHOTON_DASHBOARD_TOKEN: Boolean(photonDashboardToken.value),
};
const processSnapshot = inspectProcessSnapshot();

const result = {
  ok: true,
  keychain_service: keychain.service,
  sqlite_path: sqlitePath,
  sqlite_exists: existsSync(sqlitePath),
  credentials: {
    TELEGRAM_BOT_TOKEN: statusRecord(telegramToken),
    TELEGRAM_ALLOWED_USER_IDS: statusRecord(telegramAllowedUsers),
    PHOTON_PROJECT_ID: statusRecord(photonProjectID),
    PHOTON_PROJECT_SECRET: statusRecord(photonProjectSecret),
    PHOTON_DASHBOARD_TOKEN: statusRecord(photonDashboardToken),
  },
  checks: {},
  services: {},
};

const missing = Object.entries(requirements)
  .filter(([, present]) => !present)
  .map(([name]) => name);

if (checkConnections && telegramToken.value && telegramAllowedUsers.value) {
  result.checks.telegram_get_me = await testTelegramConnection({ token: telegramToken.value });
}
if (checkConnections && photonProjectID.value && photonProjectSecret.value) {
  result.checks.imessage_photon = await testPhotonIMessageConnection({
    project_id: photonProjectID.value,
    project_secret: photonProjectSecret.value,
  });
}

const telegramEnabled = settings['telegram.enabled'] === 'true';
const imessageEnabled = settings['imessage.enabled'] === 'true';
const telegramCheckOK = Boolean(result.checks.telegram_get_me?.ok);
const imessageCheckOK = Boolean(result.checks.imessage_photon?.ok);
result.services.desktop_app = {
  label: 'Joi Desktop',
  enabled: true,
  configured: true,
  running: processSnapshot.joi_app_pids.length > 0,
  ready: processSnapshot.joi_app_pids.length > 0,
  details: {
    pid_count: processSnapshot.joi_app_pids.length,
    pids: processSnapshot.joi_app_pids.join(',') || null,
  },
};
result.services.telegram = {
  label: 'Telegram',
  enabled: telegramEnabled,
  configured: Boolean(telegramToken.value && telegramAllowedUsers.value),
  running: telegramEnabled && Boolean(telegramToken.value) && processSnapshot.joi_app_pids.length > 0,
  ready: telegramEnabled && Boolean(telegramToken.value && telegramAllowedUsers.value) && processSnapshot.joi_app_pids.length > 0 && telegramCheckOK,
  details: {
    allowed_user_ids_configured: Boolean(telegramAllowedUsers.value),
    connection_check: telegramCheckOK,
  },
};
result.services.imessage = {
  label: 'iMessage',
  enabled: imessageEnabled,
  configured: Boolean(photonProjectID.value && photonProjectSecret.value),
  running: processSnapshot.photon_sidecar_pids.length > 0,
  ready: imessageEnabled && Boolean(photonProjectID.value && photonProjectSecret.value) && processSnapshot.photon_sidecar_pids.length > 0 && imessageCheckOK,
  details: {
    connection_check: imessageCheckOK,
    sidecar_pids: processSnapshot.photon_sidecar_pids.join(',') || null,
  },
};

if (requireExternal) {
  const failedChecks = Object.entries(result.checks)
    .filter(([, check]) => !check?.ok)
    .map(([name]) => name);
  const failedServices = Object.entries(result.services)
    .filter(([, service]) => service.enabled && service.configured && !service.ready)
    .map(([name]) => name);
  const readyExternalServices = ['telegram', 'imessage'].filter((name) => result.services[name]?.ready);
  result.ok = readyExternalServices.length > 0;
  if (!result.ok) {
    result.ok = false;
    result.missing = missing;
    result.failed_checks = failedChecks;
    result.failed_services = failedServices;
  }
}

if (outputText) {
  console.log(`configs/secrets.local.env=${existsSync(join(root, 'configs/secrets.local.env')) ? 'present' : 'missing'}`);
  console.log(`keychain_service=${keychain.service}`);
  console.log(`sqlite_path=${sqlitePath}`);
  for (const [name, credential] of Object.entries(result.credentials)) {
    console.log(`${name}=${credential.present ? 'set' : 'missing'} source=${credential.source}`);
  }
  for (const [name, check] of Object.entries(result.checks)) {
    console.log(`${name}=${check.ok ? 'passed' : 'failed'} status=${check.status || 'unknown'}`);
  }
  for (const [name, service] of Object.entries(result.services)) {
    const state = service.ready ? 'ready' : service.running ? (checkConnections ? 'running_not_ready' : 'running') : 'not_running';
    console.log(`service.${name}=${state} enabled=${service.enabled} configured=${service.configured}`);
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (!result.ok) {
  process.exit(1);
}

async function resolvedSecret(name) {
  const envValue = process.env[name]?.trim() || '';
  if (envValue) return { value: envValue, source: 'env' };
  const keychainValue = await keychain.get(name);
  if (keychainValue) return { value: keychainValue, source: 'keychain' };
  return { value: '', source: 'missing' };
}

function resolvedSetting(envName, settingKey) {
  const envValue = process.env[envName]?.trim() || '';
  if (envValue) return { value: envValue, source: 'env' };
  const settingValue = settings[settingKey]?.trim() || '';
  if (settingValue) return { value: settingValue, source: 'sqlite_settings' };
  return { value: '', source: 'missing' };
}

function statusRecord(resolved) {
  return {
    present: Boolean(resolved.value),
    source: resolved.source,
  };
}

function resolveSQLitePath() {
  const explicit = process.env.JOI_SQLITE_PATH?.trim() || process.env.JOI_DESKTOP_SQLITE_PATH?.trim() || '';
  if (explicit) return resolve(explicit);
  const userDataDir = process.env.JOI_USER_DATA_DIR?.trim()
    || process.env.JOI_DESKTOP_USER_DATA_DIR?.trim()
    || join(homedir(), 'Library/Application Support/Joi');
  return join(resolve(userDataDir), 'joi.db');
}

function readSettings(dbPath) {
  if (!existsSync(dbPath)) return {};
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const table = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='desktop_settings'`).get();
    if (!table) return {};
    const rows = db.prepare(`SELECT key, value FROM desktop_settings`).all();
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value || '')]));
  } catch {
    return {};
  } finally {
    db?.close();
  }
}

function inspectProcessSnapshot() {
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rows = output.split('\n')
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      }));
    const joiAppRows = rows.filter((row) => row.command.includes('/Applications/Joi.app/Contents/MacOS/Joi'));
    const joiPids = new Set(joiAppRows.map((row) => row.pid));
    const sidecarRows = rows.filter((row) => (
      (row.command.includes('node index.mjs') && joiPids.has(row.ppid))
      || (row.command.includes('photon-sidecar') && row.command.includes('index.mjs'))
    ));
    return {
      joi_app_pids: joiAppRows.map((row) => row.pid),
      photon_sidecar_pids: sidecarRows.map((row) => row.pid),
    };
  } catch {
    return {
      joi_app_pids: [],
      photon_sidecar_pids: [],
    };
  }
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
