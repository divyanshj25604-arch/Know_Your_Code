import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { runRetention } from '../src/jobs/retention';
import { Harness } from './harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const post = (headers: Record<string, string>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/repositories',
    payload: { url: 'https://github.com/acme/notes-api' },
    headers,
  });

describe('cross-site request protection', () => {
  it('refuses state-changing requests the browser marks cross-site', async () => {
    const res = await post({ 'sec-fetch-site': 'cross-site' });
    expect(res.statusCode).toBe(403);
    expect((await h.db.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(0);
  });

  it.each([['https://evil.example'], ['null'], ['not a url']])(
    'refuses a foreign Origin (%s)',
    async (origin) => {
      expect((await post({ origin })).statusCode).toBe(403);
    },
  );

  it('accepts same-origin browsers and non-browser clients', async () => {
    expect((await post({ origin: 'http://localhost:80', 'sec-fetch-site': 'same-origin' })).statusCode).toBe(
      202,
    );
    await h.app.services.runner.idle();
    expect((await post({})).statusCode).toBe(202); // curl / server-to-server: no Origin header
  });

  it('accepts the configured public origin even if a proxy rewrote Host, but nothing else', async () => {
    await h.close();
    await h.reset({
      llm: new FakeLlm(),
      repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
      env: { APP_BASE_URL: 'https://kyc.example.com' },
    });
    expect((await post({ origin: 'https://kyc.example.com' })).statusCode).toBe(202);
    await h.app.services.runner.idle();
    expect((await post({ origin: 'https://evil.example.com' })).statusCode).toBe(403);
  });

  it('never blocks reads', async () => {
    const res = await h.app.inject({ url: '/api/v1/health', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('response headers', () => {
  it('sets a restrictive CSP and anti-sniffing/framing headers, and never caches API JSON', async () => {
    const res = await h.app.inject({ url: '/api/v1/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['content-security-policy']).not.toMatch(/script-src[^;]*unsafe/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('also applies to error responses', async () => {
    const res = await h.app.inject({ url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('owner cookie', () => {
  it('is httpOnly, SameSite=Lax and signed; a forged value is ignored', async () => {
    const res = await post({});
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/kyc_owner=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/kyc_owner=[0-9a-f-]{36}\./); // value.signature
    // A forged (unsigned) id for another owner is treated as no cookie: a fresh owner is minted.
    const victim = (await h.db.query('SELECT id FROM owners LIMIT 1')).rows[0].id as string;
    const forged = await h.app.inject({
      method: 'GET',
      url: '/api/v1/my/snapshots',
      headers: { cookie: `kyc_owner=${victim}` },
    });
    expect(forged.headers['set-cookie']).toBeTruthy();
    expect((await h.db.query('SELECT count(*)::int AS n FROM owners')).rows[0].n).toBe(2);
  });
});

describe('proxy trust and cookies', () => {
  it('does not trust X-Forwarded-For unless TRUST_PROXY is set (per-IP limit cannot be spoofed)', async () => {
    await h.close();
    await h.reset({
      llm: new FakeLlm(),
      repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
      env: { RATE_LIMIT_DISABLED: 'false', RATE_IMPORTS_PER_HOUR: '1' },
    });
    const call = (xff: string, cookie?: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/repositories',
        payload: { url: 'https://github.com/acme/notes-api' },
        headers: { 'x-forwarded-for': xff, ...(cookie ? { cookie } : {}) },
      });
    // IP limit is 4x the per-owner limit (4). Fresh owners each time, rotating the spoofed address.
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await call(`10.0.0.${i}`)).statusCode);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });

  it('marks the cookie Secure in production unless COOKIE_SECURE=false', async () => {
    await h.close();
    await h.reset({
      llm: new FakeLlm(),
      repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
      env: { NODE_ENV: 'production', COOKIE_SECRET: 'c'.repeat(20), COOKIE_SECURE: 'false' },
    });
    const res = await post({});
    expect(String(res.headers['set-cookie'])).not.toMatch(/Secure/i);
    await h.close();
    await h.reset({
      llm: new FakeLlm(),
      repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
      env: { NODE_ENV: 'production', COOKIE_SECRET: 'c'.repeat(20) },
    });
    expect(String((await post({})).headers['set-cookie'])).toMatch(/Secure/i);
  });
});

describe('request limits', () => {
  it('rejects oversized bodies', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/repositories',
      payload: { url: 'x'.repeat(100_000) },
    });
    expect(res.statusCode).toBe(413);
  });
  it('rejects non-JSON bodies without leaking parser details', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/repositories',
      payload: 'url=x',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(415);
    expect(res.body).not.toMatch(/Unsupported|FST_/);
    expect(res.json().error.code).toBe('INVALID_REQUEST');
  });
});

describe('retention', () => {
  it('deletes expired snapshots with an audit row and keeps fresh ones; trims old operational rows', async () => {
    await h.importRepo('https://github.com/acme/notes-api');
    await h.db.query(
      `INSERT INTO llm_calls (task, model, prompt_version, status, created_at) VALUES ('explain','m','p','ok', now() - interval '100 days'), ('explain','m','p','ok', now())`,
    );
    expect((await runRetention(h.db, h.app.log)).snapshots).toBe(0);
    expect((await h.db.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(1);
    expect(
      (
        await h.db.query(
          "SELECT count(*)::int AS n FROM llm_calls WHERE created_at < now() - interval '90 days'",
        )
      ).rows[0].n,
    ).toBe(0);

    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    expect((await runRetention(h.db, h.app.log)).snapshots).toBe(1);
    for (const t of ['snapshots', 'files', 'symbols', 'edges', 'repositories']) {
      expect((await h.db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
    }
    expect((await h.db.query('SELECT repository_ref, reason FROM deletion_log')).rows).toEqual([
      { repository_ref: 'acme/notes-api', reason: 'retention' },
    ]);
  });
});
