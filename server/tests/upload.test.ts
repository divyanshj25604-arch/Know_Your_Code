import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uploadDisplayName } from '../src/http/uploadRoutes';
import { loadFixture } from './fixture-loader';
import { Harness } from './harness';
import { buildZip, zipFiles } from './zip-helper';

const h = new Harness();
const DESKTOP = 'tauri://localhost';

function fixtureZip(name: string, root = 'notes-api-main'): Buffer {
  return zipFiles(Object.fromEntries(loadFixture(name).map((f) => [f.path, f.content])), root);
}

async function upload(body: Buffer, name = 'notes-api-main.zip', headers: Record<string, string> = {}) {
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/uploads?name=${encodeURIComponent(name)}`,
    payload: body,
    headers: h.headers({ 'content-type': 'application/zip', ...headers }),
  });
  const sc = res.headers['set-cookie'];
  if (sc && !h.cookie) h.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  return res;
}

async function uploadAndWait(body: Buffer, name?: string) {
  const res = await upload(body, name);
  expect(res.statusCode, res.body).toBe(202);
  const { snapshotId, repositoryId } = res.json();
  await h.app.services.runner.idle();
  const snap = (await h.get(`/api/v1/snapshots/${snapshotId}`)).json();
  return { snapshotId: snapshotId as string, repositoryId: repositoryId as string, snap };
}

const pendingUploads = async () =>
  (await h.db.query<{ n: number }>('SELECT count(*)::int AS n FROM snapshot_uploads')).rows[0]!.n;

beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    env: { MAX_TARBALL_BYTES: String(256 * 1024) },
    repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
  }),
);
afterEach(() => h.close());

describe('POST /api/v1/uploads', () => {
  it('imports a zipped project through the same job: ready with files and symbols, source "upload"', async () => {
    const { snapshotId, repositoryId, snap } = await uploadAndWait(fixtureZip('express-cjs'));
    expect(snap.status).toBe('ready');
    expect(snap.repository).toEqual({ owner: '', name: 'notes-api-main', source: 'upload' });
    expect(snap.commitSha).toBeNull();
    expect(snap.stages.map((s: { name: string; state: string }) => [s.name, s.state]).slice(0, 3)).toEqual([
      ['fetching', 'done'],
      ['filtering', 'done'],
      ['analysing', 'done'],
    ]);
    expect(snap.repositoryId).toBe(repositoryId);

    const tree = (await h.get(`/api/v1/snapshots/${snapshotId}/tree`)).json();
    const names = JSON.stringify(tree);
    expect(names).toContain('package.json');
    expect(names).not.toContain('notes-api-main');
    const counts = await h.db.query<{ files: number; symbols: number }>(
      `SELECT (SELECT count(*)::int FROM files WHERE snapshot_id=$1) AS files,
              (SELECT count(*)::int FROM symbols WHERE snapshot_id=$1) AS symbols`,
      [snapshotId],
    );
    expect(counts.rows[0]!.files).toBeGreaterThan(0);
    expect(counts.rows[0]!.symbols).toBeGreaterThan(0);
    const hash = await h.db.query('SELECT content_hash FROM snapshots WHERE id=$1', [snapshotId]);
    expect(hash.rows[0].content_hash).toMatch(/^[0-9a-f]{40}$/);

    // The archive is released once the snapshot is terminal.
    expect(await pendingUploads()).toBe(0);

    const mine = (await h.get('/api/v1/my/snapshots')).json();
    expect(mine.snapshots[0]).toMatchObject({
      snapshotId,
      repository: { owner: '', name: 'notes-api-main', source: 'upload' },
    });
  });

  it('never calls GitHub for an upload', async () => {
    const before = h.gh.requests.length;
    const { snap } = await uploadAndWait(fixtureZip('express-cjs'));
    expect(snap.status).toBe('ready');
    expect(h.gh.requests.length).toBe(before);
  });

  it('uses paths as-is when there is no common root folder', async () => {
    const { snapshotId, snap } = await uploadAndWait(
      zipFiles({
        'index.js': 'function main() { return 1; }\nmain();\n',
        'lib/util.js': 'module.exports = 1;\n',
      }),
      'My Project (1).zip',
    );
    expect(snap.status).toBe('ready');
    expect(snap.repository.name).toBe('My-Project-1');
    const f = await h.get(`/api/v1/snapshots/${snapshotId}/file?path=index.js`);
    expect(f.statusCode).toBe(200);
  });

  it('skips unsafe paths and symlinks in the job', async () => {
    const { snapshotId, snap } = await uploadAndWait(
      buildZip([
        { name: 'p/src/a.js', content: 'function a() {}\nmodule.exports = { a };\n' },
        { name: '../evil.js', content: 'x' },
        { name: 'p/link.js', content: '/etc/passwd', symlink: true },
      ]),
    );
    expect(snap.status).toBe('ready');
    const r = await h.db.query<{ skipped: { path: string; reason: string }[] }>(
      'SELECT skipped FROM snapshots WHERE id=$1',
      [snapshotId],
    );
    expect(r.rows[0]!.skipped).toEqual(
      expect.arrayContaining([
        { path: '../evil.js', reason: 'unsafe_path' },
        { path: 'p/link.js', reason: 'symlink' },
      ]),
    );
    const paths = await h.db.query('SELECT path FROM files WHERE snapshot_id=$1 ORDER BY path', [snapshotId]);
    expect(paths.rows.map((x) => x.path)).toEqual(['src/a.js']); // one common root ("p/") is stripped
  });

  it('marks a project without JavaScript/TypeScript UNSUPPORTED_LANGUAGE and releases the archive', async () => {
    const { snap } = await uploadAndWait(zipFiles({ 'main.py': 'print(1)\n', 'README.md': '# x\n' }, 'py'));
    expect(snap.status).toBe('failed');
    expect(snap.error.code).toBe('UNSUPPORTED_LANGUAGE');
    expect(await pendingUploads()).toBe(0);
  });

  it('rejects data that is not a ZIP with INVALID_ARCHIVE 400', async () => {
    const res = await upload(Buffer.from('this is not a zip file'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ARCHIVE');
    expect(res.json().error.message).toBe("We couldn't read this ZIP file.");
    const truncated = fixtureZip('express-cjs').subarray(0, 200);
    const t = await upload(truncated);
    expect(t.statusCode).toBe(400);
    expect(t.json().error.code).toBe('INVALID_ARCHIVE');
    expect((await h.db.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(0);
  });

  it('rejects an empty body and an empty archive', async () => {
    const empty = await upload(Buffer.alloc(0));
    expect(empty.statusCode).toBe(400);
    const eocdOnly = await upload(buildZip([]));
    expect(eocdOnly.statusCode).toBe(400);
    expect(eocdOnly.json().error.code).toBe('INVALID_ARCHIVE');
  });

  it('rejects encrypted entries before queueing', async () => {
    const res = await upload(buildZip([{ name: 'a.js', content: 'x', encrypted: true }]));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ARCHIVE');
    expect(res.json().error.message).toMatch(/password/);
  });

  it('rejects a decompression bomb (huge declared size) with REPO_TOO_LARGE before queueing', async () => {
    const res = await upload(buildZip([{ name: 'a.js', content: 'x', declaredSize: 0x7fffffff }]));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('REPO_TOO_LARGE');
  });

  it('fails the job when content inflates past its declared size', async () => {
    const bomb = Buffer.alloc(200 * 1024, 0x61);
    const { snap } = await uploadAndWait(buildZip([{ name: 'p/a.js', content: bomb, declaredSize: 10 }]));
    expect(snap.status).toBe('failed');
    expect(snap.error.code).toBe('INVALID_ARCHIVE');
    expect(await pendingUploads()).toBe(0);
  });

  it('rejects an upload over the size limit with 413', async () => {
    const big = buildZip([{ name: 'a.bin', content: Buffer.alloc(300 * 1024, 1), method: 'stored' }]);
    const res = await upload(big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('REPO_TOO_LARGE');
  });

  it('accepts the other ZIP content types and refuses JSON', async () => {
    const z = zipFiles({ 'a.js': 'a();\n' });
    for (const type of ['application/x-zip-compressed', 'application/octet-stream'])
      expect((await upload(z, 'a.zip', { 'content-type': type })).statusCode).toBe(202);
    const json = await upload(z, 'a.zip', { 'content-type': 'application/json' });
    expect(json.statusCode).toBe(400);
  });

  it('requires identity: an allow-listed cross-origin caller without a bearer token gets 401', async () => {
    await h.close();
    await h.reset({ env: { CORS_ALLOWED_ORIGINS: DESKTOP } });
    const res = await upload(zipFiles({ 'a.js': 'a();\n' }), 'a.zip', { origin: DESKTOP });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('refuses a foreign origin', async () => {
    const res = await upload(zipFiles({ 'a.js': 'a();\n' }), 'a.zip', { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
  });

  it('keeps the archive while queued and finds it again after a crash recovery', async () => {
    h.app.services.runner.pause();
    const res = await upload(fixtureZip('express-cjs'));
    expect(res.statusCode).toBe(202);
    const { snapshotId } = res.json();
    expect(await pendingUploads()).toBe(1);
    // Simulate a crash mid-run: the job is left "running"; recovery re-queues it and the archive is still there.
    await h.db.query(`UPDATE jobs SET state='running' WHERE snapshot_id=$1`, [snapshotId]);
    await h.db.query(`UPDATE snapshots SET status='analysing' WHERE id=$1`, [snapshotId]);
    await h.app.services.runner.recover();
    h.app.services.runner.resume();
    await h.app.services.runner.idle();
    const snap = (await h.get(`/api/v1/snapshots/${snapshotId}`)).json();
    expect(snap.status).toBe('ready');
    expect(await pendingUploads()).toBe(0);
  });

  it('fails clearly when the archive is gone', async () => {
    h.app.services.runner.pause();
    const res = await upload(fixtureZip('express-cjs'));
    const { snapshotId } = res.json();
    await h.db.query('DELETE FROM snapshot_uploads WHERE snapshot_id=$1', [snapshotId]);
    h.app.services.runner.resume();
    await h.app.services.runner.idle();
    const snap = (await h.get(`/api/v1/snapshots/${snapshotId}`)).json();
    expect(snap.status).toBe('failed');
    expect(snap.error).toEqual({
      code: 'INDEX_FAILED',
      message: 'The uploaded archive is no longer available. Upload it again.',
    });
  });

  it('shares the import rate limit with GitHub imports', async () => {
    await h.close();
    await h.reset({
      env: { RATE_LIMIT_DISABLED: 'false', RATE_IMPORTS_PER_HOUR: '2' },
      repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
    });
    expect(
      (await h.post('/api/v1/repositories', { url: 'https://github.com/acme/notes-api' })).statusCode,
    ).toBe(202);
    expect((await upload(zipFiles({ 'a.js': 'a();\n' }))).statusCode).toBe(202);
    const third = await upload(zipFiles({ 'a.js': 'a();\n' }));
    expect(third.statusCode).toBe(429);
    await h.app.services.runner.idle();
  });

  it('GitHub imports are unchanged and report source "github"', async () => {
    const { snap } = await h.importRepo('https://github.com/acme/notes-api');
    expect(snap.status).toBe('ready');
    expect(snap.repository).toEqual({ owner: 'acme', name: 'notes-api', source: 'github' });
  });
});

describe('uploadDisplayName', () => {
  it.each([
    [undefined, 'project'],
    ['', 'project'],
    ['notes-api-main.zip', 'notes-api-main'],
    ['C:\\Users\\me\\Desktop\\shop.ZIP', 'shop'],
    ['/tmp/../../etc/passwd', 'passwd'],
    ['..zip', 'project'],
    ['...', 'project'],
    ['My Project (1).zip', 'My-Project-1'],
    ['ünïcode.zip', 'n-code'],
    ['a'.repeat(300) + '.zip', 'a'.repeat(100)],
  ])('%s -> %s', (raw, expected) => expect(uploadDisplayName(raw)).toBe(expected));
});
