import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { ShareTokens } from '../src/auth/shareTokens';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
const FILE = 'src/controllers/authController.js';
const SEL = { path: FILE, startLine: 3, startCol: 15, endLine: 3, endCol: 20 };

beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: { 'acme/notes-api': { fixture: 'express-cjs' }, 'acme/shop': { fixture: 'react-ts' } },
  }),
);
afterEach(() => h.close());

async function ownerWithSnapshot() {
  const owner = new Device(app);
  const { snapshotId, repositoryId } = await owner.importRepo('acme/notes-api');
  const resolved = (await owner.post(`/api/v1/snapshots/${snapshotId}/resolve`, { selection: SEL })).json();
  return { owner, snapshotId, repositoryId, symbolId: resolved.symbol.id as string };
}

/** Every read path that exposes stored code or analysis, direct and indirect. */
function reads(snapshotId: string, symbolId: string) {
  return [
    ['status', (d: Device, x?: Record<string, string>) => d.get(`/api/v1/snapshots/${snapshotId}`, x)],
    [
      'overview',
      (d: Device, x?: Record<string, string>) => d.get(`/api/v1/snapshots/${snapshotId}/overview`, x),
    ],
    ['tree', (d: Device, x?: Record<string, string>) => d.get(`/api/v1/snapshots/${snapshotId}/tree`, x)],
    [
      'file',
      (d: Device, x?: Record<string, string>) =>
        d.get(`/api/v1/snapshots/${snapshotId}/file?path=${encodeURIComponent(FILE)}`, x),
    ],
    [
      'resolve',
      (d: Device, x?: Record<string, string>) =>
        d.post(`/api/v1/snapshots/${snapshotId}/resolve`, { selection: SEL }, x),
    ],
    [
      'relations',
      (d: Device, x?: Record<string, string>) => d.get(`/api/v1/symbols/${symbolId}/relations`, x),
    ],
  ] as const;
}

const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: "We couldn't find that.", retryable: false } };

describe('snapshot read authorisation (acceptance: P1.5)', () => {
  it('the owner reads everything', async () => {
    const t = await ownerWithSnapshot();
    for (const [name, call] of reads(t.snapshotId, t.symbolId))
      expect((await call(t.owner)).statusCode, name).toBe(200);
  });

  it("another user's snapshot id is 404 on every read path, for anonymous, signed-in and bearer callers", async () => {
    const t = await ownerWithSnapshot();
    const anon = new Device(app);
    await anon.get('/api/v1/my/snapshots'); // has an identity of its own
    const signedIn = new Device(app);
    await signedIn.register('bob@example.com');
    const bearer = Device.bearer(app);
    await bearer.login('bob@example.com', undefined, 'bearer');
    for (const stranger of [anon, signedIn, bearer]) {
      for (const [name, call] of reads(t.snapshotId, t.symbolId)) {
        const res = await call(stranger);
        expect(res.statusCode, name).toBe(404);
        expect(res.json(), name).toEqual(NOT_FOUND_BODY);
        expect(res.body, name).not.toContain('authController');
      }
    }
  });

  it('gives a stranger no oracle: unknown, expired, failed and in-progress snapshots all look the same', async () => {
    const t = await ownerWithSnapshot();
    const stranger = new Device(app);
    const unknown = await stranger.get(`/api/v1/snapshots/${randomUUID()}/tree`);
    for (const status of ['ready', 'failed', 'analysing'] as const) {
      await h.db.query('UPDATE snapshots SET status=$1 WHERE id=$2', [status, t.snapshotId]);
      const res = await stranger.get(`/api/v1/snapshots/${t.snapshotId}/tree`);
      expect({ code: res.statusCode, body: res.json() }).toEqual({
        code: unknown.statusCode,
        body: unknown.json(),
      });
    }
    await h.db.query(
      `UPDATE snapshots SET status='ready', expires_at = now() - interval '1 minute' WHERE id=$1`,
      [t.snapshotId],
    );
    expect((await stranger.get(`/api/v1/snapshots/${t.snapshotId}/tree`)).statusCode).toBe(404);
    expect((await t.owner.get(`/api/v1/snapshots/${t.snapshotId}/tree`)).statusCode).toBe(410); // the owner is told
  });

  it('does not mint an identity for callers who present none', async () => {
    const t = await ownerWithSnapshot();
    const users = async () => (await h.db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const before = await users();
    const res = await h.app.inject({ url: `/api/v1/snapshots/${t.snapshotId}/tree` });
    expect(res.statusCode).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await users()).toBe(before);
  });

  it("keeps the established 403 for explanation requests on someone else's snapshot, whatever its state", async () => {
    const t = await ownerWithSnapshot();
    const stranger = new Device(app);
    const sel = { path: FILE, startLine: 4, startCol: 15, endLine: 4, endCol: 52 };
    expect(
      (await stranger.post('/api/v1/explanations', { snapshotId: t.snapshotId, selection: sel })).statusCode,
    ).toBe(403);
    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    expect(
      (await stranger.post('/api/v1/explanations', { snapshotId: t.snapshotId, selection: sel })).statusCode,
    ).toBe(403);
    expect(
      (await stranger.post('/api/v1/explanations', { snapshotId: randomUUID(), selection: sel })).statusCode,
    ).toBe(404);
  });
});

describe('signed share tokens', () => {
  async function shared() {
    const t = await ownerWithSnapshot();
    const res = await t.owner.post(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, { ttlHours: 24 });
    expect(res.statusCode).toBe(201);
    const { token, expiresAt } = res.json() as { token: string; expiresAt: string };
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    return { ...t, token };
  }

  it('grant read access by header or ?share= link, on every read path', async () => {
    const t = await shared();
    const viewer = new Device(app);
    for (const [name, call] of reads(t.snapshotId, t.symbolId))
      expect((await call(viewer, { 'x-kyc-share': t.token })).statusCode, name).toBe(200);
    const link = await viewer.get(
      `/api/v1/snapshots/${t.snapshotId}/tree?share=${encodeURIComponent(t.token)}`,
    );
    expect(link.statusCode).toBe(200);
  });

  it('are read-only: no explanations, deletion, re-sharing or listing', async () => {
    const t = await shared();
    const viewer = new Device(app);
    const x = { 'x-kyc-share': t.token };
    const sel = { path: FILE, startLine: 4, startCol: 15, endLine: 4, endCol: 52 };
    expect(
      (await viewer.post('/api/v1/explanations', { snapshotId: t.snapshotId, selection: sel }, x)).statusCode,
    ).toBe(403);
    expect((await viewer.delete(`/api/v1/repositories/${t.repositoryId}`, x)).statusCode).toBe(403);
    expect((await viewer.post(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, {}, x)).statusCode).toBe(404);
    expect((await viewer.delete(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, x)).statusCode).toBe(404);
    expect(await viewer.mySnapshots()).toEqual([]);
  });

  it('are bound to one snapshot', async () => {
    const t = await shared();
    const other = await t.owner.importRepo('acme/shop');
    const viewer = new Device(app);
    expect(
      (await viewer.get(`/api/v1/snapshots/${other.snapshotId}/tree`, { 'x-kyc-share': t.token })).statusCode,
    ).toBe(404);
  });

  it('reject tampered, foreign-key and expired tokens', async () => {
    const t = await shared();
    const viewer = new Device(app);
    const read = (token: string) =>
      viewer.get(`/api/v1/snapshots/${t.snapshotId}/tree`, { 'x-kyc-share': token });
    const [p, exp, iat, sig] = t.token.split('.') as [string, string, string, string];
    const longer = (parseInt(exp, 36) + 3600_000 * 24 * 30).toString(36);
    expect((await read(`${p}.${longer}.${iat}.${sig}`)).statusCode).toBe(404); // extended expiry, old signature
    expect(
      (await read(`${p}.${exp}.${iat}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`)).statusCode,
    ).toBe(404);
    expect((await read('kss1.x.y.z')).statusCode).toBe(404);
    const foreign = new ShareTokens('another-secret-entirely-0123456789').issue(t.snapshotId, 24).token;
    expect((await read(foreign)).statusCode).toBe(404);
    const stale = h.app.services.shares.issue(t.snapshotId, 1, Date.now() - 2 * 3600_000).token;
    expect((await read(stale)).statusCode).toBe(404);
  });

  it('are revoked all at once by the owner; new tokens work again', async () => {
    const t = await shared();
    const viewer = new Device(app);
    const read = (token: string) =>
      viewer.get(`/api/v1/snapshots/${t.snapshotId}/tree`, { 'x-kyc-share': token });
    expect((await read(t.token)).statusCode).toBe(200);
    expect((await t.owner.delete(`/api/v1/snapshots/${t.snapshotId}/share-tokens`)).statusCode).toBe(204);
    expect((await read(t.token)).statusCode).toBe(404);
    const fresh = (await t.owner.post(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, {})).json()
      .token as string;
    expect((await read(fresh)).statusCode).toBe(200);
  });

  it('can only be minted or revoked by the owner, and only for usable snapshots', async () => {
    const t = await ownerWithSnapshot();
    const stranger = new Device(app);
    expect((await stranger.post(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, {})).statusCode).toBe(404);
    expect((await stranger.delete(`/api/v1/snapshots/${t.snapshotId}/share-tokens`)).statusCode).toBe(404);
    expect(
      (await t.owner.post(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, { ttlHours: 1000 })).statusCode,
    ).toBe(400);
    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    expect((await t.owner.post(`/api/v1/snapshots/${t.snapshotId}/share-tokens`, {})).statusCode).toBe(410);
  });
});

describe('ShareTokens (unit)', () => {
  const tokens = new ShareTokens('unit-test-secret-0123456789abcdef');
  const id = randomUUID();
  it('verifies its own tokens and caps the lifetime at 7 days', () => {
    const now = Date.now();
    const { token, expiresAt } = tokens.issue(id, 10_000, now);
    expect(expiresAt.getTime()).toBe(now + 7 * 24 * 3600_000);
    expect(tokens.verify(token, id, null, now)).toBe(true);
    expect(tokens.verify(token, randomUUID(), null, now)).toBe(false);
    expect(tokens.verify(token, id, null, expiresAt.getTime())).toBe(false);
    expect(tokens.verify(token, id, new Date(now), now)).toBe(false); // revoked at issue time
    expect(tokens.verify(token, id, new Date(now - 1), now)).toBe(true); // revoked before issue
  });
});
