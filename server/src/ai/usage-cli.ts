/**
 * Operator report of AI usage (P4.3): calls, users, failures, tokens and cost per day, capability and model.
 *   npm run ai:usage -w server            # last 7 days
 *   npm run ai:usage -w server -- 30      # last 30 days
 * Reads the cost ledger only (llm_calls). It contains no prompts, answers or code.
 */
import { loadConfig, ConfigError } from '../config/env';
import { loadDotEnv } from '../config/dotenv';
import { IS_BUNDLED } from '../config/build';
import { createPool } from '../db/pool';
import { spentTodayUsd, usageReport } from './cost';

loadDotEnv(process.cwd(), { searchParent: !IS_BUNDLED });
let cfg;
try {
  cfg = loadConfig(process.env, { bundled: IS_BUNDLED });
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}
const days = Math.min(90, Math.max(1, Number(process.argv[2] ?? 7) || 7));
const db = createPool(cfg.DATABASE_URL);
Promise.all([usageReport(db, days), spentTodayUsd(db)])
  .then(([rows, today]) => {
    console.table(rows);
    console.log(
      `Today: $${today.toFixed(4)} of the $${cfg.DAILY_SPEND_CAP_USD} global cap; per-user cap $${cfg.AI_USER_DAILY_BUDGET_USD}, ${cfg.AI_USER_DAILY_REQUESTS} calls.`,
    );
    return db.end();
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
