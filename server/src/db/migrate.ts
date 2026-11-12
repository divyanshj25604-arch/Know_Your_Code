import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Forward-only SQL migrations applied in filename order; each runs once inside a transaction. */
function defaultDir(): string {
  // Source tree: src/db/migrations. Bundled build: dist/db/migrations (copied by tsup).
  const candidates = [path.join(here, 'migrations'), path.join(here, 'db', 'migrations')];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

/** Migration file names: three-digit order, a name, `.sql`. */
const NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

/**
 * Safety checks before anything is applied (P4.2): file names are well formed and uniquely numbered, and the
 * database has no migration this build does not know (that means an older build is being deployed over a newer
 * schema; roll the schema back with the operator scripts first, or deploy the newer build).
 */
export function migrationProblems(files: string[], applied: Iterable<string>): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const f of files) {
    if (!NAME.test(f)) problems.push(`badly named migration file: ${f}`);
    const n = f.slice(0, 3);
    if (seen.has(n)) problems.push(`two migrations share number ${n}: ${seen.get(n)} and ${f}`);
    seen.set(n, f);
  }
  const known = new Set(files);
  const unknown = [...applied].filter((a) => !known.has(a)).sort();
  if (unknown.length)
    problems.push(
      `the database has migrations this build does not include (${unknown.join(', ')}); deploy a build that includes them, or roll the database back first`,
    );
  return problems;
}

/** Lock wait limit for one migration: never queue behind live traffic indefinitely. */
const MIGRATION_LOCK_TIMEOUT = '15s';

export async function migrate(db: Db, dir = defaultDir()): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const problems = migrationProblems(files, done);
    if (problems.length) throw new Error(`Migrations refused:\n  - ${problems.join('\n  - ')}`);
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`, { cause: e });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }
  return applied;
}
