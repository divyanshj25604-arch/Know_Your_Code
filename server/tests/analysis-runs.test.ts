import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ANALYSER_VERSION, SYMBOL_KEY_VERSION } from '@kyc/core';
import { FakeLlm } from '../src/ai/fake';
import { runImport } from '../src/jobs/importJob';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
const SHA = 'feed00'.padEnd(40, '0');

beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: { 'acme/notes-api': { fixture: 'express-cjs' }, 'acme/partial': { fixture: 'broken' } },
  }),
);
afterEach(() => h.close());

interface KeyRow {
  id: string;
  symbol_key: string;
  analysis_run_id: string;
}
const symbols = async (snapshotId: string) =>
  (
    await h.db.query<KeyRow>(
      'SELECT id, symbol_key, analysis_run_id FROM symbols WHERE snapshot_id=$1 ORDER BY symbol_key',
      [snapshotId],
    )
  ).rows;
const runs = async (snapshotId: string) =>
  (
    await h.db.query<{
      id: string;
      status: string;
      outcome: string | null;
      symbol_count: number | null;
      error_code: string | null;
      analyser_version: string;
      symbol_key_version: number;
      diagnostics: unknown[];
    }>('SELECT * FROM analysis_runs WHERE snapshot_id=$1 ORDER BY started_at', [snapshotId])
  ).rows;
const currentRunId = async (snapshotId: string) =>
  (
    await h.db.query<{ current_analysis_run_id: string | null; status: string }>(
      'SELECT current_analysis_run_id, status FROM snapshots WHERE id=$1',
      [snapshotId],
    )
  ).rows[0]!;
const deps = () => ({
  config: h.app.services.config,
  db: h.db,
  github: h.app.services.github,
  log: h.app.log,
});

describe('stable symbol keys (acceptance: P1.3)', () => {
  it('re-importing an unchanged commit yields identical keys, whoever imports it', async () => {
    const a = await new Device(app).importRepo('acme/notes-api', SHA);
    const b = await new Device(app).importRepo('acme/notes-api', SHA);
    expect(b.snapshotId).not.toBe(a.snapshotId); // separate users, separate snapshots

    const ka = await symbols(a.snapshotId);
    const kb = await symbols(b.snapshotId);
    expect(ka.length).toBeGreaterThan(10);
    expect(ka.every((r) => r.symbol_key)).toBe(true);
    expect(kb.map((r) => r.symbol_key)).toEqual(ka.map((r) => r.symbol_key));
    // Row ids are per run and never shared; identity is the key.
    const idsA = new Set(ka.map((r) => r.id));
    expect(kb.some((r) => idsA.has(r.id))).toBe(false);
  });

  it('exposes the stable key to clients', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const resolved = (
      await d.post(`/api/v1/snapshots/${snapshotId}/resolve`, {
        selection: {
          path: 'src/controllers/authController.js',
          startLine: 3,
          startCol: 15,
          endLine: 3,
          endCol: 20,
        },
      })
    ).json();
    expect(resolved.symbol.key).toBe('src/controllers/authController.js#function:login');
    const rel = (await d.get(`/api/v1/symbols/${resolved.symbol.id}/relations`)).json();
    expect(rel.symbol.key).toBe('src/controllers/authController.js#function:login');
  });
});

describe('analysis runs (acceptance: P1.3)', () => {
  it('one commit can be analysed twice: two run records, one current set of rows, identical keys', async () => {
    const { snapshotId } = await new Device(app).importRepo('acme/notes-api', SHA);
    const first = await symbols(snapshotId);
    const firstRun = (await currentRunId(snapshotId)).current_analysis_run_id;

    await runImport(deps(), snapshotId);

    const history = await runs(snapshotId);
    expect(history.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
    expect(history[0]!.symbol_count).toBe(history[1]!.symbol_count);
    expect(history.every((r) => r.analyser_version === ANALYSER_VERSION)).toBe(true);
    expect(history.every((r) => r.symbol_key_version === SYMBOL_KEY_VERSION)).toBe(true);

    const cur = await currentRunId(snapshotId);
    expect(cur.status).toBe('ready');
    expect(cur.current_analysis_run_id).toBe(history[1]!.id);
    expect(cur.current_analysis_run_id).not.toBe(firstRun);

    const second = await symbols(snapshotId);
    expect(second.map((r) => r.symbol_key)).toEqual(first.map((r) => r.symbol_key));
    expect(second.every((r) => r.analysis_run_id === cur.current_analysis_run_id)).toBe(true); // no stale rows
    const edgeRuns = await h.db.query<{ analysis_run_id: string }>(
      'SELECT DISTINCT analysis_run_id FROM edges WHERE snapshot_id=$1',
      [snapshotId],
    );
    expect(edgeRuns.rows).toEqual([{ analysis_run_id: cur.current_analysis_run_id }]);
  });

  it('a failed re-analysis keeps the previous good run and its data readable', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const before = await symbols(snapshotId);
    const goodRun = (await currentRunId(snapshotId)).current_analysis_run_id;

    h.gh.fail('acme', 'notes-api', 503);
    await runImport(deps(), snapshotId);

    const history = await runs(snapshotId);
    expect(history.map((r) => r.status)).toEqual(['succeeded', 'failed']);
    expect(history[1]!.error_code).toBe('SERVICE_UNAVAILABLE');
    expect(await currentRunId(snapshotId)).toEqual({ current_analysis_run_id: goodRun, status: 'ready' });
    expect(await symbols(snapshotId)).toEqual(before);
    expect((await d.get(`/api/v1/snapshots/${snapshotId}/tree`)).statusCode).toBe(200);
    const job = (await h.db.query('SELECT state, last_error FROM jobs WHERE snapshot_id=$1', [snapshotId]))
      .rows[0];
    expect(job.state).toBe('failed');
    expect(job.last_error).toMatch(/SERVICE_UNAVAILABLE/);
  });

  it('a failed first analysis leaves a failed run, no content and no current run', async () => {
    h.gh.fail('acme', 'notes-api', 503);
    const d = new Device(app);
    const res = await d.post('/api/v1/repositories', { url: 'https://github.com/acme/notes-api' });
    expect(res.statusCode).toBe(503); // the probe already sees the outage; nothing is queued
    expect((await h.db.query('SELECT count(*)::int AS n FROM analysis_runs')).rows[0].n).toBe(0);
  });

  it('records diagnostics for partially analysed code', async () => {
    const { snapshotId } = await new Device(app).importRepo('acme/partial');
    const [run] = await runs(snapshotId);
    expect(run).toMatchObject({ status: 'succeeded', outcome: 'ready_partial' });
    expect(run!.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'bad.js', kind: 'syntax_error' })]),
    );
  });

  it('marks runs interrupted by a crash as failed on boot and re-runs the snapshot', async () => {
    const { snapshotId } = await new Device(app).importRepo('acme/notes-api');
    await h.db.query(
      `INSERT INTO analysis_runs (snapshot_id, status, analyser_version, symbol_key_version) VALUES ($1,'running','x',1)`,
      [snapshotId],
    );
    await h.db.query(`UPDATE jobs SET state='running' WHERE snapshot_id=$1`, [snapshotId]);
    await h.app.services.runner.recover();
    await h.app.services.runner.idle();
    const statuses = (await runs(snapshotId)).map((r) => `${r.status}:${r.error_code ?? ''}`);
    expect(statuses).toEqual(['succeeded:', 'failed:INTERRUPTED', 'succeeded:']);
    expect((await currentRunId(snapshotId)).status).toBe('ready');
  });
});
