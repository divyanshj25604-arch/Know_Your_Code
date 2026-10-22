import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Db } from '../src/db/pool';
import { fixtureTarball, startFakeGitHub, type FakeGitHub } from './fake-github';
import { testConfig, testDb } from './helpers';
import { buildTarGz } from './tar-helper';

let gh: FakeGitHub;
let db: Db;
let app: FastifyInstance;
let cookie = '';

const hdr = () => (cookie ? { cookie } : {});

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: payload as object, headers: hdr() });
  const sc = res.headers['set-cookie'];
  if (sc) cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  return res;
}
const get = (url: string) => app.inject({ url, headers: hdr() });

async function importAndWait(url: string) {
  const res = await post('/api/v1/repositories', { url });
  expect(res.statusCode, res.body).toBe(202);
  const { snapshotId, repositoryId } = res.json();
  await app.services.runner.idle();
  const snap = (await get(`/api/v1/snapshots/${snapshotId}`)).json();
  return { snapshotId, repositoryId, snap };
}

beforeAll(async () => {
  gh = await startFakeGitHub();
  db = testDb();
});
afterAll(async () => {
  await gh.close();
  await db.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE owners, deletion_log, events, llm_calls CASCADE');
  cookie = '';
  gh.add(
    'acme',
    'notes-api',
    await fixtureTarball('express-cjs', [
      { name: '.env', content: 'MONGO_URL=mongodb://admin:hunter2hunter2@db.example.com/notes' },
      // Test helpers must not crowd out real starting points, however often they are called.
      {
        name: 'test/helper.js',
        content:
          'function help() {}\nfunction a() { help(); help(); help(); help(); }\nmodule.exports = { help, a };\n',
      },
      {
        name: 'src/util.spec.js',
        content:
          'function spec() {}\nfunction b() { spec(); spec(); spec(); spec(); }\nmodule.exports = { spec, b };\n',
      },
      { name: 'src/config.js', content: "module.exports = { token: 'ghp_" + 'a'.repeat(36) + "' };\n" },
    ]),
  );
  gh.add('acme', 'shop', await fixtureTarball('react-ts'));
  gh.add('acme', 'partial', await fixtureTarball('broken'));
  gh.add(
    'acme',
    'python-only',
    await buildTarGz([
      { name: 'main.py', content: 'print(1)' },
      { name: 'README.md', content: '# x' },
    ]),
  );
  gh.add(
    'acme',
    'huge',
    await buildTarGz(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.js`, content: 'x' }))),
  );
  app = await buildApp({
    config: testConfig({ GITHUB_CODELOAD_BASE: gh.base, MAX_ANALYSABLE_FILES: '10' }),
    db,
  });
});
afterEach(async () => {
  await app.close();
});

describe('import pipeline over real HTTP + extraction + analysis', () => {
  it('imports a repo end to end and exposes tree, file, overview, resolve and relations', async () => {
    const { snapshotId, snap } = await importAndWait('https://github.com/acme/notes-api');
    expect(snap).toMatchObject({ status: 'ready', repository: { owner: 'acme', name: 'notes-api' } });
    expect(snap.stages.map((s: { state: string }) => s.state)).toEqual(['done', 'done', 'done', 'done']);

    const tree = (await get(`/api/v1/snapshots/${snapshotId}/tree`)).json().root;
    const names = JSON.stringify(tree);
    expect(names).toContain('authController.js');
    expect(names).not.toContain('.env"'); // secret file never stored

    const file = (
      await get(`/api/v1/snapshots/${snapshotId}/file?path=src/controllers/authController.js`)
    ).json();
    expect(file).toMatchObject({ language: 'js', analysable: true });
    expect(file.content).toContain('async function login');

    const cfg = (await get(`/api/v1/snapshots/${snapshotId}/file?path=src/config.js`)).json();
    expect(cfg.content).not.toContain('ghp_');
    expect(cfg.content).toContain('[REDACTED]');

    const overview = (await get(`/api/v1/snapshots/${snapshotId}/overview`)).json();
    expect(overview.facts).toMatchObject({ languages: { js: 8 }, frameworks: ['express', 'mongoose'] });
    expect(overview.summary).toMatchObject({ status: 'ready', provenance: 'explained' });
    expect(overview.skipped).toContainEqual({ path: '.env', reason: 'secret_file' });
    expect(overview.startingPoints.length).toBeGreaterThan(0);
    expect(JSON.stringify(overview.startingPoints)).not.toMatch(/help|spec/);
    // External-package calls are a known boundary, not a failure to analyse.
    expect(overview.facts.unresolvedCount).toBeLessThan(overview.facts.edgeCount);

    // Select the `login` function name -> resolves to the function with relations.
    const resolved = (
      await post(`/api/v1/snapshots/${snapshotId}/resolve`, {
        selection: {
          path: 'src/controllers/authController.js',
          startLine: 3,
          startCol: 15,
          endLine: 3,
          endCol: 20,
        },
      })
    ).json();
    expect(resolved).toMatchObject({ kind: 'function', symbol: { name: 'login', startLine: 3, endLine: 7 } });

    const rel = (await get(`/api/v1/symbols/${resolved.symbol.id}/relations`)).json();
    expect(rel.calls.map((c: { label: string }) => c.label)).toContain('findUserByEmail');
    // A call links to the callee's definition (userService.js:7), not to the call site (authController.js:4).
    expect(rel.calls.find((c: { label: string }) => c.label === 'findUserByEmail')).toMatchObject({
      path: 'src/services/userService.js',
      line: 7,
    });
    expect(
      rel.calledBy.map((c: { label: string; provenance: string }) => `${c.label}|${c.provenance}`),
    ).toContain('POST /login route registration|pattern');
    expect(rel.unresolved.some((u: { reason: string }) => u.reason === 'no_declaration')).toBe(true);
    expect(rel.imports.map((i: { label: string }) => i.label)).toContain('../services/userService');
  });

  it('selects a call and a cross-file import with the right kinds', async () => {
    const { snapshotId } = await importAndWait('https://github.com/acme/notes-api');
    const sel = async (s: object) =>
      (
        await post(`/api/v1/snapshots/${snapshotId}/resolve`, {
          selection: { path: 'src/controllers/authController.js', ...s },
        })
      ).json();
    // `await findUserByEmail(req.body.email)` on line 4
    expect(await sel({ startLine: 4, startCol: 15, endLine: 4, endCol: 52 })).toMatchObject({
      kind: 'call',
      symbol: { name: 'login' },
    });
    // the require line
    expect(await sel({ startLine: 1, startCol: 0, endLine: 1, endCol: 65 })).toMatchObject({
      kind: 'import',
    });
    // identifier `user` inside login
    expect(await sel({ startLine: 5, startCol: 7, endLine: 5, endCol: 11 })).toMatchObject({
      kind: 'identifier',
      symbol: { name: 'login' },
    });
    // two statements -> block
    expect(await sel({ startLine: 4, startCol: 2, endLine: 5, endCol: 56 })).toMatchObject({ kind: 'block' });
  });

  it('rejects bad selections with INVALID_SELECTION', async () => {
    const { snapshotId } = await importAndWait('https://github.com/acme/notes-api');
    const bad = async (s: object) =>
      post(`/api/v1/snapshots/${snapshotId}/resolve`, {
        selection: { path: 'src/controllers/authController.js', ...s },
      });
    expect((await bad({ startLine: 2, startCol: 0, endLine: 2, endCol: 0 })).json().error.code).toBe(
      'INVALID_SELECTION',
    ); // blank line
    expect((await bad({ startLine: 999, startCol: 0, endLine: 999, endCol: 3 })).json().error.code).toBe(
      'INVALID_SELECTION',
    );
    expect((await bad({ startLine: 5, startCol: 5, endLine: 4, endCol: 0 })).statusCode).toBe(400);
  });

  it('opens a partially-parseable repo as ready_partial and lists the skipped file', async () => {
    const { snapshotId, snap } = await importAndWait('https://github.com/acme/partial');
    expect(snap.status).toBe('ready_partial');
    const ov = (await get(`/api/v1/snapshots/${snapshotId}/overview`)).json();
    expect(ov.skipped).toContainEqual({ path: 'bad.js', reason: 'parse_error' });
    // the broken file is still viewable
    expect((await get(`/api/v1/snapshots/${snapshotId}/file?path=bad.js`)).statusCode).toBe(200);
  });

  it('handles React/TS with aliases', async () => {
    const { snapshotId, snap } = await importAndWait('https://github.com/acme/shop');
    expect(snap.status).toBe('ready');
    const ov = (await get(`/api/v1/snapshots/${snapshotId}/overview`)).json();
    expect(ov.facts.languages).toMatchObject({ ts: 1, tsx: 3 });
  });

  it('fails clearly: no JS/TS, too many files, missing repo, invalid URL', async () => {
    const py = await importAndWait('https://github.com/acme/python-only');
    expect(py.snap).toMatchObject({ status: 'failed', error: { code: 'UNSUPPORTED_LANGUAGE' } });
    const count = (
      await db.query('SELECT count(*)::int AS n FROM files WHERE snapshot_id=$1', [py.snapshotId])
    ).rows[0].n;
    expect(count).toBe(0);

    const huge = await importAndWait('https://github.com/acme/huge');
    expect(huge.snap).toMatchObject({ status: 'failed', error: { code: 'REPO_TOO_LARGE' } });

    const missing = await post('/api/v1/repositories', { url: 'https://github.com/acme/ghost' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'REPO_NOT_FOUND_OR_PRIVATE', retryable: false });

    const bad = await post('/api/v1/repositories', { url: 'https://evil.example.com/acme/x' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_URL');
    expect(gh.requests.every((r) => !r.includes('evil'))).toBe(true);
  });

  it('does not serve data until the snapshot is ready', async () => {
    gh.add('acme', 'slow', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return fixtureTarball('express-cjs');
    });
    const res = await post('/api/v1/repositories', { url: 'https://github.com/acme/slow' });
    const { snapshotId } = res.json();
    const early = await get(`/api/v1/snapshots/${snapshotId}/tree`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('SNAPSHOT_NOT_READY');
    await app.services.runner.idle();
    expect((await get(`/api/v1/snapshots/${snapshotId}/tree`)).statusCode).toBe(200);
  });

  it('enforces ownership on delete and removes all derived data', async () => {
    const { repositoryId, snapshotId } = await importAndWait('https://github.com/acme/notes-api');
    const stranger = await app.inject({ method: 'DELETE', url: `/api/v1/repositories/${repositoryId}` });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().error.code).toBe('NOT_OWNER');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/repositories/${repositoryId}`,
      headers: hdr(),
    });
    expect(del.statusCode).toBe(202);
    for (const t of ['snapshots', 'files', 'symbols', 'edges', 'jobs']) {
      const n = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      expect(n, t).toBe(0);
    }
    expect((await get(`/api/v1/snapshots/${snapshotId}`)).statusCode).toBe(404);
    const log = (await db.query('SELECT repository_ref, reason FROM deletion_log')).rows;
    expect(log).toEqual([{ repository_ref: 'acme/notes-api', reason: 'user' }]);
  });

  it("lists only the caller's own snapshots", async () => {
    await importAndWait('https://github.com/acme/notes-api');
    const mine = (await get('/api/v1/my/snapshots')).json();
    expect(mine.snapshots).toHaveLength(1);
    const other = (await app.inject({ url: '/api/v1/my/snapshots' })).json();
    expect(other.snapshots).toHaveLength(0);
  });

  it('reports expired snapshots as 410', async () => {
    const { snapshotId } = await importAndWait('https://github.com/acme/notes-api');
    await db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    const res = await get(`/api/v1/snapshots/${snapshotId}/tree`);
    expect(res.statusCode).toBe(410);
  });

  it('two imports of the same commit racing do not 500: the second reuses the first snapshot', async () => {
    const { createSnapshot, ensureOwner, upsertRepository } = await import('../src/index/snapshots');
    const owner = await ensureOwner(db, null);
    const repo = await upsertRepository(db, owner, 'acme', 'race');
    const sha = 'a'.repeat(40);
    const [a, b] = await Promise.all([
      createSnapshot(db, repo, null, sha, 7),
      createSnapshot(db, repo, null, sha, 7),
    ]);
    expect(a).toBe(b);
    expect((await db.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(1);
    // Different commits are independent.
    expect(await createSnapshot(db, repo, null, 'b'.repeat(40), 7)).not.toBe(a);
  });

  it('validates ids and rejects malformed bodies without leaking internals', async () => {
    expect((await get('/api/v1/snapshots/not-a-uuid')).statusCode).toBe(400);
    const res = await post('/api/v1/repositories', { nope: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/zod|stack|at Object/i);
  });
});
