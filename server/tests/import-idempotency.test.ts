import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { runImport } from '../src/jobs/importJob';
import { fixtureTarball } from './fake-github';
import { Harness } from './harness';
import { buildTarGz } from './tar-helper';

const h = new Harness();
const SHA = 'c0ffee'.padEnd(40, '0');

beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const n = async (sql: string, params: unknown[] = []) =>
  (await h.db.query<{ n: number }>(sql, params)).rows[0]!.n;
const contentCounts = async (id: string) => ({
  files: await n('SELECT count(*)::int AS n FROM files WHERE snapshot_id=$1', [id]),
  symbols: await n('SELECT count(*)::int AS n FROM symbols WHERE snapshot_id=$1', [id]),
  edges: await n('SELECT count(*)::int AS n FROM edges WHERE snapshot_id=$1', [id]),
});
const snapRow = async (id: string) =>
  (
    await h.db.query<{ status: string; error_code: string | null; expires_at: Date }>(
      'SELECT status, error_code, expires_at FROM snapshots WHERE id=$1',
      [id],
    )
  ).rows[0]!;
const jobRow = async (id: string) =>
  (
    await h.db.query<{ state: string; attempts: number; last_error: string | null }>(
      'SELECT state, attempts, last_error FROM jobs WHERE snapshot_id=$1',
      [id],
    )
  ).rows[0]!;

async function importAt(name: string, ref = SHA) {
  const res = await h.post('/api/v1/repositories', { url: `https://github.com/acme/${name}`, ref });
  expect(res.statusCode, res.body).toBe(202);
  await h.app.services.runner.idle();
  return res.json() as { snapshotId: string; reused: boolean; status: string };
}

describe('transactional, idempotent imports (P0.4)', () => {
  it('a killed import re-runs cleanly over rows left by the interrupted attempt', async () => {
    const clean = await importAt('notes-api');
    const expected = await contentCounts(clean.snapshotId);
    // Simulate a process that died mid-run: job still "running", snapshot mid-stage, a stray partial file row.
    await h.db.query(`UPDATE jobs SET state='running' WHERE snapshot_id=$1`, [clean.snapshotId]);
    await h.db.query(`UPDATE snapshots SET status='analysing' WHERE id=$1`, [clean.snapshotId]);
    await h.db.query(
      `INSERT INTO files (snapshot_id, path, analysable, size_bytes, line_count, content)
       VALUES ($1, 'zz-partial.js', true, 1, 1, 'x') ON CONFLICT DO NOTHING`,
      [clean.snapshotId],
    );

    expect(await h.app.services.runner.recover()).toBe(1);
    await h.app.services.runner.idle();

    expect((await snapRow(clean.snapshotId)).status).toBe('ready');
    expect(await contentCounts(clean.snapshotId)).toEqual(expected); // no leftovers, no duplicates
    expect(await jobRow(clean.snapshotId)).toMatchObject({ state: 'done', last_error: null });
  });

  it('a failed SHA re-import succeeds on the same snapshot, with the error cleared and expiry refreshed', async () => {
    h.gh.add('acme', 'flip', await buildTarGz([{ name: 'main.py', content: 'print(1)' }]));
    const first = await importAt('flip');
    expect(await snapRow(first.snapshotId)).toMatchObject({
      status: 'failed',
      error_code: 'UNSUPPORTED_LANGUAGE',
    });
    expect(await jobRow(first.snapshotId)).toMatchObject({ state: 'failed' });
    expect((await jobRow(first.snapshotId)).last_error).toMatch(/^UNSUPPORTED_LANGUAGE: /);
    await h.db.query(`UPDATE snapshots SET expires_at = now() + interval '1 hour' WHERE id=$1`, [
      first.snapshotId,
    ]);

    // The repository is fixed at the same commit; importing it again must work.
    h.gh.add('acme', 'flip', await fixtureTarball('express-cjs'));
    const second = await importAt('flip');
    expect(second).toMatchObject({ snapshotId: first.snapshotId, reused: false, status: 'queued' });
    const row = await snapRow(first.snapshotId);
    expect(row).toMatchObject({ status: 'ready', error_code: null });
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    expect(await jobRow(first.snapshotId)).toMatchObject({ state: 'done', attempts: 0, last_error: null });
    expect((await contentCounts(first.snapshotId)).symbols).toBeGreaterThan(0);
  });

  it('an expired snapshot of the same commit is refreshed in place instead of failing on duplicate rows', async () => {
    const first = await importAt('notes-api');
    const before = await contentCounts(first.snapshotId);
    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute' WHERE id=$1`, [
      first.snapshotId,
    ]);
    const again = await importAt('notes-api');
    expect(again.snapshotId).toBe(first.snapshotId);
    expect((await snapRow(first.snapshotId)).status).toBe('ready');
    expect((await snapRow(first.snapshotId)).expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(await contentCounts(first.snapshotId)).toEqual(before);
  });

  it('a live snapshot of the same commit is reused and never re-run', async () => {
    const first = await importAt('notes-api');
    const downloads = h.gh.requests.length;
    const again = await importAt('notes-api');
    expect(again).toMatchObject({ snapshotId: first.snapshotId, reused: true });
    // probe() opens the archive once; the pipeline must not download it again.
    expect(h.gh.requests.length).toBe(downloads + 1);
  });

  it('writes are all-or-nothing: a failure mid-persistence leaves no files, symbols or edges', async () => {
    await h.db.query(`
      CREATE OR REPLACE FUNCTION kyc_test_fail_edges() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated write failure'; END $$;
      CREATE TRIGGER kyc_test_fail_edges BEFORE INSERT ON edges FOR EACH STATEMENT
        EXECUTE FUNCTION kyc_test_fail_edges();`);
    try {
      const r = await importAt('notes-api');
      expect(await snapRow(r.snapshotId)).toMatchObject({ status: 'failed', error_code: 'INDEX_FAILED' });
      expect(await contentCounts(r.snapshotId)).toEqual({ files: 0, symbols: 0, edges: 0 });
      expect((await jobRow(r.snapshotId)).last_error).toMatch(/simulated write failure/);
    } finally {
      await h.db.query('DROP TRIGGER IF EXISTS kyc_test_fail_edges ON edges');
      await h.db.query('DROP FUNCTION IF EXISTS kyc_test_fail_edges()');
    }
    // Once the fault is gone, importing the same commit again succeeds.
    const ok = await importAt('notes-api');
    expect((await snapRow(ok.snapshotId)).status).toBe('ready');
  });

  it('running the pipeline twice on one snapshot replaces its content instead of duplicating it', async () => {
    const first = await importAt('notes-api');
    const before = await contentCounts(first.snapshotId);
    const deps = { config: h.app.services.config, db: h.db, github: h.app.services.github, log: h.app.log };
    await runImport(deps, first.snapshotId);
    expect((await snapRow(first.snapshotId)).status).toBe('ready');
    expect(await contentCounts(first.snapshotId)).toEqual(before);
    expect(await n('SELECT count(*)::int AS n FROM jobs WHERE snapshot_id=$1', [first.snapshotId])).toBe(1);
  });
});
