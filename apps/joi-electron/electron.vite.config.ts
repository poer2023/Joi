import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const appDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    ssr: {
      noExternal: ['@joi/shared-types'],
    },
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        external: ['electron', /^node:/],
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
