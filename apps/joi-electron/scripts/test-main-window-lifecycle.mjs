import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

const ensureMainWindow = source.match(/function ensureMainWindow\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
const createMainWindow = source.match(/function createMainWindow\(\) \{([\s\S]*?)\n  const preloadPath/)?.[1] || '';

assert.match(ensureMainWindow, /if \(!app\.isReady\(\)\) return;/, 'second-instance and activate must not create a BrowserWindow before Electron is ready');
assert.match(createMainWindow, /if \(!app\.isReady\(\)\) return;/, 'createMainWindow must defend its own Electron readiness boundary');
assert.match(createMainWindow, /mainWindow && !mainWindow\.isDestroyed\(\)/, 'createMainWindow must not replace a live window during duplicate lifecycle events');
assert.match(source, /app\.whenReady\(\)\.then[\s\S]*?ensureMainWindow\(\);/, 'the initial ready path must use the guarded idempotent window entrypoint');

console.log('main window lifecycle contract passed');
