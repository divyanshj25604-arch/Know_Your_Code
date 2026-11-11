import { loadConfig, ConfigError } from '../config/env';
import { loadDotEnv } from '../config/dotenv';
import { IS_BUNDLED } from '../config/build';
import { createPool } from './pool';
import { migrate } from './migrate';

loadDotEnv(process.cwd(), { searchParent: !IS_BUNDLED });
let cfg;
try {
  cfg = loadConfig(process.env, { bundled: IS_BUNDLED });
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}
const db = createPool(cfg.DATABASE_URL);
migrate(db)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
    return db.end();
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
