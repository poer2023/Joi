import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-run-record-truth-'));
const esbuildBin = [
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'esbuild@0.27.7', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild'),
  join(root, 'node_modules', '.bin', 'esbuild'),
].find((candidate) => existsSync(candidate)) || 'node_modules/.bin/esbuild';

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `export * from '${root}/src/features/logs/logPresentation.ts';`);
  execFileSync(esbuildBin, [entry, '--bundle', '--format=esm', '--platform=node', '--target=es2020', '--outfile=' + bundle], { cwd: root, stdio: 'inherit' });
  const { hasNonEmptyLogError, isLogFailure } = await import(pathToFileURL(bundle).href);

  assert.equal(hasNonEmptyLogError({ error: {} }), false);
  assert.equal(isLogFailure({ level: 'debug', status: 'running', error: {} }), false);
  assert.equal(isLogFailure({ level: 'info', status: 'completed', error: undefined }), false);
  assert.equal(isLogFailure({ level: 'error', status: '', error: undefined }), true);
  assert.equal(isLogFailure({ level: 'info', status: 'blocked', error: {} }), true);
  assert.equal(isLogFailure({ level: 'info', status: '', error: { message: 'boom' } }), true);

  console.log('run record truth tests passed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
