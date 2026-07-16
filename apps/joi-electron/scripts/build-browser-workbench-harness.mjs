#!/usr/bin/env node

import { build } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(appDir, '.e2e', 'browser-workbench-harness');

await build({
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: resolve(appDir, 'scripts/browser-workbench-harness.ts'),
    outDir,
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: ['electron', /^node:/],
      output: { entryFileNames: 'browser-workbench-harness.mjs' },
    },
  },
});

process.stdout.write(`${outDir}/browser-workbench-harness.mjs\n`);
