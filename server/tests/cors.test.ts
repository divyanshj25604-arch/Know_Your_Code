import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { ConfigError, loadConfig } from '../src/config/env';
import { Device } from './device';
import { Harness } from './harness';

const DESKTOP = 'tauri://localhost';
const DESKTOP_WIN = 'http://tauri.localhost';
const EVIL = 'https://evil.example';

const h = new Harness();
const app = () => h.app;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
    env: { CORS_ALLOWED_ORIGINS: `${DESKTOP}, ${DESKTOP_WIN}` },
  }),
);
afterEach(() => h.close());

const preflight = (origin: string, method = 'POST', headers = 'authorization, content-type') =>
  h.app.inject({
    method: 'OPTIONS',
    url: '/api/v1/repositories',
    headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers },
  });

describe('CORS allowlist (acceptance: P1.6)', () => {
  it("answers an allowed origin's preflight with exact-origin headers and no credentials", async () => {
    const res = await preflight(DESKTOP);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(DESKTOP);
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, DELETE');
    expect(res.headers['access-control-allow-headers']).toBe(
      'authorization, content-type, accept, x-kyc-share',
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it("an allowed desktop origin authenticates with a bearer token and sees the learner's repositories", async () => {
    const web = new Device(app);
    const { snapshotId } = await web.importRepo('acme/notes-api');
    await web.register('ada@example.com');

    const desktop = Device.bearer(app, DESKTOP);
    const login = await desktop.login('ada@example.com', undefined, 'bearer');
    expect(login.statusCode).toBe(200);
    expect(login.headers['access-control-allow-origin']).toBe(DESKTOP);
    expect(login.headers['set-cookie']).toBeUndefined();

    const mine = await desktop.get('/api/v1/my/snapshots');
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['access-control-allow-origin']).toBe(DESKTOP);
    expect(mine.json().snapshots.map((s: { snapshotId: string }) => s.snapshotId)).toEqual([snapshotId]);
    // Cross-origin, state-changing and authenticated: allowed for the desktop origin.
    const tree = await desktop.get(`/api/v1/snapshots/${snapshotId}/tree`);
    expect(tree.statusCode).toBe(200);
    const imp = await desktop.post('/api/v1/repositories', { url: 'https://github.com/acme/notes-api' });
    expect(imp.statusCode).toBe(202);
    await h.app.services.runner.idle();
  });

  it('works for every listed origin', async () => {
    expect((await preflight(DESKTOP_WIN)).headers['access-control-allow-origin']).toBe(DESKTOP_WIN);
  });

  it('never gives an allowed origin an anonymous identity or honours cookies from it', async () => {
    const web = new Device(app);
    await web.importRepo('acme/notes-api');
    await web.register('ada@example.com'); // web now holds a valid session cookie

    const noToken = await h.app.inject({ url: '/api/v1/my/snapshots', headers: { origin: DESKTOP } });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json().error.code).toBe('AUTH_REQUIRED');
    expect(noToken.headers['set-cookie']).toBeUndefined();

    // Even a valid session cookie is ignored for a cross-origin caller: bearer tokens only.
    const withCookie = await h.app.inject({
      url: '/api/v1/my/snapshots',
      headers: { origin: DESKTOP, cookie: web.cookieHeader },
    });
    expect(withCookie.statusCode).toBe(401);

    const cookieLogin = await Device.bearer(app, DESKTOP).post('/api/v1/auth/login', {
      email: 'ada@example.com',
      password: 'correct horse battery',
      transport: 'cookie',
    });
    expect(cookieLogin.statusCode).toBe(400);
  });

  it('rejects disallowed origins: preflight, reads and writes, with no CORS headers', async () => {
    const pre = await preflight(EVIL);
    expect(pre.statusCode).toBe(403);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    for (const res of [
      await h.app.inject({ url: '/api/v1/health', headers: { origin: EVIL } }),
      await h.app.inject({ url: '/api/v1/my/snapshots', headers: { origin: EVIL } }),
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: EVIL },
        payload: { email: 'a@b.co', password: 'x'.repeat(12) },
      }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    // Look-alikes of an allowed origin are different origins.
    for (const lookalike of ['tauri://localhost.evil', 'tauri://localhost:8080', 'https://tauri.localhost'])
      expect((await preflight(lookalike)).statusCode, lookalike).toBe(403);
  });

  it('leaves the same-origin web app exactly as it was', async () => {
    const web = new Device(app, { origin: 'http://localhost:80', 'sec-fetch-site': 'same-origin' });
    const { snapshotId } = await web.importRepo('acme/notes-api');
    const tree = await web.get(`/api/v1/snapshots/${snapshotId}/tree`);
    expect(tree.statusCode).toBe(200);
    expect(tree.headers['access-control-allow-origin']).toBeUndefined();
    expect(web.jar.has('kyc_owner')).toBe(true); // anonymous cookie identity still works
  });

  it('is closed by default: with no allowlist, a desktop origin is just a foreign origin', async () => {
    await h.close();
    await h.reset({ llm: new FakeLlm() });
    expect((await preflight(DESKTOP)).statusCode).toBe(403);
  });
});

describe('CORS_ALLOWED_ORIGINS validation', () => {
  const load = (v: string) =>
    loadConfig({ DATABASE_URL: 'postgres://x/y', CORS_ALLOWED_ORIGINS: v } as NodeJS.ProcessEnv);

  it('accepts exact origins, normalises case and drops duplicates', () => {
    expect(
      load(' tauri://localhost ,HTTP://Tauri.Localhost, tauri://localhost').CORS_ALLOWED_ORIGINS,
    ).toEqual(['tauri://localhost', 'http://tauri.localhost']);
    expect(load('').CORS_ALLOWED_ORIGINS).toEqual([]);
  });

  it.each([
    ['*', /wildcards are not allowed/],
    ['https://*.example.com', /wildcards are not allowed/],
    ['null', /"null" is not an origin/],
    ['https://app.example.com/', /not an origin/],
    ['https://app.example.com/path', /not an origin/],
    ['app.example.com', /not an origin/],
    ['https://user:pw@app.example.com', /not an origin/],
  ])('rejects %s with an understandable message', (value, message) => {
    expect(() => load(value)).toThrow(ConfigError);
    expect(() => load(value)).toThrow(message);
  });
});
