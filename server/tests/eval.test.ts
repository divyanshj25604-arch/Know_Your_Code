import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPABILITY_IDS } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import { EVAL_CASES, type EvalCase } from '../eval/cases';
import { liveGate } from '../eval/cli';
import { runEval } from '../eval/runner';
import {
  PROPOSED_THRESHOLDS,
  buildReport,
  compareReports,
  renderMarkdown,
  scoreCase,
  type CaseOutput,
  type EvalReport,
} from '../eval/score';
import { testDb } from './helpers';

/** P4.3 evaluation harness: dataset coverage, scoring rules, the live gate, and a full run on the test provider. */
const CASE: EvalCase = {
  id: 't',
  capability: 'explain_selection',
  repo: 'acme/notes-api',
  request: { kind: 'explain', path: 'a.js', startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
  expect: {
    mustCite: [{ path: 'a.js', from: 3, to: 5 }],
    mustMention: ['findUser'],
    mustNotMention: ['bcrypt'],
  },
};
const call = (over = {}) => ({
  capability: null,
  inputTokens: 100,
  outputTokens: 50,
  totalMs: 20,
  firstTokenMs: 5,
  stopReason: 'end_turn',
  refused: false,
  jsonMissing: false,
  error: null,
  ...over,
});
const good = (): CaseOutput => ({
  envelope: {
    payload: { sections: { what: { text: 'Calls findUser.', refs: [{ path: 'a.js', line: 4 }] } } },
    claims: [],
    refsStripped: 0,
    refsTotal: 1,
    claimsDowngraded: 0,
    degraded: false,
  },
  error: null,
  calls: [call()],
  ledgerStatuses: ['ok'],
});

describe('evaluation scoring (P4.3)', () => {
  it('passes a grounded, complete answer and counts its tokens and latency', () => {
    const r = scoreCase(CASE, good());
    expect(r).toMatchObject({ pass: true, failures: [] });
    expect(r.metrics).toMatchObject({
      calls: 1,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 20,
      missingCites: 0,
    });
  });

  it('categorises each kind of failure', () => {
    const o = good();
    o.envelope!.payload = {
      sections: { what: { text: 'Uses bcrypt to hash.', refs: [{ path: 'a.js', line: 9 }] } },
    };
    o.envelope!.refsStripped = 1;
    o.envelope!.refsTotal = 2;
    o.envelope!.claimsDowngraded = 1;
    o.envelope!.degraded = true;
    o.calls = [call({ stopReason: 'max_tokens' }), call({ refused: true, jsonMissing: true })];
    o.ledgerStatuses = ['invalid:empty or non-JSON output', 'refusal'];
    const r = scoreCase(CASE, o);
    expect(r.pass).toBe(false);
    expect(r.failures.sort()).toEqual(
      [
        'fallback_used',
        'invalid_citation',
        'missing_citation',
        'missing_content',
        'refusal',
        'schema_invalid',
        'truncated',
        'unsupported_claim',
      ].sort(),
    );
    expect(r.details).toContain('unsupported claim: mentions "bcrypt", which is not in the code');
    expect(r.details).toContain('missing citation: a.js:3-5');
  });

  it('treats a request error and an empty answer as failures', () => {
    expect(
      scoreCase(CASE, { envelope: null, error: 'AI_TIMEOUT', calls: [], ledgerStatuses: [] }).failures,
    ).toEqual(['error']);
    const o = good();
    o.envelope!.payload = { sections: { what: { text: ' ', refs: [{ path: 'a.js', line: 4 }] } } };
    expect(scoreCase({ ...CASE, expect: { ...CASE.expect, mustMention: [] } }, o).failures).toEqual([
      'incomplete_output',
    ]);
  });

  it('computes rates over stated denominators and flags regressions', () => {
    const pass = scoreCase(CASE, good());
    const bad = scoreCase(CASE, { ...good(), error: 'AI_ERROR', envelope: null });
    const meta = { startedAt: 'x', provider: 'fake', models: { fast: 'f', strong: 's' }, realModel: false };
    const before = buildReport(meta, [pass]);
    const after = buildReport(meta, [{ ...bad, id: pass.id }]);
    expect(before.overall).toMatchObject({ cases: 1, passed: 1, passRate: 1, missingCitationRate: 0 });
    expect(compareReports(before, after)).toEqual([
      { scope: 'explain_selection', metric: 'passRate', baseline: 1, current: 0 },
      { scope: 't', metric: 'case', baseline: 1, current: 0 },
    ]);
    expect(after.thresholds.find((t) => t.scope === 'explain_selection')).toMatchObject({ ok: false });
    expect(PROPOSED_THRESHOLDS.passRate.min).toBe(0.9);
  });
});

describe('live evaluation gate (P4.3)', () => {
  it('refuses a real-model run until P0.2 approval, a budget and a key are all present', () => {
    expect(liveGate('fake', {})).toBeNull();
    const none = liveGate('anthropic', {})!;
    expect(none).toMatch(/KYC_LIVE_EVAL_APPROVED=yes/);
    expect(none).toMatch(/KYC_EVAL_BUDGET_USD/);
    expect(none).toMatch(/ANTHROPIC_API_KEY is not set/);
    expect(liveGate('anthropic', { KYC_LIVE_EVAL_APPROVED: 'yes', KYC_EVAL_BUDGET_USD: '0' })).toMatch(
      /BUDGET/,
    );
    expect(
      liveGate('anthropic', {
        KYC_LIVE_EVAL_APPROVED: 'yes',
        KYC_EVAL_BUDGET_USD: '2',
        ANTHROPIC_API_KEY: 'k',
      }),
    ).toBeNull();
  });
});

describe('evaluation run on the test provider (P4.3)', () => {
  it('refuses to run on a database that is not a test or eval database (it empties it)', async () => {
    await expect(
      runEval({
        db: null as never,
        databaseUrl: 'postgres://localhost/kyc_production',
        llm: new FakeLlm(),
        provider: 'fake',
        budgetUsd: 1,
      }),
    ).rejects.toThrow(/refusing to run the evaluation on database "kyc_production"/);
  });

  it('has cases for all seven capabilities', () => {
    expect([...new Set(EVAL_CASES.map((c) => c.capability))].sort()).toEqual([...CAPABILITY_IDS].sort());
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it('runs every case through the real API, reports it, and matches the committed baseline', async () => {
    const db = testDb();
    try {
      const report = await runEval({
        db,
        databaseUrl: process.env.TEST_DATABASE_URL ?? 'postgres://localhost/kyc_test',
        llm: new FakeLlm(),
        provider: 'fake',
        budgetUsd: 100,
      });
      expect(report.realModel).toBe(false);
      expect(Object.keys(report.byCapability).sort()).toEqual([...CAPABILITY_IDS].sort());
      expect(report.cases.every((c) => c.metrics.calls > 0)).toBe(true);
      expect(report.overall.schemaFailureRate).toBe(0);
      expect(report.overall.unsupportedClaimRate).toBe(0);
      // Every reservation was released.
      expect((await db.query('SELECT 1 FROM ai_reservations')).rowCount).toBe(0);
      const baseline = JSON.parse(
        readFileSync(new URL('../eval/baselines/fake.json', import.meta.url), 'utf8'),
      ) as EvalReport;
      expect(compareReports(baseline, report)).toEqual([]);
      expect(report.cases.map((c) => [c.id, c.pass])).toEqual(baseline.cases.map((c) => [c.id, c.pass]));
      const md = renderMarkdown(report, []);
      expect(md).toMatch(/not\*\* evidence of real-model accuracy/);
      expect(md).toMatch(/Proposed thresholds \(not yet validated on a real model; P0.2 pending\)/);
    } finally {
      await db.end();
    }
  });
});
