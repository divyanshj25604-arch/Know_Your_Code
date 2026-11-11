import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

/**
 * Exact origins (scheme://host[:port]) allowed to call the API from another origin, e.g. a desktop shell
 * (`tauri://localhost`, `http://tauri.localhost`). Comma-separated. No wildcards: CORS is never opened to everyone.
 * Allowed cross-origin requests authenticate with bearer tokens only; cookies are never sent or accepted for them.
 */
const ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+$/;
const CorsOrigins = z
  .string()
  .default('')
  .transform((raw, ctx) => {
    const out: string[] = [];
    for (const part of raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)) {
      const o = part.toLowerCase();
      if (o === '*' || o.includes('*')) {
        ctx.addIssue({ code: 'custom', message: 'wildcards are not allowed; list exact origins' });
      } else if (o === 'null') {
        ctx.addIssue({ code: 'custom', message: '"null" is not an origin that can be trusted' });
      } else if (!ORIGIN_RE.test(o)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${part}" is not an origin (expected scheme://host[:port], no path or trailing slash)`,
        });
      } else if (!out.includes(o)) out.push(o);
    }
    return out;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_BASE_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  COOKIE_SECRET: emptyToUndefined(z.string().min(16).optional()),
  // Set true only when running behind a reverse proxy you control (Replit, nginx...): it makes req.ip honour
  // X-Forwarded-For. Left false, a client cannot spoof its IP to dodge the per-IP rate limit.
  TRUST_PROXY: bool.default('false'),
  // Defaults to true in production. Set false only for plain-http deployments (browsers drop Secure cookies there).
  COOKIE_SECURE: emptyToUndefined(bool.optional()),

  // AI
  LLM_PROVIDER: z.enum(['anthropic', 'fake', 'groq']).default('anthropic'),
  ANTHROPIC_API_KEY: emptyToUndefined(z.string().min(1).optional()),
  GROQ_API_KEY: emptyToUndefined(z.string().min(1).optional()),
  GROQ_API_BASE: z.string().url().default('https://api.groq.com/openai/v1'),
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
  GITHUB_TOKEN: emptyToUndefined(z.string().min(1).optional()),
  GITHUB_API_BASE: z.string().url().default('https://api.github.com'),
  GITHUB_CODELOAD_BASE: z.string().url().default('https://codeload.github.com'),

  // Accounts (P1.2). Sessions expire absolutely after this many days; sign-in again issues a new one.
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Register and sign-in attempts per client IP per hour (sign-in is also limited per email address).
  RATE_AUTH_PER_HOUR: z.coerce.number().int().positive().default(20),

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
  // "auto" uses a worker thread when the compiled worker exists and runs inline otherwise. Production always uses
  // "worker" (see loadConfig): "inline" is rejected there and "auto" is upgraded.
  ANALYSIS_MODE: z.enum(['auto', 'worker', 'inline']).default('auto'),
  ANALYSIS_WORKER_PATH: emptyToUndefined(z.string().optional()),
  ANALYSIS_MAX_MEMORY_MB: z.coerce.number().int().min(256).default(2048),

  // Rate limits
  RATE_LIMIT_DISABLED: bool.default('false'),
  RATE_IMPORTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_EXPLANATIONS_PER_HOUR: z.coerce.number().int().positive().default(60),
  RATE_FOLLOWUPS_PER_HOUR: z.coerce.number().int().positive().default(120),

  CORS_ALLOWED_ORIGINS: CorsOrigins,

  STATIC_DIR: emptyToUndefined(z.string().optional()),
  APP_VERSION: z.string().default('1.0.0'),
});

export type Config = z.infer<typeof EnvSchema> & { cookieSecret: string };

/** Every variable the server reads (kept in step with .env.example by tests/config.test.ts). */
export const CONFIG_KEYS: readonly string[] = Object.keys(EnvSchema.shape);

export class ConfigError extends Error {}

/** Used only outside production. A production config that sets this value is rejected. */
export const DEV_COOKIE_SECRET = 'dev-only-insecure-cookie-secret-change-me';

export interface LoadConfigOptions {
  /**
   * True for the deployed (bundled) server. A deployed build must be told `NODE_ENV=production` explicitly: the
   * schema default (`development`) would otherwise turn off Secure cookies, HSTS and the secret checks (risk S1).
   */
  bundled?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: LoadConfigOptions = {}): Config {
  const problems: string[] = [];
  if (opts.bundled && env.NODE_ENV !== 'production') {
    problems.push(
      `NODE_ENV must be set to "production" explicitly for a deployed build (it is ${
        env.NODE_ENV === undefined ? 'unset' : `"${env.NODE_ENV}"`
      }). For local development run "npm run dev" instead of the built server.`,
    );
  }
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    problems.push(...parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`));
    throw new ConfigError(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (!c.COOKIE_SECRET) problems.push('COOKIE_SECRET is required in production (>= 16 chars)');
    else if (c.COOKIE_SECRET === DEV_COOKIE_SECRET)
      problems.push('COOKIE_SECRET must not be the public development value in production');
    if (c.LLM_PROVIDER === 'anthropic' && !c.ANTHROPIC_API_KEY) {
      problems.push('ANTHROPIC_API_KEY is required in production when LLM_PROVIDER=anthropic');
    }
    if (c.LLM_PROVIDER === 'groq' && !c.GROQ_API_KEY) {
      problems.push('GROQ_API_KEY is required in production when LLM_PROVIDER=groq');
    }
    if (c.ANALYSIS_MODE === 'inline') {
      problems.push(
        'ANALYSIS_MODE=inline is not allowed in production: analysis must run in a memory-capped worker thread',
      );
    }
  }
  if (problems.length)
    throw new ConfigError(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return {
    ...c,
    // Production never falls back to in-process analysis (risk S6): a missing worker is a startup-visible failure.
    ANALYSIS_MODE: c.NODE_ENV === 'production' ? 'worker' : c.ANALYSIS_MODE,
    cookieSecret: c.COOKIE_SECRET ?? DEV_COOKIE_SECRET,
  };
}
