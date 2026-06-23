import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-task-mini-list-'));

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `
    export { visibleRecentTasksForHandoff } from '${root}/src/productTasks.ts';
  `);
  execFileSync('node_modules/.bin/esbuild', [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2020',
    '--outfile=' + bundle,
  ], { cwd: root, stdio: 'inherit' });

  const { visibleRecentTasksForHandoff } = await import(pathToFileURL(bundle).href);
  const task = (id, status, sourceChannel = 'desktop') => ({
    id,
    principal_id: 'principal_local_owner',
    title: `Task ${id}`,
    description: '',
    status,
    mode: 'serious_task',
    priority: 'normal',
    risk_level: 'medium',
    progress_percent: status === 'completed' ? 100 : 20,
    source_channel: sourceChannel,
  });

  {
    const visible = visibleRecentTasksForHandoff([
      task('old_desktop_done', 'completed', 'desktop'),
      task('active_desktop', 'running', 'desktop'),
      task('telegram_done', 'completed', 'telegram'),
      task('imessage_done', 'completed', 'imessage'),
    ]);
    assert.deepEqual(visible.map((item) => item.id), ['active_desktop', 'telegram_done', 'imessage_done']);
  }

  {
    const visible = visibleRecentTasksForHandoff([
      task('telegram_running', 'running', 'telegram'),
      task('desktop_paused', 'paused', 'desktop'),
      task('telegram_running', 'running', 'telegram'),
      task('desktop_done', 'completed', 'desktop'),
    ]);
    assert.deepEqual(visible.map((item) => item.id), ['telegram_running', 'desktop_paused']);
  }

  {
    const visible = visibleRecentTasksForHandoff([
      task('active_1', 'running', 'desktop'),
      task('active_2', 'blocked', 'desktop'),
      task('active_3', 'waiting_confirmation', 'desktop'),
      task('telegram_done', 'completed', 'telegram'),
      task('imessage_done', 'completed', 'imessage'),
    ]);
    assert.deepEqual(visible.map((item) => item.id), ['active_1', 'active_2', 'active_3', 'telegram_done']);
  }

  {
    assert.deepEqual(visibleRecentTasksForHandoff([task('telegram_done', 'completed', 'telegram')], 1).map((item) => item.id), ['telegram_done']);
    assert.deepEqual(visibleRecentTasksForHandoff([task('desktop_done', 'completed', 'desktop')]), []);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
