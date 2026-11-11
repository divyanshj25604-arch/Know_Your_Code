import { loadConfig, ConfigError } from './config/env';
import { loadDotEnv } from './config/dotenv';
import { IS_BUNDLED } from './config/build';
import { resolveWorkerPath } from './analysis/runner';
import { createPool } from './db/pool';
import { migrate } from './db/migrate';
import { buildApp } from './app';
import { scheduleRetention } from './jobs/retention';

async function main() {
  loadDotEnv(process.cwd(), { searchParent: !IS_BUNDLED });
  let config;
  try {
    config = loadConfig(process.env, { bundled: IS_BUNDLED });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  if (config.ANALYSIS_MODE === 'worker' && !resolveWorkerPath(config.ANALYSIS_WORKER_PATH)) {
    console.error(
      'Invalid configuration:\n  - the analysis worker script was not found; build with "npm run build" or set ANALYSIS_WORKER_PATH',
    );
    process.exit(1);
  }
  const db = createPool(config.DATABASE_URL);
  try {
    await migrate(db);
  } catch (e) {
    console.error(`Database not ready: ${(e as Error).message}`);
    process.exit(1);
  }
  const app = await buildApp({ config, db });
  const recovered = await app.services.runner.recover();
  if (recovered) app.log.info({ recovered }, 're-queued interrupted imports');
  if (config.NODE_ENV === 'production' && config.LLM_PROVIDER === 'fake') {
    app.log.warn(
      'LLM_PROVIDER=fake in production: explanations come from the deterministic TEST provider, not Claude',
    );
  }
  if (!config.GITHUB_TOKEN) {
    app.log.warn(
      'GITHUB_TOKEN is not set: imports use anonymous codeload and cannot pre-check repository size or visibility',
    );
  }
  const stopRetention = scheduleRetention(db, app.log);
  const shutdown = async (sig: string) => {
    app.log.info({ sig }, 'shutting down');
    stopRetention();
    // Do not wait forever for an import in flight: it is re-queued on the next boot.
    setTimeout(() => process.exit(0), 10_000).unref();
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
