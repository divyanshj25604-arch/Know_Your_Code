import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_BASE_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  COOKIE_SECRET: z.string().min(16).optional(),

  // AI
  LLM_PROVIDER: z.enum(['anthropic', 'fake']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  MODEL_FAST: z.string().default('claude-haiku-5-5'),
  MODEL_STRONG: z.string().default('claude-sonnet-5-5'),
  // Prices are configuration, not facts baked into code. Verify against the provider's pricing page.
  MODEL_FAST_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(0.1),
  MODEL_FAST_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(0.5),
  MODEL_STRONG_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(2),
  MODEL_STRONG_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(10),
  DAILY_SPEND_CAP_USD: z.coerce.number().nonnegative().default(5),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // GitHub
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_API_BASE: z.string().url().default('https://api.github.com'),
  GITHUB_CODELOAD_BASE: z.string().url().default('https://codeload.github.com'),

  // Data lifecycle
  RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(7),

  // Limits (docs/08 §3)
  MAX_TARBALL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  MAX_REPORTED_REPO_KB: z.coerce
    .number()
    .int()
    .positive()
    .default(200 * 1024),
  MAX_ANALYSABLE_FILES: z.coerce.number().int().positive().default(1500),
  MAX_ANALYSABLE_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(300 * 1024),
  MAX_VIEWABLE_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  MAX_TOTAL_TEXT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 1024 * 1024),
  MAX_TOTAL_ENTRIES: z.coerce.number().int().positive().default(20_000),
  IMPORT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  IMPORT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  // "auto" uses a worker thread when the compiled worker exists (production build) and runs inline otherwise.
  ANALYSIS_MODE: z.enum(['auto', 'worker', 'inline']).default('auto'),
  ANALYSIS_WORKER_PATH: z.string().optional(),
  ANALYSIS_MAX_MEMORY_MB: z.coerce.number().int().min(256).default(2048),

  // Rate limits
  RATE_LIMIT_DISABLED: bool.default('false'),
  RATE_IMPORTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_EXPLANATIONS_PER_HOUR: z.coerce.number().int().positive().default(60),
  RATE_FOLLOWUPS_PER_HOUR: z.coerce.number().int().positive().default(120),

  STATIC_DIR: z.string().optional(),
  APP_VERSION: z.string().default('1.0.0'),
});

export type Config = z.infer<typeof EnvSchema> & { cookieSecret: string };

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  const problems: string[] = [];
  if (c.NODE_ENV === 'production') {
    if (!c.COOKIE_SECRET) problems.push('COOKIE_SECRET is required in production (>= 16 chars)');
    if (c.LLM_PROVIDER === 'anthropic' && !c.ANTHROPIC_API_KEY) {
      problems.push('ANTHROPIC_API_KEY is required in production when LLM_PROVIDER=anthropic');
    }
  }
  if (problems.length)
    throw new ConfigError(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return { ...c, cookieSecret: c.COOKIE_SECRET ?? 'dev-only-insecure-cookie-secret-change-me' };
}
