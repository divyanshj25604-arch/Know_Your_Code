import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PathItemResult, PathsView } from '@kyc/contracts';
import type { CheckContent, MissionContent } from '@kyc/core';
import { FakeLlm } from '../src/ai/fake';
import { pathContent } from '../src/index/paths';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const itemUrl = (snap: string, path: string, item: string) =>
  `/api/v1/snapshots/${snap}/paths/${encodeURIComponent(path)}/items/${encodeURIComponent(item)}`;

describe('learning paths (P3.7)', () => {
  it('generates project, application and concept paths, each with lessons, a mission and a check, without answers', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const res = await d.get(`/api/v1/snapshots/${snapshotId}/paths`);
    expect(res.statusCode).toBe(200);
    const view = res.json() as PathsView;
    expect(view.paths.map((p) => [p.id, p.level, p.status])).toEqual([
      ['path:project', 'project', 'not_started'],
      ['path:application', 'application', 'not_started'],
      ['path:concepts', 'concept', 'not_started'],
    ]);
    for (const p of view.paths)
      expect(p.items.map((i) => i.kind).sort()).toEqual(['check', 'lesson', 'lesson', 'mission']);
    const app = view.paths[1]!;
    expect(app.title).toBe('Follow a request: POST /auth/login');
    expect(app.items.find((i) => i.kind === 'check')!.question).toBe(
      'While handling POST /auth/login, which function does login call?',
    );
    expect(app.items.find((i) => i.kind === 'check')!.options).toContain('findUserByEmail');
    // Lessons point at real code.
    expect(app.items.flatMap((i) => i.blocks ?? [])).toEqual(
      expect.arrayContaining([
        { type: 'code', path: 'src/controllers/authController.js', line: 3, label: 'Open login' },
      ]),
    );
    // Answers stay on the server.
    expect(res.body).not.toMatch(/correctIndex|"accept"|"answer"|explanation/);
    // Owner only.
    expect((await new Device(() => h.app).get(`/api/v1/snapshots/${snapshotId}/paths`)).statusCode).toBe(404);
  });

  it('a path with lessons, a mission and a check is completed, graded on the server and recorded', async () => {
    const d = new Device(() => h.app);
    const { snapshotId, repositoryId } = await d.importRepo('acme/notes-api');
    const content = (await pathContent(h.db, snapshotId)).find((p) => p.id === 'path:application')!;
    const mission = content.items.find((i) => i.kind === 'mission') as MissionContent;
    const check = content.items.find((i) => i.kind === 'check') as CheckContent;
    const [lesson, lesson2] = content.items.filter((i) => i.kind === 'lesson');
    const post = (item: string, body: unknown) => d.post(itemUrl(snapshotId, content.id, item), body);

    // A wrong place does not complete the mission, but counts as an attempt.
    let r = (
      await post(mission.id, { kind: 'mission', path: 'src/app.js', line: 1 })
    ).json() as PathItemResult;
    expect(r).toMatchObject({ correct: false, itemStatus: 'started', pathStatus: 'started' });
    expect(r.feedback).toMatch(/Routes are registered in src\/routes\/auth\.js/);
    // Any line inside the handler completes it.
    r = (
      await post(mission.id, { kind: 'mission', path: 'src/controllers/authController.js', line: 5 })
    ).json();
    expect(r).toMatchObject({ correct: true, itemStatus: 'completed', pathStatus: 'started' });
    expect(r.refs).toEqual([{ path: 'src/controllers/authController.js', line: 3 }]);

    for (const l of [lesson!, lesson2!]) {
      r = (await post(l.id, { kind: 'lesson' })).json();
      expect(r).toMatchObject({ correct: true, itemStatus: 'completed', pathStatus: 'started' });
    }

    const wrong = (check.correctIndex + 1) % check.options.length;
    r = (await post(check.id, { kind: 'check', answerIndex: wrong })).json();
    expect(r).toMatchObject({ correct: false, itemStatus: 'started', pathStatus: 'started' });
    r = (await post(check.id, { kind: 'check', answerIndex: check.correctIndex })).json();
    expect(r).toMatchObject({ correct: true, itemStatus: 'completed', pathStatus: 'completed' });
    expect(r.feedback).toMatch(/login calls findUserByEmail/);

    // A later wrong answer never undoes a completion.
    r = (await post(check.id, { kind: 'check', answerIndex: wrong })).json();
    expect(r).toMatchObject({ correct: false, itemStatus: 'completed', pathStatus: 'completed' });

    const rows = await h.db.query(
      `SELECT subject_kind, subject_key, status, attempts, completed_at IS NOT NULL AS done FROM learning_progress
       WHERE repository_id=$1 ORDER BY subject_kind, subject_key`,
      [repositoryId],
    );
    expect(rows.rows).toEqual([
      {
        subject_kind: 'check',
        subject_key: `path:application/${check.id}`,
        status: 'completed',
        attempts: 3,
        done: true,
      },
      ...[lesson!, lesson2!]
        .map((l) => `path:application/${l.id}`)
        .sort()
        .map((k) => ({
          subject_kind: 'lesson',
          subject_key: k,
          status: 'completed',
          attempts: 0,
          done: true,
        })),
      {
        subject_kind: 'mission',
        subject_key: `path:application/${mission.id}`,
        status: 'completed',
        attempts: 2,
        done: true,
      },
      { subject_kind: 'path', subject_key: 'path:application', status: 'completed', attempts: 0, done: true },
    ]);
    const view = (await d.get(`/api/v1/snapshots/${snapshotId}/paths`)).json() as PathsView;
    expect(view.paths.find((p) => p.id === 'path:application')).toMatchObject({ status: 'completed' });
    expect(view.paths.find((p) => p.id === 'path:project')).toMatchObject({ status: 'not_started' });

    // Progress belongs to the repository, so a new snapshot of the same code shows it.
    const again = await d.importRepo('acme/notes-api');
    expect(again.snapshotId).not.toBe(snapshotId);
    const view2 = (await d.get(`/api/v1/snapshots/${again.snapshotId}/paths`)).json() as PathsView;
    expect(view2.paths.find((p) => p.id === 'path:application')).toMatchObject({ status: 'completed' });
  });

  it('rejects mismatched, unknown and foreign submissions', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const content = (await pathContent(h.db, snapshotId))[0]!;
    const check = content.items.find((i) => i.kind === 'check')!;
    expect((await d.post(itemUrl(snapshotId, content.id, check.id), { kind: 'lesson' })).statusCode).toBe(
      400,
    );
    expect(
      (await d.post(itemUrl(snapshotId, content.id, check.id), { kind: 'check', answerIndex: 9 })).statusCode,
    ).toBe(400);
    expect(
      (await d.post(itemUrl(snapshotId, content.id, 'lesson:nope'), { kind: 'lesson' })).statusCode,
    ).toBe(404);
    expect((await d.post(itemUrl(snapshotId, 'path:nope', check.id), { kind: 'lesson' })).statusCode).toBe(
      404,
    );
    const stranger = new Device(() => h.app);
    expect(
      (await stranger.post(itemUrl(snapshotId, content.id, check.id), { kind: 'check', answerIndex: 0 }))
        .statusCode,
    ).toBe(404);
  });
});
