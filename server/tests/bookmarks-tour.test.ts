import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const LOGIN = {
  path: 'src/controllers/authController.js',
  symbolKey: 'src/controllers/authController.js#function:login',
  startLine: 3,
  endLine: 7,
  label: 'login',
};

describe('bookmarks (P3.4)', () => {
  it('creates, de-duplicates by anchor, lists newest first and deletes', async () => {
    const d = new Device(app);
    const { repositoryId } = await d.importRepo('acme/notes-api');
    const url = `/api/v1/repositories/${repositoryId}/bookmarks`;
    const a = await d.post(url, LOGIN);
    expect(a.statusCode).toBe(201);
    const again = await d.post(url, { ...LOGIN, label: 'renamed' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: a.json().id, label: 'renamed' });
    await d.post(url, { path: 'src/app.js' });
    const list = (await d.get(url)).json().bookmarks;
    expect(list.map((b: { path: string }) => b.path)).toEqual(['src/app.js', LOGIN.path]);
    expect((await d.delete(`/api/v1/bookmarks/${a.json().id}`)).statusCode).toBe(204);
    expect((await d.get(url)).json().bookmarks).toHaveLength(1);
  });

  it('is personal and validated', async () => {
    const owner = new Device(app);
    const { repositoryId } = await owner.importRepo('acme/notes-api');
    const url = `/api/v1/repositories/${repositoryId}/bookmarks`;
    const mine = (await owner.post(url, LOGIN)).json();
    const stranger = new Device(app);
    expect((await stranger.get(url)).statusCode).toBe(404);
    expect((await stranger.post(url, LOGIN)).statusCode).toBe(404);
    expect((await stranger.delete(`/api/v1/bookmarks/${mine.id}`)).statusCode).toBe(404);
    expect((await owner.post(url, { ...LOGIN, startLine: 9, endLine: 2 })).statusCode).toBe(400);
    expect((await owner.post(url, { path: '' })).statusCode).toBe(400);
  });
});

describe('guided tour (P3.4)', () => {
  it('starts at the entry point, then visits the most-used functions, deterministically', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const tour = (await d.get(`/api/v1/snapshots/${snapshotId}/tour`)).json();
    expect(tour.stops[0]).toMatchObject({ path: 'src/app.js', line: 1 });
    expect(tour.stops.map((s: { title: string }) => s.title)).toContain('login');
    expect(tour.stops.find((s: { title: string }) => s.title === 'login').symbolKey).toBe(LOGIN.symbolKey);
    expect((await d.get(`/api/v1/snapshots/${snapshotId}/tour`)).json()).toEqual(tour);
    expect((await new Device(app).get(`/api/v1/snapshots/${snapshotId}/tour`)).statusCode).toBe(404);
  });
});
