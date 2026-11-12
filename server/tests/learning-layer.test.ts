import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { runImport } from '../src/jobs/importJob';
import { runRetention } from '../src/jobs/retention';
import { Device } from './device';
import { Harness, parseSse } from './harness';

const h = new Harness();
const app = () => h.app;
const SHA = 'beef00'.padEnd(40, '0');
const LOGIN_SEL = {
  path: 'src/controllers/authController.js',
  startLine: 4,
  startCol: 15,
  endLine: 4,
  endCol: 52,
};
const LOGIN_KEY = 'src/controllers/authController.js#function:login';

beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const n = async (sql: string, params: unknown[] = []) =>
  (await h.db.query<{ n: number }>(sql, params)).rows[0]!.n;
const total = (table: string) => n(`SELECT count(*)::int AS n FROM ${table}`);

async function explain(d: Device, snapshotId: string) {
  const res = await d.post('/api/v1/explanations', { snapshotId, selection: LOGIN_SEL });
  const done = parseSse(res.body).find((e) => e.event === 'done');
  if (!done) throw new Error(`no explanation: ${res.body.slice(0, 300)}`);
  return done.data.explanationId as string;
}

/** A learner with a full learning trail on one repository: explanation, thread, check, feedback, progress... */
async function learnerWithHistory(d = new Device(app), ref?: string) {
  const { snapshotId, repositoryId } = await d.importRepo('acme/notes-api', ref);
  const explanationId = await explain(d, snapshotId);
  await d.post(`/api/v1/explanations/${explanationId}/messages`, {
    intent: 'followup',
    text: 'Why await here?',
  });
  const check = (await d.post(`/api/v1/explanations/${explanationId}/checks`)).json();
  await d.post(`/api/v1/checks/${check.checkId}/answer`, { answerIndex: 0 });
  await d.post('/api/v1/feedback', { targetType: 'explanation', targetId: explanationId, rating: 'up' });
  await d.post('/api/v1/feedback', { targetType: 'check', targetId: check.checkId, rating: 'down' });
  const userId = (
    await h.db.query<{ owner_id: string }>('SELECT owner_id FROM repositories WHERE id=$1', [repositoryId])
  ).rows[0]!.owner_id;
  await h.db.query(
    `INSERT INTO learning_progress (user_id, repository_id, subject_kind, subject_key, status)
     VALUES ($1,$2,'symbol',$3,'started'), ($1,$2,'level','exploration','started')`,
    [userId, repositoryId, LOGIN_KEY],
  );
  await h.db.query(
    `INSERT INTO bookmarks (user_id, repository_id, path, symbol_key, start_line, end_line, commit_sha, label)
     VALUES ($1,$2,'src/controllers/authController.js',$3,3,7,$4,'login flow')`,
    [userId, repositoryId, LOGIN_KEY, SHA],
  );
  await h.db.query(
    `INSERT INTO learner_positions (user_id, repository_id, track, path, symbol_key, start_line, end_line, state)
     VALUES ($1,$2,'learning','src/controllers/authController.js',$3,3,7,'{"v":1}')`,
    [userId, repositoryId, LOGIN_KEY],
  );
  return { d, snapshotId, repositoryId, explanationId, checkId: check.checkId as string, userId };
}

const LEARNING_TABLES = [
  'explanations',
  'messages',
  'check_attempts',
  'feedback',
  'learning_progress',
  'bookmarks',
  'learner_positions',
];

describe('retention keeps learning history (acceptance: P1.4)', () => {
  it('deletes the code of an expired snapshot but keeps every learning row', async () => {
    const t = await learnerWithHistory();
    await t.d.register('ada@example.com');
    const before: Record<string, number> = Object.fromEntries(
      await Promise.all(LEARNING_TABLES.map(async (x) => [x, await total(x)] as const)),
    );
    expect(Object.values(before).every((c) => c > 0)).toBe(true);

    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    expect((await runRetention(h.db, h.app.log)).snapshots).toBe(1);

    for (const table of ['snapshots', 'files', 'symbols', 'edges', 'analysis_runs', 'jobs'])
      expect(await total(table), table).toBe(0);
    for (const table of LEARNING_TABLES) expect(await total(table), table).toBe(before[table]);
    expect(await total('repositories')).toBe(1); // kept as the anchor of the history

    const ex = (
      await h.db.query(
        'SELECT snapshot_id, repository_id, symbol_key, commit_sha, symbol_id FROM explanations',
      )
    ).rows[0];
    expect(ex).toMatchObject({
      snapshot_id: null,
      repository_id: t.repositoryId,
      symbol_key: LOGIN_KEY,
      symbol_id: null,
    });

    // The history is still readable by its owner; continuing it says clearly that the code is gone.
    const restored = await t.d.get(`/api/v1/explanations/${t.explanationId}`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ snapshotId: null, messages: expect.any(Array) });
    expect(restored.json().messages.length).toBe(2);
    const followUp = await t.d.post(`/api/v1/explanations/${t.explanationId}/messages`, {
      intent: 'followup',
      text: 'and now?',
    });
    expect(followUp.statusCode).toBe(410);
    expect(followUp.json().error.code).toBe('SNAPSHOT_EXPIRED');
  });

  it('deleting the repository on request deletes its learning history too', async () => {
    const t = await learnerWithHistory();
    const del = await t.d.delete(`/api/v1/repositories/${t.repositoryId}`);
    expect(del.statusCode).toBe(202);
    for (const table of [...LEARNING_TABLES, 'repositories', 'snapshots'])
      expect(await total(table), table).toBe(0);
  });

  it('re-links explanations to the new symbol rows by stable key after re-analysis', async () => {
    const t = await learnerWithHistory();
    const linked = async () =>
      (
        await h.db.query<{ symbol_id: string | null; key: string | null }>(
          `SELECT e.symbol_id, s.symbol_key AS key FROM explanations e LEFT JOIN symbols s ON s.id = e.symbol_id`,
        )
      ).rows[0]!;
    const before = await linked();
    expect(before.key).toBe(LOGIN_KEY);
    await runImport(
      { config: h.app.services.config, db: h.db, github: h.app.services.github, log: h.app.log },
      t.snapshotId,
    );
    const after = await linked();
    expect(after.symbol_id).not.toBe(before.symbol_id); // a new run, new row ids
    expect(after.key).toBe(LOGIN_KEY); // ...but the same symbol
  });
});

describe('typed feedback (acceptance: P1.4)', () => {
  it('stores each vote against a real typed foreign key, derives target_id, and leaves no orphans', async () => {
    const t = await learnerWithHistory();
    const rows = (
      await h.db.query(
        'SELECT target_type, target_id, explanation_id, message_id, check_attempt_id FROM feedback ORDER BY target_type',
      )
    ).rows;
    expect(rows).toEqual([
      {
        target_type: 'check',
        target_id: t.checkId,
        explanation_id: null,
        message_id: null,
        check_attempt_id: t.checkId,
      },
      {
        target_type: 'explanation',
        target_id: t.explanationId,
        explanation_id: t.explanationId,
        message_id: null,
        check_attempt_id: null,
      },
    ]);
    // Deleting the target deletes its feedback: nothing can dangle.
    await h.db.query('DELETE FROM check_attempts WHERE id=$1', [t.checkId]);
    expect(await total('feedback')).toBe(1);
    expect(
      await n(`SELECT count(*)::int AS n FROM feedback f WHERE NOT EXISTS (SELECT 1 FROM explanations e WHERE e.id=f.explanation_id)
               AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id=f.message_id)
               AND NOT EXISTS (SELECT 1 FROM check_attempts c WHERE c.id=f.check_attempt_id)`),
    ).toBe(0);
  });

  it('the database rejects untyped, doubly-typed, mistyped and dangling feedback', async () => {
    const t = await learnerWithHistory();
    const ins = (cols: string, vals: string) =>
      h.db
        .query(
          `INSERT INTO feedback (owner_id, target_type, rating, ${cols}) VALUES ($1, ${vals}, 'up', $2)`,
          [t.userId, t.explanationId],
        )
        .then(
          () => 'ok',
          (e: { code: string }) => e.code,
        );
    await h.db.query('DELETE FROM feedback');
    expect(await ins('explanation_id', `'message'`)).toBe('23514'); // type says message, column says explanation
    expect(await ins('message_id', `'message'`)).toBe('23503'); // not a message id: foreign key violation
    expect(
      await h.db
        .query(`INSERT INTO feedback (owner_id, target_type, rating) VALUES ($1, 'explanation', 'up')`, [
          t.userId,
        ])
        .then(
          () => 'ok',
          (e: { code: string }) => e.code,
        ),
    ).toBe('23514'); // no target at all
    expect(await ins('explanation_id', `'explanation'`)).toBe('ok');
  });
});

describe('cross-user isolation in the data model', () => {
  it("no learning row can point at another user's repository", async () => {
    const victim = await learnerWithHistory();
    const mallory = new Device(app);
    await mallory.register('mallory@example.com');
    const malloryId = (
      await h.db.query<{ id: string }>(`SELECT id FROM users WHERE email='mallory@example.com'`)
    ).rows[0]!.id;
    const attempt = (sql: string, params: unknown[]) =>
      h.db.query(sql, params).then(
        () => 'ok',
        (e: { code: string }) => e.code,
      );
    expect(
      await attempt(`INSERT INTO bookmarks (user_id, repository_id, path) VALUES ($1,$2,'src/app.js')`, [
        malloryId,
        victim.repositoryId,
      ]),
    ).toBe('23503');
    expect(
      await attempt(
        `INSERT INTO learning_progress (user_id, repository_id, subject_kind, subject_key, status) VALUES ($1,$2,'file','x','started')`,
        [malloryId, victim.repositoryId],
      ),
    ).toBe('23503');
    expect(
      await attempt(
        `INSERT INTO learner_positions (user_id, repository_id, track) VALUES ($1,$2,'exploration')`,
        [malloryId, victim.repositoryId],
      ),
    ).toBe('23503');
    expect(await attempt(`UPDATE explanations SET owner_id=$1`, [malloryId])).toBe('23503');
    // ...and the API never shows one learner's history to another.
    expect((await mallory.get(`/api/v1/explanations/${victim.explanationId}`)).statusCode).toBe(403);
  });

  it('enforces the shape of learning rows', async () => {
    const t = await learnerWithHistory();
    const attempt = (sql: string) =>
      h.db.query(sql, [t.userId, t.repositoryId]).then(
        () => 'ok',
        (e: { code: string }) => e.code,
      );
    expect(
      await attempt(
        `INSERT INTO learning_progress (user_id, repository_id, subject_kind, subject_key, status) VALUES ($1,$2,'level','level-9','started')`,
      ),
    ).toBe('23514');
    expect(
      await attempt(
        `INSERT INTO learning_progress (user_id, repository_id, subject_kind, subject_key, status) VALUES ($1,$2,'file','a.js','completed')`,
      ),
    ).toBe('23514');
    expect(
      await attempt(
        `INSERT INTO bookmarks (user_id, repository_id, path, start_line, end_line) VALUES ($1,$2,'a.js',9,3)`,
      ),
    ).toBe('23514');
    expect(
      await attempt(
        `INSERT INTO bookmarks (user_id, repository_id, path, commit_sha) VALUES ($1,$2,'a.js','main')`,
      ),
    ).toBe('23514');
    expect(
      await attempt(
        `INSERT INTO learner_positions (user_id, repository_id, track, state) VALUES ($1,$2,'exploration','[]')`,
      ),
    ).toBe('23514');
    // One row per subject, per anchor, per track.
    expect(
      await attempt(
        `INSERT INTO learning_progress (user_id, repository_id, subject_kind, subject_key, status) VALUES ($1,$2,'level','exploration','completed')`,
      ),
    ).toBe('23514');
    expect(
      await attempt(
        `INSERT INTO learner_positions (user_id, repository_id, track) VALUES ($1,$2,'learning')`,
      ),
    ).toBe('23505');
  });
});

describe('claiming anonymous learning history', () => {
  it('merges progress (furthest status wins), bookmarks (no duplicates) and positions (newest wins)', async () => {
    const ada = new Device(app);
    await ada.register('ada@example.com');
    const mine = await learnerWithHistory(ada, SHA);
    await h.db.query(
      `UPDATE learning_progress SET status='completed', completed_at=now() WHERE subject_kind='symbol'`,
    );
    await h.db.query(`UPDATE learner_positions SET updated_at = now() - interval '1 day'`);

    const library = await learnerWithHistory(new Device(app), SHA);
    await h.db.query(
      `UPDATE learner_positions SET path='src/app.js', start_line=1, end_line=2 WHERE user_id=$1`,
      [library.userId],
    );
    await library.d.login('ada@example.com');
    const claim = await library.d.post('/api/v1/auth/claim');
    expect(claim.statusCode, claim.body).toBe(200);

    expect(await total('repositories')).toBe(1);
    expect(await total('snapshots')).toBe(1);
    const progress = (
      await h.db.query(`SELECT subject_kind, status FROM learning_progress ORDER BY subject_kind`)
    ).rows;
    expect(progress).toEqual([
      { subject_kind: 'level', status: 'started' },
      { subject_kind: 'symbol', status: 'completed' },
    ]);
    expect(await total('bookmarks')).toBe(1);
    const pos = (await h.db.query(`SELECT user_id, path FROM learner_positions`)).rows;
    expect(pos).toEqual([{ user_id: mine.userId, path: 'src/app.js' }]);
    // Both explanations now belong to the account, attached to the surviving snapshot and re-linked by key.
    const ex = (
      await h.db.query(
        `SELECT e.owner_id, e.snapshot_id, s.symbol_key FROM explanations e JOIN symbols s ON s.id = e.symbol_id`,
      )
    ).rows;
    expect(ex).toHaveLength(2);
    expect(
      ex.every(
        (r) => r.owner_id === mine.userId && r.snapshot_id === mine.snapshotId && r.symbol_key === LOGIN_KEY,
      ),
    ).toBe(true);
  });
});

describe('anonymous retention', () => {
  it('removes an idle anonymous learner and their history once their code has expired', async () => {
    await learnerWithHistory();
    await h.db.query(`UPDATE snapshots SET expires_at = now() - interval '1 minute'`);
    await h.db.query(`UPDATE users SET last_seen_at = now() - interval '31 days'`);
    await runRetention(h.db, h.app.log);
    for (const table of [...LEARNING_TABLES, 'repositories', 'users'])
      expect(await total(table), table).toBe(0);
  });
});
