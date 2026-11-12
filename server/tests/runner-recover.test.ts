import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { createAnonymousUser } from '../src/auth/store';
import { createSnapshot, upsertRepository } from '../src/index/snapshots';
import { Harness } from './harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

async function queuedSnapshot(): Promise<string> {
  const owner = await createAnonymousUser(h.db);
  const repo = await upsertRepository(h.db, owner, 'acme', 'notes-api');
  return (await createSnapshot(h.db, repo, null, null, 7)).id;
}

const jobOf = async (snapshotId: string) =>
  (
    await h.db.query<{ state: string; attempts: number; last_error: string | null }>(
      'SELECT state, attempts, last_error FROM jobs WHERE snapshot_id=$1',
      [snapshotId],
    )
  ).rows[0];
const statusOf = async (snapshotId: string) =>
  (
    await h.db.query<{ status: string; error_code: string | null; error_message: string | null }>(
      'SELECT status, error_code, error_message FROM snapshots WHERE id=$1',
      [snapshotId],
    )
  ).rows[0];

describe('JobRunner.recover (boot-time recovery)', () => {
  it('re-queues a job that was running when the process died and completes it', async () => {
    const id = await queuedSnapshot();
    // The process died mid-import: the job is "running" and the snapshot is in a pipeline stage.
    await h.db.query(`UPDATE jobs SET state='running' WHERE snapshot_id=$1`, [id]);
    await h.db.query(`UPDATE snapshots SET status='analysing' WHERE id=$1`, [id]);

    expect(await h.app.services.runner.recover()).toBe(1);
    await h.app.services.runner.idle();

    expect(await statusOf(id)).toMatchObject({ status: 'ready', error_code: null });
    expect(await jobOf(id)).toMatchObject({ state: 'done', attempts: 1 });
  });

  it('re-queues queued jobs that never started', async () => {
    const id = await queuedSnapshot();
    expect(await h.app.services.runner.recover()).toBe(1);
    await h.app.services.runner.idle();
    expect((await statusOf(id))?.status).toBe('ready');
  });

  it('gives up after three interrupted attempts and marks the snapshot failed with a safe message', async () => {
    const id = await queuedSnapshot();
    await h.db.query(`UPDATE jobs SET state='running', attempts=3 WHERE snapshot_id=$1`, [id]);
    await h.db.query(`UPDATE snapshots SET status='fetching' WHERE id=$1`, [id]);

    expect(await h.app.services.runner.recover()).toBe(0);
    expect((await jobOf(id))?.state).toBe('failed');
    expect(await statusOf(id)).toMatchObject({
      status: 'failed',
      error_code: 'INDEX_FAILED',
      error_message: 'Analysis was interrupted.',
    });
  });

  it('fails an in-progress snapshot whose job row is missing instead of leaving it spinning', async () => {
    const id = await queuedSnapshot();
    await h.db.query('DELETE FROM jobs WHERE snapshot_id=$1', [id]);
    await h.db.query(`UPDATE snapshots SET status='analysing' WHERE id=$1`, [id]);
    expect(await h.app.services.runner.recover()).toBe(0);
    expect((await statusOf(id))?.status).toBe('failed');
  });

  it('leaves finished work alone', async () => {
    const { snapshotId } = await h.importRepo('https://github.com/acme/notes-api');
    expect(await h.app.services.runner.recover()).toBe(0);
    expect((await statusOf(snapshotId))?.status).toBe('ready');
    expect(await jobOf(snapshotId)).toMatchObject({ state: 'done', attempts: 0 });
  });
});
