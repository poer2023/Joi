import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../../../packages/store/src/sqlite.ts';
import { JoiPluginManager } from '../src/main/plugin-manager.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-plugin-live-'));
const store = new JoiSQLiteStore({
  dbPath: join(tempDir, 'joi.db'),
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(tempDir, 'logs'),
  backupDir: join(tempDir, 'backups'),
  version: 'test',
});
const manager = new JoiPluginManager(store, tempDir);
const source = 'https://github.com/poer2023/joi-codex-acp-plugin';

try {
  const first = await manager.installFromGitHub({ source });
  assert.equal(first.plugin.id, 'joi.provider.codex-acp');
  assert.deepEqual(first.plugin.provider_ids, ['acp_codex_cli']);
  assert.equal(existsSync(join(tempDir, 'plugins', first.plugin.id, 'node_modules')), true);
  const firstTest = await manager.testProvider(first.plugin.id, 'acp_codex_cli');
  assert.equal(firstTest.ok, true, firstTest.error_summary);
  await manager.remove(first.plugin.id);
  assert.equal(existsSync(join(tempDir, 'plugins', first.plugin.id)), false);
  assert.equal(store.listPlugins().plugins.some((plugin) => plugin.id === first.plugin.id), false);

  const second = await manager.installFromGitHub({ source });
  assert.equal(second.plugin.id, first.plugin.id);
  const secondTest = await manager.testProvider(second.plugin.id, 'acp_codex_cli');
  assert.equal(secondTest.ok, true, secondTest.error_summary);
  await manager.remove(second.plugin.id);
  assert.equal(existsSync(join(tempDir, 'plugins', second.plugin.id)), false);
  console.log('GitHub plugin install/remove/reinstall live test passed');
} finally {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
}
