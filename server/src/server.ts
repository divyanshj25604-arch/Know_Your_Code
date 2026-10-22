import { loadConfig, ConfigError } from './config/env';
import { createPool } from './db/pool';
import { migrate } from './db/migrate';
import { buildApp } from './app';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const db = createPool(config.DATABASE_URL);
  try {
    await migrate(db);
  } catch (e) {
    console.error(`Database not ready: ${(e as Error).message}`);
    process.exit(1);
  }
  const app = await buildApp({ config, db });
  const shutdown = async (sig: string) => {
    app.log.info({ sig }, 'shutting down');
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
