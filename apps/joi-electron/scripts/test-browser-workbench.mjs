#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = execFileSync(process.execPath, [resolve(appDir, 'scripts/build-browser-workbench-harness.mjs')], {
  cwd: appDir,
  encoding: 'utf8',
}).trim().split(/\r?\n/).at(-1);

if (!harness) throw new Error('browser workbench harness build returned no entrypoint');
execFileSync(resolve(appDir, 'node_modules/.bin/electron'), [harness], {
  cwd: appDir,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  stdio: 'inherit',
  timeout: 180_000,
});
