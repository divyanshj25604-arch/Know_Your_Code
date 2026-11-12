import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate-cli.ts', 'src/analysis/worker.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace packages (TS source); keep third-party deps external.
  noExternal: ['@kyc/contracts', '@kyc/core'],
  // Marks the deployed build: it refuses to start without NODE_ENV=production and never reads a parent .env.
  define: { __KYC_BUNDLED__: 'true' },
  onSuccess: async () => {
    cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
  },
});
