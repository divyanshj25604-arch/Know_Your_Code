import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../src/config/env';

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
});
