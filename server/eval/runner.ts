import type { FastifyInstance } from 'fastify';
import type { Claim } from '@kyc/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import type { Db } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import type { RunObserver, RunResult } from '../src/ai/executor';
import type { LlmCall, LlmClient, LlmOutput } from '../src/ai/llm';
import { Device } from '../tests/device';
import { fixtureTarball, startFakeGitHub } from '../tests/fake-github';
import { EVAL_CASES, type EvalCase } from './cases';
import { buildReport, scoreCase, type CallRecord, type CaseOutput, type EvalReport } from './score';

/**
 * Runs the evaluation dataset through the real application (P4.3): real HTTP routes, retrieval, prompts, schema
 * validation, reference verification and persistence, with the given model provider. Repository downloads come from a
 * local stand-in serving the fixture repositories; nothing is fetched from GitHub.
 *
 * The provider decides what the numbers mean: with the fake provider the run exercises the pipeline and the harness
 * only; real-model numbers come only from a gated live run (eval/cli.ts).
 */
export interface RunEvalOptions {
  db: Db;
  databaseUrl: string;
  llm: LlmClient;
  provider: string;
  /** Hard spending limit for the whole run, enforced by the budget reservations (P4.3). */
  budgetUsd: number;
  env?: Record<string, string>;
  cases?: EvalCase[];
  log?: (line: string) => void;
}

/** Wraps the provider and records every call: tokens, latency, stop reason, refusals, JSON validity. */
class RecordingLlm implements LlmClient {
  readonly records: CallRecord[] = [];
  readonly kind: LlmClient['kind'];
  stream?: (call: LlmCall, onText: (d: string) => void) => Promise<LlmOutput>;

  constructor(private readonly inner: LlmClient) {
    this.kind = inner.kind;
    if (inner.stream) {
      const s = inner.stream.bind(inner);
      this.stream = (call, onText) => this.track(() => s(call, onText));
    }
  }

  complete(call: LlmCall): Promise<LlmOutput> {
    return this.track(() => this.inner.complete(call));
  }

  private async track(fn: () => Promise<LlmOutput>): Promise<LlmOutput> {
    const started = performance.now();
    try {
      const out = await fn();
      this.records.push({
        capability: null,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        totalMs: out.totalMs,
        firstTokenMs: out.firstTokenMs ?? null,
        stopReason: out.stopReason,
        refused: out.refused,
        jsonMissing: out.json === null || out.json === undefined,
        error: null,
      });
      return out;
    } catch (e) {
      this.records.push({
        capability: null,
        inputTokens: 0,
        outputTokens: 0,
        totalMs: Math.round(performance.now() - started),
        firstTokenMs: null,
        stopReason: null,
        refused: false,
        jsonMissing: true,
        error: (e as { code?: string }).code ?? 'error',
      });
      throw e;
    }
  }
}

type Envelope = NonNullable<CaseOutput['envelope']>;
const toEnvelope = (r: RunResult<unknown>): Envelope => ({
  payload: r.payload,
  claims: r.claims as Claim[],
  refsStripped: r.refsStripped,
  refsTotal: r.refsTotal,
  claimsDowngraded: r.claimsDowngraded,
  degraded: r.degraded,
});

const errorCode = (res: { statusCode: number; json: () => unknown }) => {
  try {
    return (res.json() as { error?: { code?: string } }).error?.code ?? `HTTP_${res.statusCode}`;
  } catch {
    return `HTTP_${res.statusCode}`;
  }
};

export async function runEval(o: RunEvalOptions): Promise<EvalReport> {
  const log = o.log ?? (() => undefined);
  const cases = o.cases ?? EVAL_CASES;
  const startedAt = new Date().toISOString();
  // The run empties its database first: never let it touch one that is not explicitly a test or eval database.
  const dbName = new URL(o.databaseUrl).pathname.slice(1);
  if (!/(^|_)(test|eval)(_|$)/.test(dbName))
    throw new Error(
      `refusing to run the evaluation on database "${dbName}": its name must contain _test or _eval`,
    );
  await migrate(o.db);
  await o.db.query('TRUNCATE users, deletion_log, events, llm_calls, ai_reservations CASCADE');

  const gh = await startFakeGitHub();
  gh.add('acme', 'notes-api', await fixtureTarball('express-cjs'));
  gh.add('acme', 'shop', await fixtureTarball('react-ts'));

  const llm = new RecordingLlm(o.llm);
  const envelopes: { capability: string; snapshotId: string | null; env: Envelope }[] = [];
  const observer: RunObserver = (r, ctx) =>
    envelopes.push({ capability: r.capability, snapshotId: ctx.snapshotId, env: toEnvelope(r) });

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: o.databaseUrl,
    LOG_LEVEL: 'silent',
    LLM_PROVIDER: o.provider === 'fake' ? 'fake' : o.provider,
    RATE_LIMIT_DISABLED: 'true',
    STATIC_DIR: '/nonexistent',
    GITHUB_CODELOAD_BASE: gh.base,
    DAILY_SPEND_CAP_USD: String(o.budgetUsd),
    AI_USER_DAILY_BUDGET_USD: String(o.budgetUsd),
    AI_USER_DAILY_REQUESTS: '10000',
    ...(o.env ?? {}),
  } as NodeJS.ProcessEnv);
  const app: FastifyInstance = await buildApp({ config, db: o.db, overrides: { llm, aiObserver: observer } });

  let lastLedgerId = 0;
  const window = async <T>(fn: () => Promise<T>) => {
    const c0 = llm.records.length;
    const e0 = envelopes.length;
    const value = await fn();
    const rows = await o.db.query<{ id: string; status: string }>(
      'SELECT id, status FROM llm_calls WHERE id > $1 AND NOT cache_hit ORDER BY id',
      [lastLedgerId],
    );
    if (rows.rows.length) lastLedgerId = Number(rows.rows.at(-1)!.id);
    return {
      value,
      calls: llm.records.slice(c0),
      envelopes: envelopes.slice(e0),
      statuses: rows.rows.map((r) => r.status),
    };
  };

  try {
    const d = new Device(() => app);
    const imports: Record<string, { snapshotId: string; summary: Awaited<ReturnType<typeof window>> }> = {};
    for (const repo of ['acme/notes-api', 'acme/shop'] as const) {
      const w = await window(() => d.importRepo(repo));
      imports[repo] = { snapshotId: w.value.snapshotId, summary: w };
      log(`imported ${repo}`);
    }

    const explain = async (snapshotId: string, sel: Record<string, unknown>) => {
      const { kind: _k, ...selection } = sel;
      void _k;
      const r = await d.sse('/api/v1/explanations', { snapshotId, selection });
      const done = r.events.find((e) => e.event === 'done');
      const err = r.events.find((e) => e.event === 'error');
      return {
        explanationId: (done?.data as { explanationId?: string } | undefined)?.explanationId ?? null,
        error: err
          ? String((err.data as { code?: string }).code)
          : r.status >= 400
            ? `HTTP_${r.status}`
            : null,
      };
    };

    const results = [];
    for (const c of cases) {
      const { snapshotId, summary } = imports[c.repo]!;
      let out: CaseOutput;
      const req = c.request;
      if (req.kind === 'summary') {
        const env = summary.envelopes.filter((e) => e.capability === c.capability).at(-1);
        const ov = (await d.get(`/api/v1/snapshots/${snapshotId}/overview`)).json() as {
          summary: { status: string };
        };
        out = {
          envelope: env?.env ?? null,
          error: ov.summary.status === 'ready' ? null : `summary_${ov.summary.status}`,
          calls: summary.calls,
          ledgerStatuses: summary.statuses,
        };
      } else {
        // Prerequisites (an explanation to follow up on, an open check to grade) run outside the measured window.
        let explanationId: string | null = null;
        let checkId: string | null = null;
        let prereqError: string | null = null;
        if (req.kind === 'followup' || req.kind === 'assess' || req.kind === 'grade') {
          const w = await window(() => explain(snapshotId, req.on));
          explanationId = w.value.explanationId;
          prereqError = w.value.error;
          if (req.kind === 'grade' && explanationId) {
            const q = await window(() =>
              d.post(`/api/v1/explanations/${explanationId}/checks`, { format: 'open' }),
            );
            if (q.value.statusCode >= 400) prereqError = `prerequisite check: ${errorCode(q.value)}`;
            else checkId = (q.value.json() as { checkId: string }).checkId;
          }
        }
        const w = await window(async (): Promise<string | null> => {
          if (prereqError) return `prerequisite: ${prereqError}`;
          switch (req.kind) {
            case 'explain':
              return (await explain(snapshotId, req)).error;
            case 'flow': {
              const { kind: _k, hops, ...selection } = req;
              void _k;
              const sym = (await d.post(`/api/v1/snapshots/${snapshotId}/resolve`, { selection })).json() as {
                symbol: { id: string } | null;
              };
              if (!sym.symbol) return 'no_symbol';
              const r = await d.sse('/api/v1/flows/explain', { snapshotId, symbolId: sym.symbol.id, hops });
              const err = r.events.find((e) => e.event === 'error');
              return err
                ? String((err.data as { code?: string }).code)
                : r.status >= 400
                  ? `HTTP_${r.status}`
                  : null;
            }
            case 'concept': {
              const r = await d.sse(`/api/v1/snapshots/${snapshotId}/concepts/${req.conceptId}/teach`, {});
              const err = r.events.find((e) => e.event === 'error');
              return err
                ? String((err.data as { code?: string }).code)
                : r.status >= 400
                  ? `HTTP_${r.status}`
                  : null;
            }
            case 'followup': {
              const r = await d.sse(`/api/v1/explanations/${explanationId}/messages`, {
                intent: 'followup',
                text: req.text,
              });
              const err = r.events.find((e) => e.event === 'error');
              return err
                ? String((err.data as { code?: string }).code)
                : r.status >= 400
                  ? `HTTP_${r.status}`
                  : null;
            }
            case 'assess': {
              const r = await d.post(`/api/v1/explanations/${explanationId}/checks`, { format: req.format });
              return r.statusCode >= 400 ? errorCode(r) : null;
            }
            case 'grade': {
              const r = await d.post(`/api/v1/checks/${checkId}/answer`, { text: req.answer });
              return r.statusCode >= 400 ? errorCode(r) : null;
            }
          }
        });
        out = {
          envelope: w.envelopes.filter((e) => e.capability === c.capability).at(-1)?.env ?? null,
          error: w.value,
          calls: w.calls,
          ledgerStatuses: w.statuses,
        };
      }
      const scored = scoreCase(c, out);
      results.push(scored);
      log(`${scored.pass ? 'pass' : 'FAIL'} ${c.id}${scored.pass ? '' : ` [${scored.failures.join(', ')}]`}`);
    }

    return buildReport(
      {
        startedAt,
        provider: o.provider,
        models: { fast: config.MODEL_FAST, strong: config.MODEL_STRONG },
        realModel: o.provider !== 'fake',
      },
      results,
    );
  } finally {
    await app.close();
    await gh.close();
  }
}
