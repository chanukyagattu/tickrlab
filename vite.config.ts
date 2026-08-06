/// <reference types="node" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ESM config file: __dirname does not exist, so derive it from import.meta.url.
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  // Served from https://chanukyagattu.github.io/tickrlab/ — every asset URL
  // must carry this prefix or the deployed bundle 404s while dev works fine.
  base: '/tickrlab/',

  resolve: {
    alias: { '@': path.resolve(dirname, './src') },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // lightweight-charts is the single largest dependency and changes far
        // less often than app code. Splitting it keeps the app chunk small and
        // lets the chart library stay cached across deploys.
        manualChunks: { charts: ['lightweight-charts'] },
      },
    },
  },

  worker: { format: 'es' },

  test: {
    environment: 'node',
    // Provider parsers live in scripts/ because they run under plain Node in
    // CI, not through the bundler. They are still worth testing.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
