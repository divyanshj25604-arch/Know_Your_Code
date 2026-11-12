import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { FakeLlm } from '../src/ai/fake';
import { buildApp } from '../src/app';
import { ConfigError } from '../src/config/env';
import { createPool } from '../src/db/pool';
import { migrate, migrationProblems } from '../src/db/migrate';
import { InstanceLock } from '../src/ops/instanceLock';
import { isDbConnectionError, waitForDatabase } from '../src/ops/database';
import { Monitor, scrub } from '../src/ops/monitor';
import { Device } from './device';
import { Harness } from './harness';
import { testConfig, testDb } from './helpers';

/** P4.2 operations: single-instance guard, error reports and 5xx alerting, database failure handling, migrations. */
const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;

/** An app whose log lines are captured as parsed JSON. */
async function loggedApp(env: Record<string, string> = {}) {
  const lines: Record<string, unknown>[] = [];
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(l));
      cb();
    },
  });
  const app = await buildApp({
    config: testConfig({ LOG_LEVEL: 'info', ALERT_5XX_THRESHOLD: '3', ...env }),
    db: h.db,
    overrides: { llm: new FakeLlm(), logStream },
  });
  return { app, lines };
}

describe('single-instance guard (P4.2)', () => {
  it('only one process holds the worker lock; another takes over when it is released', async () => {
    const dbA = testDb();
    const dbB = testDb();
    const a = new InstanceLock(dbA, silent);
    const b = new InstanceLock(dbB, silent, { pollMs: 20 });
    try {
      expect(await a.tryAcquire()).toBe(true);
      expect(await b.tryAcquire()).toBe(false);
      let took = false;
      b.start(() => {
        took = true;
      });
      await new Promise((r) => setTimeout(r, 80));
      expect(took).toBe(false);
      await a.stop();
      await expect.poll(() => took, { timeout: 2000 }).toBe(true);
      expect(b.held).toBe(true);
    } finally {
      await a.stop();
      await b.stop();
      await dbA.end();
      await dbB.end();
    }
  });

  it('a standby instance accepts imports but runs them only once it is the worker', async () => {
    const runner = h.app.services.runner;
    runner.pause();
    const d = new Device(() => h.app);
    const res = await d.post('/api/v1/repositories', { url: 'https://github.com/acme/notes-api' });
    expect(res.statusCode).toBe(202);
    const { snapshotId } = res.json();
    expect((await d.get('/api/v1/health')).json().jobs).toBe('standby');
    await new Promise((r) => setTimeout(r, 100));
    expect((await d.get(`/api/v1/snapshots/${snapshotId}`)).json().status).toBe('queued');
    runner.resume();
    await runner.idle();
    expect((await d.get(`/api/v1/snapshots/${snapshotId}`)).json().status).toBe('ready');
    expect((await d.get('/api/v1/health')).json().jobs).toBe('active');
  });
});

describe('error reports and alerts (P4.2)', () => {
  it('scrubs secrets, emails and row values from error messages', () => {
    const s = scrub(
      `boom Bearer kyc_st_${'a'.repeat(43)} for ada@example.com at postgres://u:pw@db/x Key (email)=(ada@example.com) gsk_abcdefghijk`,
    );
    expect(s).not.toMatch(/kyc_st_a|ada@|pw@|gsk_abc/);
    expect(s).toContain('[email]');
    expect(scrub('x'.repeat(500)).length).toBeLessThanOrEqual(301);
  });

  it('alerts once per window when 5xx responses cross the threshold, with a webhook message', async () => {
    let t = 0;
    const posts: unknown[] = [];
    const m = new Monitor(
      {
        windowMs: 60_000,
        serverErrorThreshold: 3,
        jobFailureThreshold: 2,
        webhookUrl: 'https://hooks.example.com/x',
        environment: 'staging',
        version: '9',
      },
      silent,
      async (_u, b) => void posts.push(b),
      () => t,
    );
    m.recordResponse(200);
    m.recordResponse(500);
    m.recordResponse(503);
    expect(m.sent).toEqual([]);
    m.recordResponse(500);
    m.recordResponse(500); // still inside the quiet period
    expect(m.sent).toEqual([{ kind: 'sustained_5xx', count: 3 }]);
    await Promise.resolve();
    expect(posts[0]).toMatchObject({ alert: 'sustained_5xx', count: 3 });
    expect((posts[0] as { text: string }).text).toMatch(/\[Know Your Code staging\] 3 server errors/);
    // Errors spread out over time never alert.
    t = 10 * 60_000;
    m.recordResponse(500);
    t += 61_000;
    m.recordResponse(500);
    expect(m.sent).toHaveLength(1);
    // Job failures alert on their own threshold.
    m.reportJobFailure(new Error('x'), { snapshotId: 's1' });
    m.reportJobFailure(new Error('y'), { snapshotId: 's2' });
    expect(m.sent.at(-1)).toEqual({ kind: 'job_failures', count: 2 });
  });

  it('an unhandled route error becomes a fingerprinted error report and a generic 500; sustained ones alert', async () => {
    const { app, lines } = await loggedApp();
    app.get('/api/v1/__boom', async () => {
      throw new Error(`exploded for ada@example.com with kyc_st_${'b'.repeat(43)}`);
    });
    try {
      for (let i = 0; i < 3; i++) {
        const r = await app.inject({ method: 'GET', url: '/api/v1/__boom' });
        expect(r.statusCode).toBe(500);
        expect(r.body).not.toMatch(/exploded|ada@|kyc_st_/);
      }
      const reports = lines.filter((l) => l.event === 'error_report');
      expect(reports).toHaveLength(3);
      expect(new Set(reports.map((r) => r.fingerprint)).size).toBe(1);
      expect(reports[0]).toMatchObject({ where: 'GET /api/v1/__boom', route: '/api/v1/__boom' });
      const all = JSON.stringify(lines);
      expect(all).not.toMatch(/ada@example\.com|kyc_st_b/);
      expect(lines.filter((l) => l.event === 'alert')).toEqual([
        expect.objectContaining({ alert: 'sustained_5xx', count: 3 }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('a database outage during a request is a retryable 503 without internals', async () => {
    const { app, lines } = await loggedApp();
    app.get('/api/v1/__dbdown', async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
    });
    try {
      const r = await app.inject({ method: 'GET', url: '/api/v1/__dbdown' });
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
      expect(r.body).not.toMatch(/10\.0\.0\.5|ECONNREFUSED/);
      expect(lines.find((l) => l.event === 'database_unavailable')).toMatchObject({
        reason: 'database unreachable (ECONNREFUSED)',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects a non-https alert webhook', () => {
    expect(() => testConfig({ ALERT_WEBHOOK_URL: 'http://hooks.example.com/x' })).toThrow(ConfigError);
    expect(testConfig({ ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' }).ALERT_WEBHOOK_URL).toBe(
      'https://hooks.example.com/x',
    );
  });
});

describe('database reliability (P4.2)', () => {
  it('recognises connection failures', () => {
    expect(isDbConnectionError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isDbConnectionError({ code: '57P01' })).toBe(true);
    expect(isDbConnectionError({ code: '08006' })).toBe(true);
    expect(isDbConnectionError({ message: 'Connection terminated unexpectedly' })).toBe(true);
    expect(isDbConnectionError({ code: '23505' })).toBe(false);
  });

  it('gives up waiting for an unreachable database with a reason that hides the connection string', async () => {
    const db = createPool('postgres://kyc:secret-pw@127.0.0.1:1/nowhere');
    const retries: string[] = [];
    try {
      const reason = await waitForDatabase(db, {
        attempts: 2,
        delayMs: 10,
        onRetry: (_n, r) => retries.push(r),
      });
      expect(reason).toBe('database unreachable (ECONNREFUSED)');
      expect(retries).toHaveLength(1);
      expect(`${reason}${retries.join('')}`).not.toMatch(/secret-pw|127\.0\.0\.1/);
    } finally {
      await db.end();
    }
    expect(await waitForDatabase(h.db, { attempts: 1 })).toBeNull();
  });

  it('migration safety: well-formed, uniquely numbered files; refuses a database newer than the build', async () => {
    expect(migrationProblems(['001_a.sql', '002_b.sql'], ['001_a.sql'])).toEqual([]);
    expect(migrationProblems(['001_a.sql', '001_b.sql', 'x.sql'], [])).toEqual([
      'two migrations share number 001: 001_a.sql and 001_b.sql',
      'badly named migration file: x.sql',
    ]);
    await h.db.query(`INSERT INTO schema_migrations (name) VALUES ('999_from_the_future.sql')`);
    try {
      await expect(migrate(h.db)).rejects.toThrow(/does not include \(999_from_the_future\.sql\)/);
    } finally {
      await h.db.query(`DELETE FROM schema_migrations WHERE name = '999_from_the_future.sql'`);
    }
    expect(await migrate(h.db)).toEqual([]);
  });
});
