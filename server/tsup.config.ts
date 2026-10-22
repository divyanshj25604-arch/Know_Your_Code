import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate-cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (TS source); keep third-party deps external.
  noExternal: ['@kyc/contracts'],
  onSuccess: async () => {
    cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
  },
});
