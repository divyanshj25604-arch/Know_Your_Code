import type { FastifyBaseLogger } from 'fastify';
import type { EvidenceEnvelope } from '@kyc/contracts';
import { KycError, verifyClaims, type ContextPack, type VerifyStats } from '@kyc/core';
import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import type { Capability } from './capability';
import { assertBudget, costUsd, logLlmCall, modelFor, type Tier } from './cost';
import { thinkingFor, type LlmCall, type LlmClient, type LlmOutput } from './llm';
import { PROMPT_VERSION, SYSTEM_RULES, userMessage } from './prompts';
import { ModelOutputError } from './schemas';

/** The envelope plus the number of references checked (used by the strong-tier regeneration rule). */
export type RunResult<P> = EvidenceEnvelope<P> & { refsTotal: number };

export interface RunContext {
  ownerId: string | null;
  snapshotId: string | null;
  signal?: AbortSignal;
  /** Called as output streams in (characters so far), when the provider streams. */
  onProgress?: (chars: number) => void;
  /** Force a tier (strong-tier regeneration). */
  tier?: Tier;
}

/**
 * Runs any registered capability (P2.3): budget check, model call (streamed when the provider can), one retry with
 * the schema reminder, a larger token allowance after a `max_tokens` stop, a strong-model retry after a refusal,
 * the plain-text fallback, cost logging, then verification into an evidence envelope.
 */
export class Executor {
  constructor(
    private readonly config: Config,
    private readonly db: Db,
    readonly llm: LlmClient | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Adaptive-thinking models spend part of max_tokens on thinking, so a JSON-sized allowance can truncate the answer
   * (risk T5). Give them room. Real-model sizing is unverified until the P0.2 baseline runs.
   */
  private maxTokens(base: number, model: string): number {
    return this.llm?.kind === 'anthropic' && !thinkingFor(model) ? Math.max(base * 3, 4096) : base;
  }

  private async call(llm: LlmClient, call: LlmCall, ctx: RunContext): Promise<LlmOutput> {
    if (llm.stream && ctx.onProgress) {
      let chars = 0;
      const onProgress = ctx.onProgress;
      return llm.stream(call, (d) => {
        chars += d.length;
        onProgress(chars);
      });
    }
    return llm.complete(call);
  }

  async run<I, P>(
    cap: Capability<I, P>,
    input: I,
    pack: ContextPack | null,
    ctx: RunContext,
    packText?: string,
  ): Promise<RunResult<P>> {
    const llm = this.llm;
    if (!llm) throw new KycError('AI_NOT_CONFIGURED');
    await assertBudget(this.db, this.config);
    let tier: Tier = ctx.tier ?? cap.tier;
    let model = modelFor(this.config, tier);
    const p = cap.prompt(input);
    const base = userMessage({ task: p.task, input: p.input, pack: packText ?? pack?.text ?? '' });
    let user = base;
    let maxTokens = this.maxTokens(cap.maxTokens, model);
    let lastText = '';
    let ledgerId: number | null = null;
    let value: P | null = null;
    let degraded = false;
    let refusedOnce = false;

    for (let attempt = 1; attempt <= 2 && value === null; attempt++) {
      const call: LlmCall = {
        task: cap.task,
        model,
        system: SYSTEM_RULES,
        user,
        schema: cap.schema,
        maxTokens,
        effort: 'medium',
        timeoutMs: this.config.AI_TIMEOUT_MS,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      };
      let out: LlmOutput;
      try {
        out = await this.call(llm, call, ctx);
      } catch (e) {
        await logLlmCall(
          this.db,
          this.ledger(ctx, cap, model, null, e instanceof KycError ? e.code : 'error'),
        );
        throw e;
      }
      const cost = costUsd(this.config, tier, out.inputTokens, out.outputTokens);
      lastText = out.text;
      if (out.refused) {
        await logLlmCall(this.db, this.ledger(ctx, cap, model, { out, cost }, 'refusal'));
        // One retry on the other model, when there is one: a refusal can be model-specific.
        const strong = modelFor(this.config, 'strong');
        if (!refusedOnce && tier === 'fast' && strong !== model) {
          refusedOnce = true;
          tier = 'strong';
          model = strong;
          maxTokens = this.maxTokens(cap.maxTokens, model);
          attempt--;
          continue;
        }
        throw new KycError(
          'AI_ERROR',
          'The model declined to answer about this code. Try a smaller selection.',
        );
      }
      if (out.stopReason === 'max_tokens') this.log.warn({ capability: cap.id }, 'model output truncated');
      let problem = '';
      if (out.json === null || out.json === undefined) problem = 'empty or non-JSON output';
      else {
        try {
          value = cap.normalise(out.json, input);
        } catch (e) {
          problem = e instanceof ModelOutputError ? e.message : 'invalid output';
        }
      }
      ledgerId = await logLlmCall(
        this.db,
        this.ledger(
          ctx,
          cap,
          model,
          { out, cost },
          value !== null ? 'ok' : `invalid:${problem}`.slice(0, 60),
        ),
      );
      if (value === null) {
        user = `${base}\n\nYour previous reply did not match the required JSON schema (${problem}). Reply with the JSON object only.`;
        if (out.stopReason === 'max_tokens') maxTokens *= 2;
      }
    }
    if (value === null) {
      value = cap.fallback?.(lastText, input) ?? null;
      degraded = value !== null;
    }
    if (value === null)
      throw new KycError('AI_ERROR', "Couldn't explain this selection. Try a smaller selection.");

    const stats: VerifyStats = { total: 0, stripped: 0 };
    const done = cap.finalise(value, pack, input, stats);
    // Separate counter: reference totals come from finalise; this pass only decides provenance.
    const claimCheck = verifyClaims(done.claims, pack?.ranges ?? new Map(), pack?.edges ?? new Map(), {
      total: 0,
      stripped: 0,
    });
    if (stats.stripped && ledgerId !== null)
      await this.db.query('UPDATE llm_calls SET refs_stripped=$1 WHERE id=$2', [stats.stripped, ledgerId]);
    return {
      capability: cap.id,
      version: cap.version,
      model,
      payload: done.payload,
      claims: claimCheck.claims,
      refsStripped: stats.stripped,
      claimsDowngraded: claimCheck.downgraded,
      degraded,
      refsTotal: stats.total,
    };
  }

  private ledger(
    ctx: RunContext,
    cap: { task: string; version: string },
    model: string,
    o: { out: LlmOutput; cost: number } | null,
    status: string,
  ) {
    return {
      ownerId: ctx.ownerId,
      snapshotId: ctx.snapshotId,
      task: cap.task,
      model,
      promptVersion: `${PROMPT_VERSION}/${cap.version}`,
      inputTokens: o?.out.inputTokens ?? null,
      outputTokens: o?.out.outputTokens ?? null,
      costUsd: o?.cost ?? null,
      firstTokenMs: o?.out.firstTokenMs ?? null,
      totalMs: o?.out.totalMs ?? null,
      status,
      cacheHit: false,
    };
  }
}
