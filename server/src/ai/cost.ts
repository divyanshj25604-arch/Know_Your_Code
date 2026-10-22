import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import { AppError } from '../http/errors';

export type Tier = 'fast' | 'strong';

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

export async function spentTodayUsd(db: Db): Promise<number> {
  const r = await db.query<{ s: string | null }>(
    `SELECT sum(cost_usd)::text AS s FROM llm_calls WHERE created_at >= date_trunc('day', now())`,
  );
  return Number(r.rows[0]?.s ?? 0);
}

/** Hard daily cap (docs/09 §14). Navigation keeps working; only new model calls are refused. */
export async function assertBudget(db: Db, config: Config): Promise<void> {
  if ((await spentTodayUsd(db)) >= config.DAILY_SPEND_CAP_USD) throw new AppError('BUDGET_EXCEEDED');
}

export interface LlmCallLog {
  ownerId: string | null;
  snapshotId: string | null;
  task: string;
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

export async function logLlmCall(db: Db, l: LlmCallLog): Promise<void> {
  await db
    .query(
      `INSERT INTO llm_calls (owner_id, snapshot_id, task, model, prompt_version, input_tokens, output_tokens, cost_usd,
                              first_token_ms, total_ms, status, cache_hit, refs_stripped)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
      ],
    )
    .catch(() => undefined); // accounting must never break the user's request
}
