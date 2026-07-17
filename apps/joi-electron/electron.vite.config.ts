import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const piComputerUseRoot = dirname(require.resolve('@injaneity/pi-computer-use/package.json'));

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@earendil-works/pi-coding-agent': resolve(appDir, 'src/main/pi-coding-agent-shim.ts'),
        '@injaneity/pi-computer-use/src/bridge.ts': resolve(piComputerUseRoot, 'src/bridge.ts'),
        '@injaneity/pi-computer-use/src/platform/macos/helper.ts': resolve(piComputerUseRoot, 'src/platform/macos/helper.ts'),
      },
    },
    ssr: {
      noExternal: ['@joi/shared-types', '@injaneity/pi-computer-use'],
    },
    build: {
      externalizeDeps: {
        exclude: ['@injaneity/pi-computer-use'],
      },
      outDir: 'dist/main',
      rollupOptions: {
        external: ['electron', 'node-pty', /^node:/],
      },
    },
  },
  preload: {
    ssr: {
      noExternal: ['@joi/shared-types'],
    },
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        external: ['electron', /^node:/],
      },
    },
  },
  renderer: {
    root: appDir,
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router-dom'],
      alias: {
        react: resolve(appDir, 'node_modules/react'),
        'react-dom': resolve(appDir, 'node_modules/react-dom'),
        'react-router-dom': resolve(appDir, 'node_modules/react-router-dom'),
      },
    },
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: resolve(appDir, 'index.html'),
      },
    },
  },
});
