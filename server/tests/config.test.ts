import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadConfig, ConfigError, CONFIG_KEYS, DEV_COOKIE_SECRET } from '../src/config/env';

describe('loadConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
  it('requires a cookie secret and API key in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' } as NodeJS.ProcessEnv),
    ).toThrow(/COOKIE_SECRET[\s\S]*ANTHROPIC_API_KEY/);
  });
  it('accepts production config with the fake provider only when explicit', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x/y',
      COOKIE_SECRET: 'x'.repeat(20),
      LLM_PROVIDER: 'fake',
    } as NodeJS.ProcessEnv);
    expect(c.LLM_PROVIDER).toBe('fake');
  });
  it('requires GROQ_API_KEY in production when LLM_PROVIDER=groq', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x/y',
        COOKIE_SECRET: 'x'.repeat(20),
        LLM_PROVIDER: 'groq',
      } as NodeJS.ProcessEnv),
    ).toThrow(/GROQ_API_KEY/);
  });
  it('treats empty string environment variables as undefined', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgres://x/y',
      ANTHROPIC_API_KEY: '',
      GROQ_API_KEY: '',
      GITHUB_TOKEN: '',
      COOKIE_SECRET: '',
    } as NodeJS.ProcessEnv);
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.GROQ_API_KEY).toBeUndefined();
    expect(c.GITHUB_TOKEN).toBeUndefined();
  });
  it('rejects malformed numbers instead of silently defaulting', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y', PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow(
      /PORT/,
    );
  });

  describe('production safety (P0.1)', () => {
    const prod = (over: Record<string, string> = {}) =>
      ({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x/y',
        COOKIE_SECRET: 'x'.repeat(20),
        LLM_PROVIDER: 'fake',
        ...over,
      }) as NodeJS.ProcessEnv;

    it('refuses a deployed build when NODE_ENV is unset, naming the fix', () => {
      const { NODE_ENV: _omit, ...env } = prod();
      expect(() => loadConfig(env as NodeJS.ProcessEnv, { bundled: true })).toThrow(
        /NODE_ENV must be set to "production" explicitly[\s\S]*unset/,
      );
    });

    it('refuses a deployed build with any other NODE_ENV', () => {
      expect(() => loadConfig(prod({ NODE_ENV: 'development' }), { bundled: true })).toThrow(
        /NODE_ENV must be set to "production"[\s\S]*"development"/,
      );
    });

    it('accepts a deployed build with explicit production settings', () => {
      expect(loadConfig(prod(), { bundled: true }).NODE_ENV).toBe('production');
    });

    it('still defaults NODE_ENV to development for source runs', () => {
      expect(loadConfig({ DATABASE_URL: 'postgres://x/y' } as NodeJS.ProcessEnv).NODE_ENV).toBe(
        'development',
      );
    });

    it('requires COOKIE_SECRET in production and rejects the public development value', () => {
      const { COOKIE_SECRET: _omit, ...noSecret } = prod();
      expect(() => loadConfig(noSecret as NodeJS.ProcessEnv)).toThrow(/COOKIE_SECRET is required/);
      expect(() => loadConfig(prod({ COOKIE_SECRET: DEV_COOKIE_SECRET }))).toThrow(
        /COOKIE_SECRET must not be the public development value/,
      );
    });

    it('forces worker analysis in production: inline is rejected and auto is upgraded', () => {
      expect(() => loadConfig(prod({ ANALYSIS_MODE: 'inline' }))).toThrow(
        /ANALYSIS_MODE=inline is not allowed/,
      );
      expect(loadConfig(prod({ ANALYSIS_MODE: 'auto' })).ANALYSIS_MODE).toBe('worker');
      expect(loadConfig(prod()).ANALYSIS_MODE).toBe('worker');
      // Development keeps the convenient fallback.
      expect(loadConfig({ DATABASE_URL: 'postgres://x/y' } as NodeJS.ProcessEnv).ANALYSIS_MODE).toBe('auto');
    });

    it('reports every problem at once', () => {
      const { COOKIE_SECRET: _omit, ...env } = prod({ LLM_PROVIDER: 'anthropic', ANALYSIS_MODE: 'inline' });
      const err = (() => {
        try {
          loadConfig(env as NodeJS.ProcessEnv);
        } catch (e) {
          return e as Error;
        }
        return null;
      })();
      expect(err).toBeInstanceOf(ConfigError);
      expect(err?.message).toMatch(/COOKIE_SECRET[\s\S]*ANTHROPIC_API_KEY[\s\S]*ANALYSIS_MODE/);
    });
  });

  it('.env.example documents every variable the server reads (P0.1)', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const documented = new Set([...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    expect(CONFIG_KEYS.filter((k) => !documented.has(k))).toEqual([]);
  });
});

describe('provider configuration (P4.5)', () => {
  const prod = (over: Record<string, string>) =>
    ({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x/y',
      COOKIE_SECRET: 'a-production-cookie-secret',
      ...over,
    }) as NodeJS.ProcessEnv;
  const prices = {
    MODEL_FAST_INPUT_USD_PER_MTOK: '1',
    MODEL_FAST_OUTPUT_USD_PER_MTOK: '2',
    MODEL_STRONG_INPUT_USD_PER_MTOK: '3',
    MODEL_STRONG_OUTPUT_USD_PER_MTOK: '4',
  };

  it('has no built-in Groq models: both tiers must be named explicitly', () => {
    const base = {
      DATABASE_URL: 'postgres://x/y',
      LLM_PROVIDER: 'groq',
      GROQ_API_KEY: 'k',
    } as NodeJS.ProcessEnv;
    expect(() => loadConfig(base)).toThrow(/MODEL_FAST must name a current Groq model[\s\S]*MODEL_STRONG/);
    expect(() => loadConfig({ ...base, MODEL_FAST: 'claude-haiku-5-5', MODEL_STRONG: 'x' })).toThrow(
      /MODEL_FAST/,
    );
    const c = loadConfig({ ...base, MODEL_FAST: 'vendor/small', MODEL_STRONG: 'vendor/large' });
    expect([c.MODEL_FAST, c.MODEL_STRONG]).toEqual(['vendor/small', 'vendor/large']);
  });

  it('a real provider in production needs explicit prices; the placeholders are for development only', () => {
    expect(() => loadConfig(prod({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }))).toThrow(
      /MODEL_FAST_INPUT_USD_PER_MTOK, MODEL_FAST_OUTPUT_USD_PER_MTOK, MODEL_STRONG_INPUT_USD_PER_MTOK, MODEL_STRONG_OUTPUT_USD_PER_MTOK must be set explicitly/,
    );
    expect(() =>
      loadConfig(
        prod({
          LLM_PROVIDER: 'anthropic',
          ANTHROPIC_API_KEY: 'k',
          ...prices,
          MODEL_FAST_INPUT_USD_PER_MTOK: ' ',
        }),
      ),
    ).toThrow(/MODEL_FAST_INPUT_USD_PER_MTOK must be set/);
    expect(
      loadConfig(prod({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ...prices }))
        .MODEL_STRONG_OUTPUT_USD_PER_MTOK,
    ).toBe(4);
    expect(() => loadConfig(prod({ LLM_PROVIDER: 'fake' }))).not.toThrow();
    // An empty value (as in .env.example) falls back to the development placeholder, never to 0.
    expect(
      loadConfig({ DATABASE_URL: 'postgres://x/y', MODEL_FAST_INPUT_USD_PER_MTOK: '' } as NodeJS.ProcessEnv)
        .MODEL_FAST_INPUT_USD_PER_MTOK,
    ).toBe(0.1);
  });
});
