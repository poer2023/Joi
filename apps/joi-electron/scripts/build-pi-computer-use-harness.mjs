#!/usr/bin/env node

import { build } from 'vite';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(appDir, '.e2e', 'pi-computer-use-harness');
const require = createRequire(import.meta.url);
const piComputerUseRoot = dirname(require.resolve('@injaneity/pi-computer-use/package.json'));

await build({
  configFile: false,
  logLevel: 'warn',
  resolve: {
    alias: {
      '@earendil-works/pi-coding-agent': resolve(appDir, 'src/main/pi-coding-agent-shim.ts'),
      '@injaneity/pi-computer-use/src/bridge.ts': resolve(piComputerUseRoot, 'src/bridge.ts'),
      '@injaneity/pi-computer-use/src/platform/macos/helper.ts': resolve(piComputerUseRoot, 'src/platform/macos/helper.ts'),
    },
  },
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: resolve(appDir, 'scripts/pi-computer-use-harness.ts'),
    outDir,
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: ['electron', /^node:/],
      output: {
        entryFileNames: 'pi-computer-use-harness.mjs',
      },
    },
  },
});

process.stdout.write(`${outDir}/pi-computer-use-harness.mjs\n`);
