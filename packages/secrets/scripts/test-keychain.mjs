import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeychainSecretStore } from '../src/keychain.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'joi-keychain-test-'));
const securityBin = join(tempDir, 'security');
const dbPath = join(tempDir, 'fake-keychain.json');

try {
  writeFileSync(securityBin, `#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const dbPath = process.env.JOI_FAKE_KEYCHAIN_DB;
const args = process.argv.slice(2);
const read = () => existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : {};
const write = (db) => writeFileSync(dbPath, JSON.stringify(db));
function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}
const account = flag('-a');
const service = flag('-s');
const key = service + ':' + account;
if (args[0] === 'add-generic-password') {
  const db = read();
  db[key] = flag('-w');
  write(db);
  process.exit(0);
}
if (args[0] === 'find-generic-password') {
  const db = read();
  if (!db[key]) process.exit(44);
  process.stdout.write(db[key]);
  process.exit(0);
}
process.exit(2);
`);
  chmodSync(securityBin, 0o755);
  process.env.JOI_FAKE_KEYCHAIN_DB = dbPath;
  delete process.env.MODEL_API_KEY;

  const store = new KeychainSecretStore({ service: 'Joi Desktop Test', securityBin });
  assert.equal((await store.status()).secrets.MODEL_API_KEY, false);
  await store.save('MODEL_API_KEY', 'sk-test-secret');
  assert.equal(await store.get('MODEL_API_KEY'), 'sk-test-secret');
  assert.equal(await store.resolve('MODEL_API_KEY'), 'sk-test-secret');
  delete process.env.MODEL_API_KEY;
  await store.loadIntoEnv();
  assert.equal(process.env.MODEL_API_KEY, 'sk-test-secret');
  assert.equal((await store.status()).secrets.MODEL_API_KEY, true);
  await assert.rejects(() => store.save('UNKNOWN_SECRET', 'value'), /unsupported secret name/);

  const raw = readFileSync(dbPath, 'utf8');
  assert.match(raw, /Joi Desktop Test:MODEL_API_KEY/);
  console.log('keychain secret tests passed');
} finally {
  delete process.env.JOI_FAKE_KEYCHAIN_DB;
  delete process.env.MODEL_API_KEY;
  rmSync(tempDir, { recursive: true, force: true });
}
