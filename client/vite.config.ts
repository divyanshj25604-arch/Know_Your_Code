/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveBaseUrl } from './src/api/config';

const API = process.env.VITE_API_TARGET ?? 'http://localhost:8080';

export default defineConfig(({ mode }) => {
  // Check the API base URL when the build (or dev server) starts, so a bad value fails here with a clear message
  // instead of shipping a bundle that cannot reach its API. Throws ApiConfigError.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  resolveBaseUrl(env.VITE_API_BASE_URL, { production: mode === 'production' });

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // changeOrigin must stay false: the browser's Origin (localhost:5173) then matches the forwarded Host, which
        // the API's same-origin check requires. (The string shorthand '/api': url sets changeOrigin: true and breaks
        // POSTs.)
        '/api': { target: API, changeOrigin: false },
      },
    },
    build: { outDir: 'dist', sourcemap: true },
    test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: true, css: false },
  };
});
