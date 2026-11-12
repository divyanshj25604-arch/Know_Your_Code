import { defineConfig, devices } from '@playwright/test';

const LIVE = process.env.LIVE === '1';
const DETERMINISTIC_PORT = 4600;
const LIVE_PORT = 4601;
const DESKTOP_PORT = 4610;
const dbUrl =
  process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? 'postgres://localhost/kyc_test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'deterministic',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /live\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${DETERMINISTIC_PORT}` },
    },
    ...(LIVE
      ? [
          {
            name: 'live',
            testMatch: /live\.spec\.ts/,
            timeout: 180_000,
            use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${LIVE_PORT}` },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'npx tsx server/tests/e2e-server.ts',
      url: `http://127.0.0.1:${DETERMINISTIC_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { E2E_PORT: String(DETERMINISTIC_PORT), E2E_DATABASE_URL: dbUrl },
    },
    {
      // The built client on a second origin, standing in for the desktop shell's tauri://localhost (desktop.spec.ts).
      command: `npx vite preview --config client/vite.config.ts --outDir client/dist --host 127.0.0.1 --port ${DESKTOP_PORT} --strictPort`,
      url: `http://127.0.0.1:${DESKTOP_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...(LIVE
      ? [
          {
            // Real GitHub (codeload) and, when ANTHROPIC_API_KEY is set, the real Claude API.
            command: 'node server/dist/server.js',
            url: `http://127.0.0.1:${LIVE_PORT}/api/v1/health`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              NODE_ENV: 'production',
              PORT: String(LIVE_PORT),
              HOST: '127.0.0.1',
              DATABASE_URL: dbUrl,
              COOKIE_SECRET: 'live-cookie-secret-0123456789',
              LLM_PROVIDER: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'fake',
              ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
              ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
              // A real provider in production needs explicit prices (P4.5); pass the operator's values through.
              ...Object.fromEntries(
                Object.entries(process.env).filter(
                  (e): e is [string, string] =>
                    /^MODEL_(FAST|STRONG)(_(INPUT|OUTPUT)_USD_PER_MTOK)?$/.test(e[0]) && !!e[1],
                ),
              ),
              LOG_LEVEL: 'warn',
              STATIC_DIR: 'client/dist',
              RATE_LIMIT_DISABLED: 'true',
            },
          },
        ]
      : []),
  ],
});
