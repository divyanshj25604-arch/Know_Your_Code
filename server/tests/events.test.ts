import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { Harness } from './harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm() }));
afterEach(() => h.close());

const rows = async () =>
  (
    await h.db.query<{ owner_id: string | null; name: string; props: Record<string, unknown> }>(
      'SELECT owner_id, name, props FROM events ORDER BY id',
    )
  ).rows;

describe('POST /api/v1/events', () => {
  it('stores allowed events against the caller and returns 204', async () => {
    const res = await h.post('/api/v1/events', {
      events: [
        { name: 'landing_cta', props: { place: 'hero', n: 2, ok: true } },
        { name: 'import_submitted' },
      ],
    });
    expect(res.statusCode).toBe(204);
    const stored = await rows();
    expect(stored.map((r) => r.name)).toEqual(['landing_cta', 'import_submitted']);
    expect(stored[0]?.props).toEqual({ place: 'hero', n: 2, ok: true });
    expect(stored[1]?.props).toEqual({});
    // Attributed to the owner the response identified (cookie set on the same request).
    const owner = (await h.db.query<{ id: string }>('SELECT id FROM users')).rows;
    expect(owner).toHaveLength(1);
    expect(stored.every((r) => r.owner_id === owner[0]?.id)).toBe(true);
  });

  it.each([
    ['an unknown event name', { events: [{ name: 'drop_tables' }] }],
    ['nested props', { events: [{ name: 'landing_cta', props: { a: { b: 1 } } }] }],
    ['an over-long prop value', { events: [{ name: 'landing_cta', props: { a: 'x'.repeat(101) } }] }],
    ['more than 50 events', { events: Array.from({ length: 51 }, () => ({ name: 'landing_cta' })) }],
    ['a missing events array', { name: 'landing_cta' }],
  ])('rejects %s with 400 and stores nothing', async (_label, payload) => {
    const res = await h.post('/api/v1/events', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_REQUEST');
    expect(await rows()).toHaveLength(0);
  });

  it('rate-limits event submissions (600 requests per owner per hour)', async () => {
    await h.close();
    await h.reset({ llm: new FakeLlm(), env: { RATE_LIMIT_DISABLED: 'false' } });
    const batch = { events: Array.from({ length: 50 }, () => ({ name: 'landing_cta' })) };
    // The limit counts requests, not events. (The global 600/min IP limiter would also answer 429 here.)
    for (let i = 0; i < 600; i++) {
      const r = await h.post('/api/v1/events', { events: [{ name: 'landing_cta' }] });
      if (r.statusCode !== 204) throw new Error(`request ${i} failed early: ${r.statusCode}`);
    }
    const limited = await h.post('/api/v1/events', batch);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });
});
