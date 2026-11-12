import type { Config } from '../config/env';
import { withTx, type Db, type Queryable } from '../db/pool';
import { KycError } from '@kyc/core';

export type Tier = 'fast' | 'strong';

/** The configured model for a tier. Provider-neutral: every provider names its models in MODEL_FAST / MODEL_STRONG. */
export function modelFor(config: Config, tier: Tier): string {
  return tier === 'fast' ? config.MODEL_FAST : config.MODEL_STRONG;
}

export function costUsd(config: Config, tier: Tier, inputTokens: number, outputTokens: number): number {
  const inRate =
    tier === 'fast' ? config.MODEL_FAST_INPUT_USD_PER_MTOK : config.MODEL_STRONG_INPUT_USD_PER_MTOK;
  const outRate =
    tier === 'fast' ? config.MODEL_FAST_OUTPUT_USD_PER_MTOK : config.MODEL_STRONG_OUTPUT_USD_PER_MTOK;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}

/** Global AI spend so far today (UTC day of the database clock), from the cost ledger. */
export async function spentTodayUsd(db: Queryable): Promise<number> {
  const r = await db.query<{ s: string | null }>(
    `SELECT sum(cost_usd)::text AS s FROM llm_calls WHERE created_at >= date_trunc('day', now())`,
  );
  return Number(r.rows[0]?.s ?? 0);
}

/**
 * Worst-case cost of one model call: the prompt's tokens estimated generously (3 characters per token; code
 * usually tokenises at 3.5–4) plus the full output allowance. Thinking tokens count against max_tokens, so they are
 * inside this bound too.
 */
export function worstCaseUsd(config: Config, tier: Tier, promptChars: number, maxTokens: number): number {
  return costUsd(config, tier, Math.ceil(promptChars / 3), maxTokens);
}

/** How long a reservation counts if its request dies without releasing it. */
const RESERVATION_TTL_MS = 10 * 60_000;
const BUDGET_LOCK = 'kyc:ai-budget';

export interface BudgetRequest {
  userId: string | null;
  capability: string;
  usd: number;
}

/**
 * Reserve the worst-case cost of one model call before making it (P4.3). Decisions are serialised by one
 * transaction-scoped advisory lock and count both logged spend and open reservations, so concurrent requests cannot
 * together exceed:
 *  - DAILY_SPEND_CAP_USD, the global cap;
 *  - AI_USER_DAILY_BUDGET_USD, each user's share (always below the global cap in production, so one user cannot
 *    exhaust it);
 *  - AI_USER_DAILY_REQUESTS, each user's model calls per day.
 * Cached answers cost nothing and do not count. Returns the reservation id; release it with `releaseBudget` once the call is logged.
 */
export async function reserveBudget(db: Db, config: Config, req: BudgetRequest): Promise<number> {
  return withTx(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [BUDGET_LOCK]);
    const r = await c.query<{ global: string; user_usd: string; user_calls: string }>(
      `WITH spent AS (
         SELECT owner_id AS user_id, cost_usd AS usd FROM llm_calls
         WHERE created_at >= date_trunc('day', now()) AND NOT cache_hit
         UNION ALL
         SELECT user_id, reserved_usd FROM ai_reservations WHERE expires_at > now()
       )
       SELECT coalesce(sum(usd), 0)::text AS global,
              coalesce(sum(usd) FILTER (WHERE user_id = $1), 0)::text AS user_usd,
              count(*) FILTER (WHERE user_id = $1)::text AS user_calls
       FROM spent`,
      [req.userId],
    );
    const row = r.rows[0]!;
    if (Number(row.global) + req.usd > config.DAILY_SPEND_CAP_USD) throw new KycError('BUDGET_EXCEEDED');
    if (req.userId) {
      if (Number(row.user_calls) >= config.AI_USER_DAILY_REQUESTS)
        throw new KycError('USER_BUDGET_EXCEEDED', "You've reached today's limit of AI requests.");
      if (Number(row.user_usd) + req.usd > config.AI_USER_DAILY_BUDGET_USD)
        throw new KycError('USER_BUDGET_EXCEEDED');
    }
    const ins = await c.query<{ id: string }>(
      `INSERT INTO ai_reservations (user_id, capability, reserved_usd, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond') RETURNING id`,
      [req.userId, req.capability, req.usd.toFixed(6), RESERVATION_TTL_MS],
    );
    return Number(ins.rows[0]!.id);
  });
}

/** Release a reservation (its call has been logged with the actual cost, or never happened). Never throws. */
export async function releaseBudget(db: Db, id: number): Promise<void> {
  await db.query('DELETE FROM ai_reservations WHERE id=$1', [id]).catch(() => undefined);
}

export interface AiUsage {
  spentUsd: number;
  budgetUsd: number;
  requests: number;
  requestLimit: number;
  byCapability: {
    capability: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    usd: number;
  }[];
}

/** One user's AI usage today, per capability (the `GET /api/v1/ai/usage` view). */
export async function userUsageToday(db: Queryable, config: Config, userId: string): Promise<AiUsage> {
  const r = await db.query<{ capability: string; n: string; i: string; o: string; usd: string }>(
    `SELECT coalesce(capability, task) AS capability, count(*)::text AS n, coalesce(sum(input_tokens),0)::text AS i,
            coalesce(sum(output_tokens),0)::text AS o, coalesce(sum(cost_usd),0)::text AS usd
     FROM llm_calls WHERE owner_id=$1 AND created_at >= date_trunc('day', now()) AND NOT cache_hit
     GROUP BY 1 ORDER BY 1`,
    [userId],
  );
  const byCapability = r.rows.map((x) => ({
    capability: x.capability,
    requests: Number(x.n),
    inputTokens: Number(x.i),
    outputTokens: Number(x.o),
    usd: Number(x.usd),
  }));
  return {
    spentUsd: byCapability.reduce((a, b) => a + b.usd, 0),
    budgetUsd: config.AI_USER_DAILY_BUDGET_USD,
    requests: byCapability.reduce((a, b) => a + b.requests, 0),
    requestLimit: config.AI_USER_DAILY_REQUESTS,
    byCapability,
  };
}

/** Operator report: usage per day, capability and model over the last `days` days (scripts/ai-usage). */
export async function usageReport(db: Queryable, days: number) {
  const r = await db.query<{
    day: string;
    capability: string;
    model: string;
    calls: string;
    users: string;
    failed: string;
    input_tokens: string;
    output_tokens: string;
    usd: string;
  }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, coalesce(capability, task) AS capability,
            model, count(*)::text AS calls, count(DISTINCT owner_id)::text AS users,
            count(*) FILTER (WHERE status <> 'ok')::text AS failed,
            coalesce(sum(input_tokens),0)::text AS input_tokens, coalesce(sum(output_tokens),0)::text AS output_tokens,
            coalesce(sum(cost_usd),0)::text AS usd
     FROM llm_calls WHERE created_at >= date_trunc('day', now()) - ($1::int - 1) * interval '1 day'
     GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3`,
    [days],
  );
  return r.rows.map((x) => ({
    day: x.day,
    capability: x.capability,
    model: x.model,
    calls: Number(x.calls),
    users: Number(x.users),
    failed: Number(x.failed),
    inputTokens: Number(x.input_tokens),
    outputTokens: Number(x.output_tokens),
    usd: Number(x.usd),
  }));
}

export interface LlmCallLog {
  ownerId: string | null;
  snapshotId: string | null;
  task: string;
  capability?: string | null;
  stopReason?: string | null;
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  firstTokenMs?: number | null;
  totalMs: number | null;
  status: string;
  cacheHit: boolean;
  refsStripped?: number;
}

/** Record one model call in the cost ledger. Returns its id, or null if accounting failed (never fatal). */
export async function logLlmCall(db: Db, l: LlmCallLog): Promise<number | null> {
  return db
    .query<{ id: string }>(
      `INSERT INTO llm_calls (owner_id, snapshot_id, task, model, prompt_version, input_tokens, output_tokens, cost_usd,
                              first_token_ms, total_ms, status, cache_hit, refs_stripped, capability, stop_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        l.ownerId,
        l.snapshotId,
        l.task,
        l.model,
        l.promptVersion,
        l.inputTokens,
        l.outputTokens,
        l.costUsd,
        l.firstTokenMs ?? null,
        l.totalMs,
        l.status,
        l.cacheHit,
        l.refsStripped ?? 0,
        l.capability ?? null,
        l.stopReason ?? null,
      ],
    )
    .then((r) => Number(r.rows[0]?.id))
    .catch(() => null); // accounting must never break the user's request
}
