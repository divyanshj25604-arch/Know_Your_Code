import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnnotationView } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import { runRetention } from '../src/jobs/retention';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: { 'acme/notes-api': { fixture: 'express-cjs' }, 'acme/shop': { fixture: 'react-ts' } },
  }),
);
afterEach(() => h.close());

const SHA = 'beef00'.padEnd(40, '0');
const ON_LOGIN = {
  targetKind: 'symbol',
  targetKey: 'src/controllers/authController.js#function:login',
  targetLabel: 'login()',
  path: 'src/controllers/authController.js',
  startLine: 3,
  endLine: 7,
  commitSha: SHA,
  body: 'Looks the user up <b>by email</b>, then answers 401 or the id.',
};
const ON_RELATION = {
  targetKind: 'relation',
  targetKey: 'src/routes/auth.js|imports|src/controllers/authController.js',
  targetLabel: 'auth.js → authController.js',
  body: 'Routes only wire URLs to controllers.',
};

const urlOf = (repositoryId: string) => `/api/v1/repositories/${repositoryId}/annotations`;
const patch = (d: Device, id: string, body: unknown) => d.request('PATCH', `/api/v1/annotations/${id}`, body);
const list = async (d: Device, repositoryId: string) =>
  (await d.get(urlOf(repositoryId))).json().annotations as AnnotationView[];
const total = async () =>
  (await h.db.query<{ n: number }>('SELECT count(*)::int AS n FROM annotations')).rows[0]!.n;

describe('annotations', () => {
  it('creates, lists newest-updated first, updates and deletes', async () => {
    const d = new Device(app);
    const { repositoryId } = await d.importRepo('acme/notes-api');
    const a = await d.post(urlOf(repositoryId), ON_LOGIN);
    expect(a.statusCode).toBe(201);
    const first = a.json() as AnnotationView;
    expect(first).toMatchObject({ ...ON_LOGIN, id: expect.any(String) });
    expect(first.body).toBe(ON_LOGIN.body); // stored as written, markup included (the client renders text)
    // A second note on the same target is a new note, not an update.
    const again = await d.post(urlOf(repositoryId), { ...ON_LOGIN, body: 'Second thought.' });
    expect(again.statusCode).toBe(201);
    expect(again.json().id).not.toBe(first.id);
    const rel = (await d.post(urlOf(repositoryId), ON_RELATION)).json() as AnnotationView;
    expect(rel).toMatchObject({ path: null, startLine: null, endLine: null, commitSha: null });

    expect((await list(d, repositoryId)).map((x) => x.id)).toEqual([rel.id, again.json().id, first.id]);

    const upd = await patch(d, first.id, { body: '  Edited.  ' });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ id: first.id, body: 'Edited.', targetKey: ON_LOGIN.targetKey });
    expect(new Date(upd.json().updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.updatedAt).getTime(),
    );
    expect((await list(d, repositoryId))[0]!.id).toBe(first.id); // most recently updated first

    expect((await d.delete(`/api/v1/annotations/${first.id}`)).statusCode).toBe(204);
    expect((await d.delete(`/api/v1/annotations/${first.id}`)).statusCode).toBe(404);
    expect((await list(d, repositoryId)).map((x) => x.id)).toEqual([rel.id, again.json().id]);
  });

  it('validates input', async () => {
    const d = new Device(app);
    const { repositoryId } = await d.importRepo('acme/notes-api');
    const url = urlOf(repositoryId);
    for (const bad of [
      { ...ON_LOGIN, targetKind: 'line' },
      { ...ON_LOGIN, targetKey: '' },
      { ...ON_LOGIN, targetLabel: '   ' },
      { ...ON_LOGIN, body: '   ' },
      { ...ON_LOGIN, body: 'x'.repeat(2001) },
      { ...ON_LOGIN, startLine: 9, endLine: 2 },
      { ...ON_LOGIN, endLine: null },
      { ...ON_LOGIN, commitSha: 'abc' },
      { ...ON_LOGIN, path: '' },
    ])
      expect((await d.post(url, bad)).statusCode, JSON.stringify(bad).slice(0, 80)).toBe(400);
    const ok = (await d.post(url, ON_RELATION)).json() as AnnotationView;
    expect((await patch(d, ok.id, { body: '' })).statusCode).toBe(400);
    expect((await patch(d, ok.id, {})).statusCode).toBe(400);
    expect((await patch(d, 'not-a-uuid', { body: 'x' })).statusCode).toBe(400);
    expect(await total()).toBe(1);
  });

  it('is personal: another user can neither list, add, edit nor delete', async () => {
    const owner = new Device(app);
    const { repositoryId, snapshotId } = await owner.importRepo('acme/notes-api');
    const mine = (await owner.post(urlOf(repositoryId), ON_LOGIN)).json() as AnnotationView;
    const stranger = new Device(app);
    expect((await stranger.get(urlOf(repositoryId))).statusCode).toBe(404);
    expect((await stranger.post(urlOf(repositoryId), ON_LOGIN)).statusCode).toBe(404);
    expect((await patch(stranger, mine.id, { body: 'mine now' })).statusCode).toBe(404);
    expect((await stranger.delete(`/api/v1/annotations/${mine.id}`)).statusCode).toBe(404);
    // A share token grants snapshot reads, never the owner's notes.
    const token = (await owner.post(`/api/v1/snapshots/${snapshotId}/share-tokens`, { ttlHours: 1 })).json()
      .token;
    expect((await stranger.get(urlOf(repositoryId), { 'x-kyc-share': token })).statusCode).toBe(404);
    expect((await list(owner, repositoryId)).map((x) => [x.id, x.body])).toEqual([[mine.id, ON_LOGIN.body]]);
    // The stranger's own repository does not open the owner's notes either.
    const theirs = await stranger.importRepo('acme/shop');
    expect(await list(stranger, theirs.repositoryId)).toEqual([]);
  });

  it('is deleted with its repository', async () => {
    const d = new Device(app);
    const { repositoryId } = await d.importRepo('acme/notes-api');
    await d.post(urlOf(repositoryId), ON_LOGIN);
    await d.post(urlOf(repositoryId), ON_RELATION);
    expect(await total()).toBe(2);
    expect((await d.delete(`/api/v1/repositories/${repositoryId}`)).statusCode).toBe(202);
    expect(await total()).toBe(0);
  });

  it('survives code retention, keeping its repository as the anchor', async () => {
    const d = new Device(app);
    await d.register('ada@example.com');
    const { repositoryId } = await d.importRepo('acme/notes-api');
    // The only learning row on this repository is an annotation: retention must still keep the repository.
    const a = (await d.post(urlOf(repositoryId), ON_LOGIN)).json() as AnnotationView;
    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    expect((await runRetention(h.db, h.app.log)).snapshots).toBe(1);
    expect((await h.db.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(0);
    expect((await h.db.query('SELECT count(*)::int AS n FROM repositories')).rows[0].n).toBe(1);
    expect(await list(d, repositoryId)).toEqual([a]);
  });

  it('moves with anonymous work claimed into an account, both when the repository moves and when it merges', async () => {
    const ada = new Device(app);
    await ada.register('ada@example.com');
    const adaRepo = await ada.importRepo('acme/notes-api');
    await ada.post(urlOf(adaRepo.repositoryId), ON_RELATION);

    const libraryPc = new Device(app);
    const merged = await libraryPc.importRepo('acme/notes-api'); // ada has this repository: merged
    const moved = await libraryPc.importRepo('acme/shop'); // ada does not: moved
    await libraryPc.post(urlOf(merged.repositoryId), ON_LOGIN);
    await libraryPc.post(urlOf(merged.repositoryId), { ...ON_LOGIN, body: 'Two notes on one target.' });
    await libraryPc.post(urlOf(moved.repositoryId), {
      targetKind: 'file',
      targetKey: 'src/components/Cart.tsx',
      targetLabel: 'Cart.tsx',
      path: 'src/components/Cart.tsx',
      body: 'The cart.',
    });

    await libraryPc.login('ada@example.com');
    expect((await libraryPc.post('/api/v1/auth/claim')).statusCode).toBe(200);

    expect(await total()).toBe(4);
    expect((await list(ada, adaRepo.repositoryId)).map((x) => x.body).sort()).toEqual(
      [ON_RELATION.body, ON_LOGIN.body, 'Two notes on one target.'].sort(),
    );
    expect((await list(ada, moved.repositoryId)).map((x) => x.body)).toEqual(['The cart.']);
    const owners = await h.db.query('SELECT DISTINCT user_id FROM annotations');
    expect(owners.rows).toHaveLength(1);
  });
});
