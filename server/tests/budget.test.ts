import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiUsageView } from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { FakeLlm } from '../src/ai/fake';
import { releaseBudget, reserveBudget, worstCaseUsd } from '../src/ai/cost';
import { ConfigError, loadConfig } from '../src/config/env';
import { Device } from './device';
import { Harness } from './harness';
import { testConfig } from './helpers';

/** P4.3 budget controls: global cap, per-user cap, per-user request limit, all safe under concurrency. */
const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const codeOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' ? (r.reason as KycError).code : 'ok';

async function newUser() {
  const id = randomUUID();
  await h.db.query(`INSERT INTO users (id, kind) VALUES ($1, 'anonymous')`, [id]);
  return id;
}

describe('AI budget reservations (P4.3)', () => {
  it('concurrent calls cannot overspend the global cap', async () => {
    const config = testConfig({ DAILY_SPEND_CAP_USD: '0.35', AI_USER_DAILY_BUDGET_USD: '100' });
    const users = await Promise.all(Array.from({ length: 20 }, newUser));
    const results = await Promise.allSettled(
      users.map((userId) =>
        reserveBudget(h.db, config, { userId, capability: 'explain_selection', usd: 0.1 }),
      ),
    );
    expect(results.map(codeOf).filter((c) => c === 'ok')).toHaveLength(3);
    expect(results.map(codeOf).filter((c) => c === 'BUDGET_EXCEEDED')).toHaveLength(17);
    const open = await h.db.query<{ s: string }>('SELECT sum(reserved_usd)::text AS s FROM ai_reservations');
    expect(Number(open.rows[0]!.s)).toBeCloseTo(0.3, 6);
  });

  it('one user cannot exhaust the global cap: their share runs out first and others keep working', async () => {
    const config = testConfig({ DAILY_SPEND_CAP_USD: '1', AI_USER_DAILY_BUDGET_USD: '0.25' });
    const [greedy, other] = [await newUser(), await newUser()];
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserveBudget(h.db, config, { userId: greedy!, capability: 'follow_up', usd: 0.1 }),
      ),
    );
    expect(results.map(codeOf).filter((c) => c === 'ok')).toHaveLength(2);
    expect(results.map(codeOf).filter((c) => c === 'USER_BUDGET_EXCEEDED')).toHaveLength(8);
    await expect(
      reserveBudget(h.db, config, { userId: other!, capability: 'follow_up', usd: 0.1 }),
    ).resolves.toBeGreaterThan(0);
  });

  it('logged spend counts, cached answers do not, and released or expired reservations stop counting', async () => {
    const config = testConfig({ DAILY_SPEND_CAP_USD: '1', AI_USER_DAILY_BUDGET_USD: '0.5' });
    const u = await newUser();
    await h.db.query(
      `INSERT INTO llm_calls (owner_id, task, model, prompt_version, cost_usd, status, cache_hit)
       VALUES ($1,'explain','m','p',0.35,'ok',false), ($1,'explain','m','p',0,'ok',true)`,
      [u],
    );
    const id = await reserveBudget(h.db, config, { userId: u, capability: 'assess', usd: 0.1 });
    await expect(
      reserveBudget(h.db, config, { userId: u, capability: 'assess', usd: 0.1 }),
    ).rejects.toMatchObject({
      code: 'USER_BUDGET_EXCEEDED',
    });
    await releaseBudget(h.db, id);
    const id2 = await reserveBudget(h.db, config, { userId: u, capability: 'assess', usd: 0.1 });
    // A crashed request's reservation expires and stops counting.
    await h.db.query(`UPDATE ai_reservations SET expires_at = now() - interval '1 second' WHERE id=$1`, [
      id2,
    ]);
    await expect(
      reserveBudget(h.db, config, { userId: u, capability: 'assess', usd: 0.1 }),
    ).resolves.toBeGreaterThan(0);
  });

  it('limits each user to AI_USER_DAILY_REQUESTS model calls per day', async () => {
    const config = testConfig({ AI_USER_DAILY_REQUESTS: '2' });
    const u = await newUser();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reserveBudget(h.db, config, { userId: u, capability: 'grade', usd: 0 }),
      ),
    );
    expect(results.map(codeOf).sort()).toEqual([
      'USER_BUDGET_EXCEEDED',
      'USER_BUDGET_EXCEEDED',
      'USER_BUDGET_EXCEEDED',
      'ok',
      'ok',
    ]);
    const err = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((err.reason as KycError).message).toMatch(/limit of AI requests/);
  });

  it('a worst-case estimate covers the whole output allowance and a generous prompt token count', () => {
    const config = testConfig({
      MODEL_STRONG_INPUT_USD_PER_MTOK: '3',
      MODEL_STRONG_OUTPUT_USD_PER_MTOK: '15',
    });
    // 30 000 characters -> 10 000 tokens at 3 $/Mtok, plus 4 096 output tokens at 15 $/Mtok.
    expect(worstCaseUsd(config, 'strong', 30_000, 4096)).toBeCloseTo(0.03 + 0.06144, 8);
  });

  it('production refuses a per-user budget that could exhaust the global cap', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x/y',
      COOKIE_SECRET: 'a-production-cookie-secret',
      LLM_PROVIDER: 'fake',
    };
    expect(() =>
      loadConfig({ ...base, DAILY_SPEND_CAP_USD: '5', AI_USER_DAILY_BUDGET_USD: '5' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...base, DAILY_SPEND_CAP_USD: '5', AI_USER_DAILY_BUDGET_USD: '0.5' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

describe('budget through the API (P4.3)', () => {
  const sel = {
    path: 'src/controllers/authController.js',
    startLine: 4,
    startCol: 15,
    endLine: 4,
    endCol: 52,
  };

  it('records usage per user and capability, releases every reservation, and reports it to the user only', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const r = await d.sse('/api/v1/explanations', { snapshotId, selection: sel });
    expect(r.events.at(-1)!.event).toBe('done');
    expect((await h.db.query('SELECT 1 FROM ai_reservations')).rowCount).toBe(0);
    const caps = await h.db.query<{ capability: string }>(
      'SELECT DISTINCT capability FROM llm_calls ORDER BY 1',
    );
    expect(caps.rows.map((x) => x.capability)).toEqual(['explain_selection', 'summarise_project']);

    const usage = (await d.get('/api/v1/ai/usage')).json() as AiUsageView;
    expect(usage.budgetUsd).toBe(0.5);
    expect(usage.requestLimit).toBe(300);
    expect(usage.requests).toBe(2);
    expect(usage.byCapability.map((c) => c.capability)).toEqual(['explain_selection', 'summarise_project']);
    expect(usage.byCapability.every((c) => c.inputTokens > 0 && c.outputTokens > 0)).toBe(true);
    // Another user sees only their own (empty) usage.
    const stranger = new Device(() => h.app);
    await stranger.importRepo('acme/notes-api');
    const theirs = (await stranger.get('/api/v1/ai/usage')).json() as AiUsageView;
    expect(theirs.byCapability.map((c) => c.capability)).toEqual(['summarise_project']);
    // No identity, no usage.
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/ai/usage' })).statusCode).toBe(401);
  });

  it('a user over their allowance gets a clear error while relations still stream, and other users are unaffected', async () => {
    await h.close();
    await h.reset({
      llm: new FakeLlm(),
      repos: { 'acme/notes-api': { fixture: 'express-cjs' } },
      env: { AI_USER_DAILY_REQUESTS: '1' },
    });
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api'); // the project summary uses the one request
    const r = await d.sse('/api/v1/explanations', { snapshotId, selection: sel });
    expect(r.events.map((e) => e.event)).toEqual(['relations', 'error']);
    expect(r.events[1]!.data).toMatchObject({ code: 'USER_BUDGET_EXCEEDED', retryable: false });

    const other = new Device(() => h.app);
    const o = await other.importRepo('acme/notes-api');
    const ov = (await other.get(`/api/v1/snapshots/${o.snapshotId}/overview`)).json();
    expect(ov.summary.status).toBe('ready');
  });
});
