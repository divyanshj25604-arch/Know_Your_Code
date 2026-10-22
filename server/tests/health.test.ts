import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { testConfig, testDb } from './helpers';

describe('GET /api/v1/health', () => {
  const config = testConfig();
  const db = testDb(config);
  afterAll(() => db.end());

  it('reports db ok and the test provider honestly', async () => {
    const app = await buildApp({ config, db });
    const res = await app.inject({ url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ db: 'ok', ai: 'test_provider', github: 'anonymous' });
    await app.close();
  });

  it('reports degraded when the AI key is missing', async () => {
    const cfg = testConfig({ LLM_PROVIDER: 'anthropic' });
    const app = await buildApp({ config: cfg, db });
    const res = await app.inject({ url: '/api/v1/health' });
    expect(res.json()).toMatchObject({ status: 'degraded', ai: 'not_configured' });
    await app.close();
  });

  it('never leaks internals on unknown API routes', async () => {
    const app = await buildApp({ config, db });
    const res = await app.inject({ url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });
});
