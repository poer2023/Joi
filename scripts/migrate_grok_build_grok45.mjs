import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../packages/store/src/sqlite.ts';

const root = resolve(import.meta.dirname, '..');
const dbPath = process.argv.find((item) => item.startsWith('--db='))?.slice('--db='.length)
  || join(homedir(), 'Library/Application Support/Joi/joi.db');
const dataDir = dirname(dbPath);
const store = new JoiSQLiteStore({
  dbPath,
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(dataDir, 'logs'),
  backupDir: join(dataDir, 'backups'),
  version: 'grok-build-grok45-migration-v1',
});

try {
  store.saveModelConfig({
    provider: 'grok_build',
    base_url: 'https://api.x.ai/v1',
    name: 'grok-4.5',
    reasoning_name: 'grok-4.5',
    reasoning_effort: 'high',
    timeout_seconds: 90,
    max_retries: 2,
  });
  const snapshot = store.listPersonaMessenger();
  const changed = [];
  for (const persona of snapshot.personas) {
    if (persona.model_strategy === 'grok-4.5' && persona.model_reasoning_effort === 'high') continue;
    const updated = store.updateProjectPersona({
      persona_id: persona.id,
      base_version: persona.version,
      model_strategy: 'grok-4.5',
      model_reasoning_effort: 'high',
      change_reason: 'Switch production runtime to Grok Build / grok-4.5',
    });
    changed.push({ id: updated.id, name: updated.display_name, version: updated.version });
  }
  console.log(JSON.stringify({
    ok: true,
    db_path: dbPath,
    provider: 'grok_build',
    model: 'grok-4.5',
    reasoning_effort: 'high',
    changed_personas: changed,
  }, null, 2));
} finally {
  store.close();
}
