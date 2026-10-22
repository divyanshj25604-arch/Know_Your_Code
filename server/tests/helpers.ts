import { loadConfig, type Config } from '../src/config/env';
import { createPool, type Db } from '../src/db/pool';

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost/kyc_test',
    LOG_LEVEL: 'silent',
    LLM_PROVIDER: 'fake',
    RATE_LIMIT_DISABLED: 'true',
    STATIC_DIR: '/nonexistent',
    ...over,
  } as NodeJS.ProcessEnv);
}

export function testDb(config = testConfig()): Db {
  return createPool(config.DATABASE_URL);
}
