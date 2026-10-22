import { loadConfig } from '../config/env';
import { loadDotEnv } from '../config/dotenv';
import { createPool } from './pool';
import { migrate } from './migrate';

loadDotEnv();
const cfg = loadConfig();
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
