import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { buildApp } from '../src/app';
import { createPool, type Db } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { testConfig } from './helpers';

/**
 * Migration safety (Phase 1): build a database exactly as it was before Phase 1 (001–003), fill it with
 * representative data of every kind, apply the Phase 1 migrations, check every row survived and was transformed
 * correctly, run the real application against it, then apply the rollback scripts and check the schema returns to
 * its pre-Phase-1 shape with the data intact.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'src', 'db', 'migrations');
const ROLLBACKS = path.join(here, '..', 'src', 'db', 'rollbacks');
const PHASE1 = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f >= '004')
  .sort();

const baseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/kyc_test';
const dbName = `kyc_migtest_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const tempUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: Db;
let db: Db;

const SHA = 'a1'.repeat(20);
const ids = {
  owner: randomUUID(),
  idle: randomUUID(),
  repo: randomUUID(),
  snap: randomUUID(),
  file: randomUUID(),
  fn: randomUUID(),
  param: randomUUID(),
  expl: randomUUID(),
  msg: randomUUID(),
  check: randomUUID(),
  fb: randomUUID(),
  orphanFb: randomUUID(),
};

async function schemaShape(d: Db) {
  const cols = await d.query<{ t: string; c: string; type: string; nullable: string }>(
    `SELECT table_name AS t, column_name AS c, data_type AS type, is_nullable AS nullable
     FROM information_schema.columns WHERE table_schema='public' ORDER BY 1, 2`,
  );
  const cons = await d.query<{ t: string; def: string }>(
    `SELECT conrelid::regclass::text AS t, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND contype IN ('f','u','p','c') ORDER BY 1, 2`,
  );
  const idx = await d.query<{ def: string }>(
    `SELECT indexdef AS def FROM pg_indexes WHERE schemaname='public' ORDER BY indexdef`,
  );
  return { columns: cols.rows, constraints: cons.rows, indexes: idx.rows };
}

async function seedLegacy(d: Db) {
  await d.query(`INSERT INTO owners (id) VALUES ($1), ($2)`, [ids.owner, ids.idle]);
  await d.query(`INSERT INTO repositories (id, owner_id, gh_owner, gh_name) VALUES ($1,$2,'acme','legacy')`, [
    ids.repo,
    ids.owner,
  ]);
  await d.query(
    `INSERT INTO snapshots (id, repository_id, commit_sha, status, stages, overview, expires_at)
     VALUES ($1,$2,$3,'ready','[{"name":"fetching","state":"done"}]','{"facts":{}}', now() + interval '7 days')`,
    [ids.snap, ids.repo, SHA],
  );
  await d.query(`INSERT INTO jobs (snapshot_id, state) VALUES ($1,'done')`, [ids.snap]);
  await d.query(
    `INSERT INTO files (id, snapshot_id, path, language, analysable, size_bytes, line_count, content)
     VALUES ($1,$2,'src/a.js','js',true,40,3,'function login(x) {\n  return x;\n}\n')`,
    [ids.file, ids.snap],
  );
  await d.query(
    `INSERT INTO symbols (id, snapshot_id, file_id, name, qualified_name, kind, start_line, start_col, end_line, end_col)
     VALUES ($1,$2,$3,'login','login','function',1,0,3,1)`,
    [ids.fn, ids.snap, ids.file],
  );
  await d.query(
    `INSERT INTO symbols (id, snapshot_id, file_id, parent_symbol_id, name, qualified_name, kind, start_line, start_col, end_line, end_col)
     VALUES ($1,$2,$3,$4,'x','login.x','parameter',1,15,1,16)`,
    [ids.param, ids.snap, ids.file, ids.fn],
  );
  await d.query(
    `INSERT INTO edges (snapshot_id, type, source_symbol_id, source_file_id, target_symbol_id, line, provenance)
     VALUES ($1,'calls',$2,$3,$2,2,'verified')`,
    [ids.snap, ids.fn, ids.file],
  );
  await d.query(
    `INSERT INTO explanations (id, snapshot_id, owner_id, cache_key, selection, kind, depth, symbol_id, body, prompt_version, model)
     VALUES ($1,$2,$3,$4,'{"path":"src/a.js","startLine":1,"startCol":9,"endLine":1,"endCol":14}','function','default',$5,
             '{"kind":"function","sections":{"what":{"text":"legacy","refs":[]}},"concepts":[],"exploreNext":[],"uncertainty":[]}','p1','m')`,
    [ids.expl, ids.snap, ids.owner, 'c'.repeat(64), ids.fn],
  );
  await d.query(
    `INSERT INTO messages (id, explanation_id, role, intent, body) VALUES ($1,$2,'assistant','followup','{"text":"hi"}')`,
    [ids.msg, ids.expl],
  );
  await d.query(
    `INSERT INTO check_attempts (id, explanation_id, question) VALUES ($1,$2,'{"question":"q"}')`,
    [ids.check, ids.expl],
  );
  await d.query(
    `INSERT INTO feedback (id, owner_id, target_type, target_id, rating) VALUES ($1,$2,'explanation',$3,'up')`,
    [ids.fb, ids.owner, ids.expl],
  );
  // Left behind by the old snapshot cascade: feedback whose target no longer exists.
  await d.query(
    `INSERT INTO feedback (id, owner_id, target_type, target_id, rating, comment) VALUES ($1,$2,'message',$3,'down','kept')`,
    [ids.orphanFb, ids.owner, randomUUID()],
  );
  await d.query(`INSERT INTO events (owner_id, name) VALUES ($1,'landing_cta')`, [ids.owner]);
  await d.query(
    `INSERT INTO llm_calls (owner_id, snapshot_id, task, model, prompt_version, status) VALUES ($1,$2,'explain','m','p','ok')`,
    [ids.owner, ids.snap],
  );
}

const count = async (d: Db, table: string) =>
  (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

let shape003: Awaited<ReturnType<typeof schemaShape>>;

beforeAll(async () => {
  admin = createPool(baseUrl);
  await admin.query(`CREATE DATABASE ${dbName}`);
  db = createPool(tempUrl);
  const legacyDir = mkdtempSync(path.join(tmpdir(), 'kyc-mig-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x < '004'))
    cpSync(path.join(MIGRATIONS, f), path.join(legacyDir, f));
  expect(await migrate(db, legacyDir)).toEqual([
    '001_init.sql',
    '002_edge_references.sql',
    '003_fk_indexes.sql',
  ]);
  shape003 = await schemaShape(db);
  await seedLegacy(db);
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

describe('Phase 1 migrations on existing data', () => {
  it('apply cleanly on top of 003 and preserve every row', async () => {
    const before: Record<string, number> = {};
    for (const t of [
      'owners',
      'repositories',
      'snapshots',
      'files',
      'symbols',
      'edges',
      'jobs',
      'explanations',
      'messages',
      'check_attempts',
      'events',
      'llm_calls',
    ])
      before[t] = await count(db, t);
    expect(await migrate(db)).toEqual(PHASE1);

    expect(await count(db, 'users')).toBe(before.owners);
    for (const t of [
      'repositories',
      'snapshots',
      'files',
      'symbols',
      'edges',
      'jobs',
      'explanations',
      'messages',
      'check_attempts',
      'events',
      'llm_calls',
    ])
      expect(await count(db, t), t).toBe(before[t]);
  });

  it('turn owners into anonymous users with the same ids', async () => {
    const users = (await db.query('SELECT id, kind, email FROM users ORDER BY id')).rows;
    expect(users.map((u) => u.id).sort()).toEqual([ids.owner, ids.idle].sort());
    expect(users.every((u) => u.kind === 'anonymous' && u.email === null)).toBe(true);
  });

  it('give legacy analysis a run record, with legacy rows unkeyed rather than guessed', async () => {
    const runs = (
      await db.query(
        'SELECT snapshot_id, status, analyser_version, symbol_key_version, outcome, symbol_count, edge_count FROM analysis_runs',
      )
    ).rows;
    expect(runs).toEqual([
      {
        snapshot_id: ids.snap,
        status: 'succeeded',
        analyser_version: 'legacy',
        symbol_key_version: 0,
        outcome: 'ready',
        symbol_count: 2,
        edge_count: 1,
      },
    ]);
    const run = (await db.query('SELECT id FROM analysis_runs')).rows[0].id;
    expect(
      (await db.query('SELECT current_analysis_run_id FROM snapshots')).rows[0].current_analysis_run_id,
    ).toBe(run);
    expect((await db.query('SELECT DISTINCT analysis_run_id, symbol_key FROM symbols')).rows).toEqual([
      { analysis_run_id: run, symbol_key: null },
    ]);
    expect((await db.query('SELECT DISTINCT analysis_run_id FROM edges')).rows).toEqual([
      { analysis_run_id: run },
    ]);
    expect((await db.query('SELECT snapshot_id FROM jobs')).rows).toEqual([{ snapshot_id: ids.snap }]);
  });

  it('anchor explanations to their repository and commit, and type every feedback target', async () => {
    expect(
      (await db.query('SELECT repository_id, commit_sha, snapshot_id, symbol_id FROM explanations')).rows,
    ).toEqual([{ repository_id: ids.repo, commit_sha: SHA, snapshot_id: ids.snap, symbol_id: ids.fn }]);
    expect((await db.query('SELECT id, explanation_id, target_id FROM feedback')).rows).toEqual([
      { id: ids.fb, explanation_id: ids.expl, target_id: ids.expl },
    ]);
    // The orphan was archived, not destroyed.
    expect((await db.query('SELECT id, comment FROM feedback_orphans')).rows).toEqual([
      { id: ids.orphanFb, comment: 'kept' },
    ]);
  });

  it('serve the migrated data through the application, and let a legacy owner register in place', async () => {
    const config = testConfig({ DATABASE_URL: tempUrl });
    const app = await buildApp({ config, db, overrides: { llm: new FakeLlm() } });
    try {
      const cookie = `kyc_owner=${app.signCookie(ids.owner)}`;
      const mine = await app.inject({ url: '/api/v1/my/snapshots', headers: { cookie } });
      expect(mine.json().snapshots.map((s: { snapshotId: string }) => s.snapshotId)).toEqual([ids.snap]);
      expect(
        (await app.inject({ url: `/api/v1/snapshots/${ids.snap}/tree`, headers: { cookie } })).statusCode,
      ).toBe(200);
      const ex = await app.inject({ url: `/api/v1/explanations/${ids.expl}`, headers: { cookie } });
      expect(ex.json()).toMatchObject({ id: ids.expl, snapshotId: ids.snap });
      // Someone else still cannot read it.
      expect((await app.inject({ url: `/api/v1/snapshots/${ids.snap}/tree` })).statusCode).toBe(404);

      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { cookie },
        payload: { email: 'legacy@example.com', password: 'correct horse battery' },
      });
      expect(reg.statusCode).toBe(201);
      expect(reg.json().user.id).toBe(ids.owner);
    } finally {
      await app.close();
    }
  });

  it('roll back in reverse order to exactly the pre-Phase-1 schema, keeping the data, and migrate forward again', async () => {
    const down = (name: string) =>
      db.query(readFileSync(path.join(ROLLBACKS, name.replace('.sql', '.down.sql')), 'utf8')).then(
        () => 'ok',
        (e: Error) => e.message,
      );
    const order = [...PHASE1].reverse();
    expect(order).toEqual([
      '008_snapshot_shares.sql',
      '007_learning_layer.sql',
      '006_analysis_runs_symbol_keys.sql',
      '005_users_and_sessions.sql',
      '004_job_integrity.sql',
    ]);
    for (const name of order) {
      if (name === '005_users_and_sessions.sql') {
        // Guard: rolling back would erase account credentials, so it refuses while accounts exist...
        expect(await down(name)).toMatch(/registered accounts exist/);
        // ...until an operator deliberately downgrades them (documented in the rollback script).
        await db.query(
          `UPDATE users SET kind='anonymous', email=NULL, password_hash=NULL, registered_at=NULL`,
        );
      }
      expect(await down(name), name).toBe('ok');
    }

    expect(await schemaShape(db)).toEqual(shape003);
    expect(
      (await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name),
    ).toEqual(['001_init.sql', '002_edge_references.sql', '003_fk_indexes.sql']);
    for (const [t, n] of [
      ['owners', 2],
      ['repositories', 1],
      ['snapshots', 1],
      ['symbols', 2],
      ['explanations', 1],
      ['messages', 1],
      ['check_attempts', 1],
      ['feedback', 2], // the archived orphan is back
    ] as const)
      expect(await count(db, t), t).toBe(n);

    // The cycle is repeatable: the same migrations apply again on the rolled-back database.
    expect(await migrate(db)).toEqual(PHASE1);
    expect(await count(db, 'users')).toBe(2);
  });
});
