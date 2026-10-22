/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // changeOrigin must stay false: the browser's Origin (localhost:5173) then matches the forwarded Host, which the
      // API's same-origin check requires. (The string shorthand '/api': url sets changeOrigin: true and breaks POSTs.)
      '/api': { target: API, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: true, css: false },
});
