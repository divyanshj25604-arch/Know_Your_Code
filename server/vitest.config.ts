import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
    // Integration tests share one Postgres database; run files serially to avoid cross-test interference.
    fileParallelism: false,
  },
});
