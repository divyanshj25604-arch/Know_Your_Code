import { createHash, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  CONCEPT_VOCAB,
  type CheckBody,
  type ConceptBody,
  type Depth,
  type ExplanationBody,
  type FollowUpBody,
  type Overview,
  type Relations,
  type Selection,
} from '@kyc/contracts';
import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import { AppError } from '../http/errors';
import { buildContextPack, type ContextPack } from '../retrieval/context';
import { getFileContent } from '../index/files';
import { resolveSelection, type ResolvedSelection } from '../index/resolve';
import { getRelations, topSymbols } from '../index/symbols';
import { assertBudget, costUsd, logLlmCall, modelFor, type Tier } from './cost';
import type { LlmClient, LlmCall, LlmTask } from './llm';
import {
  CHECK_JSON_SCHEMA,
  CONCEPT_JSON_SCHEMA,
  EXPLANATION_JSON_SCHEMA,
  FOLLOWUP_JSON_SCHEMA,
  ModelOutputError,
  OVERVIEW_JSON_SCHEMA,
  OverviewOutputSchema,
  normaliseCheck,
  normaliseConcept,
  normaliseExplanation,
  normaliseFollowUp,
} from './schemas';
import {
  OVERVIEW_TASK,
  PROMPT_VERSION,
  SYSTEM_RULES,
  checkTask,
  conceptTask,
  explainTask,
  followupTask,
  userMessage,
} from './prompts';
import { verifyLines, verifyRefs, type VerifyStats } from './verify';

export type Emit = (event: string, data: unknown) => void;

export interface ExplainRequest {
  ownerId: string;
  snapshotId: string;
  selection: Selection;
  depth: Depth;
  parentId?: string;
}

export interface PreparedExplain extends ExplainRequest {
  resolved: ResolvedSelection;
  relations: Relations | null;
}

const MAX_TOKENS: Record<LlmTask, number> = {
  explain: 1400,
  followup: 900,
  concept: 900,
  check: 700,
  overview: 900,
};
const EXPLAIN_BUDGET = 6000;
const FOLLOWUP_BUDGET = 8000;

const CONCEPT_LABELS: Record<string, string> = Object.fromEntries(
  CONCEPT_VOCAB.map((id) => [id, id.replace(/-/g, ' ')]),
);

export class AiService {
  constructor(
    private readonly config: Config,
    private readonly db: Db,
    readonly llm: LlmClient | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  get configured(): boolean {
    return this.llm !== null;
  }

  private requireLlm(): LlmClient {
    if (!this.llm) throw new AppError('AI_NOT_CONFIGURED');
    return this.llm;
  }

  // ------------------------------------------------------------------ core model call

  private async generate<T>(o: {
    ownerId: string | null;
    snapshotId: string | null;
    task: LlmTask;
    tier: Tier;
    system: string;
    user: string;
    schema: Record<string, unknown>;
    normalise: (raw: unknown) => T;
    fallback?: (text: string) => T | null;
    signal?: AbortSignal;
  }): Promise<{ value: T; model: string; degraded: boolean }> {
    const llm = this.requireLlm();
    await assertBudget(this.db, this.config);
    const model = modelFor(this.config, o.tier);
    let user = o.user;
    let lastText = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const call: LlmCall = {
        task: o.task,
        model,
        system: o.system,
        user,
        schema: o.schema,
        maxTokens: MAX_TOKENS[o.task],
        effort: 'medium',
        timeoutMs: this.config.AI_TIMEOUT_MS,
        ...(o.signal ? { signal: o.signal } : {}),
      };
      let out;
      try {
        out = await llm.complete(call);
      } catch (e) {
        await logLlmCall(this.db, {
          ownerId: o.ownerId,
          snapshotId: o.snapshotId,
          task: o.task,
          model,
          promptVersion: PROMPT_VERSION,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          totalMs: null,
          status: e instanceof AppError ? e.code : 'error',
          cacheHit: false,
        });
        throw e;
      }
      const cost = costUsd(this.config, o.tier, out.inputTokens, out.outputTokens);
      lastText = out.text;
      if (out.refused) {
        await logLlmCall(this.db, {
          ownerId: o.ownerId,
          snapshotId: o.snapshotId,
          task: o.task,
          model,
          promptVersion: PROMPT_VERSION,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          costUsd: cost,
          totalMs: out.totalMs,
          status: 'refusal',
          cacheHit: false,
        });
        throw new AppError('AI_ERROR', "Couldn't explain this selection. Try a smaller selection.");
      }
      if (out.stopReason === 'max_tokens') this.log.warn({ task: o.task }, 'model output truncated');
      let value: T | null = null;
      let problem = '';
      if (out.json === null || out.json === undefined) problem = 'empty or non-JSON output';
      else {
        try {
          value = o.normalise(out.json);
        } catch (e) {
          problem = e instanceof ModelOutputError ? e.message : 'invalid output';
        }
      }
      await logLlmCall(this.db, {
        ownerId: o.ownerId,
        snapshotId: o.snapshotId,
        task: o.task,
        model,
        promptVersion: PROMPT_VERSION,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        costUsd: cost,
        totalMs: out.totalMs,
        status: value ? 'ok' : `invalid:${problem}`.slice(0, 60),
        cacheHit: false,
      });
      if (value) return { value, model, degraded: false };
      user = `${o.user}\n\nYour previous reply did not match the required JSON schema (${problem}). Reply with the JSON object only.`;
    }
    const fb = o.fallback?.(lastText);
    if (fb) return { value: fb, model, degraded: true };
    throw new AppError('AI_ERROR', "Couldn't explain this selection. Try a smaller selection.");
  }

  // ------------------------------------------------------------------ explanations

  async prepareExplain(req: ExplainRequest): Promise<PreparedExplain> {
    const resolved = await resolveSelection(this.db, req.snapshotId, req.selection);
    const relations = resolved.symbol
      ? await getRelations(this.db, req.snapshotId, resolved.symbol.id)
      : null;
    return { ...req, resolved, relations };
  }

  private cacheKey(p: PreparedExplain, model: string): string {
    const s = p.selection;
    return createHash('sha256')
      .update(
        [
          p.snapshotId,
          s.path,
          `${s.startLine}:${s.startCol}-${s.endLine}:${s.endCol}`,
          p.resolved.kind,
          p.depth,
          PROMPT_VERSION,
          model,
        ].join('|'),
      )
      .digest('hex');
  }

  private async facts(snapshotId: string) {
    const r = await this.db.query<{
      overview: { facts?: { frameworks: string[]; languages: Record<string, number> } } | null;
    }>('SELECT overview FROM snapshots WHERE id=$1', [snapshotId]);
    const f = r.rows[0]?.overview?.facts;
    return f ? { frameworks: f.frameworks, languages: f.languages } : null;
  }

  private verifyExplanation(
    body: ExplanationBody,
    pack: ContextPack,
  ): { body: ExplanationBody; stats: VerifyStats } {
    const stats: VerifyStats = { total: 0, stripped: 0 };
    const s = body.sections;
    const path = [...pack.ranges.keys()][0] ?? null;
    const out: ExplanationBody = {
      ...body,
      sections: {
        what: { ...s.what, refs: verifyRefs(s.what.refs, pack.ranges, stats) },
        ...(s.why ? { why: { ...s.why, refs: verifyRefs(s.why.refs, pack.ranges, stats) } } : {}),
        ...(s.steps
          ? {
              steps: s.steps.map((st) => ({ ...st, lines: verifyLines(st.lines, path, pack.ranges, stats) })),
            }
          : {}),
        ...(s.inputs ? { inputs: { ...s.inputs, refs: verifyRefs(s.inputs.refs, pack.ranges, stats) } } : {}),
        ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}),
        ...(s.effects
          ? { effects: { ...s.effects, refs: verifyRefs(s.effects.refs, pack.ranges, stats) } }
          : {}),
        ...(s.edgeCases
          ? { edgeCases: s.edgeCases.map((e) => ({ ...e, refs: verifyRefs(e.refs, pack.ranges, stats) })) }
          : {}),
      },
    };
    return { body: out, stats };
  }

  /** Stream an explanation: relations first (deterministic), then validated sections. Errors after the stream starts go through `emit('error')`. */
  async streamExplain(p: PreparedExplain, emit: Emit, signal?: AbortSignal): Promise<void> {
    emit(
      'relations',
      p.relations ?? { symbol: null, definedIn: null, calledBy: [], calls: [], imports: [], unresolved: [] },
    );
    const fastModel = modelFor(this.config, 'fast');
    const key = this.cacheKey(p, fastModel);
    const cached = await this.db.query<{ id: string; body: ExplanationBody; refs_stripped: number }>(
      'SELECT id, body, refs_stripped FROM explanations WHERE snapshot_id=$1 AND cache_key=$2 AND owner_id=$3 ORDER BY created_at DESC LIMIT 1',
      [p.snapshotId, key, p.ownerId],
    );
    if (cached.rows[0]) {
      const c = cached.rows[0];
      await logLlmCall(this.db, {
        ownerId: p.ownerId,
        snapshotId: p.snapshotId,
        task: 'explain',
        model: fastModel,
        promptVersion: PROMPT_VERSION,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        totalMs: 0,
        status: 'ok',
        cacheHit: true,
      });
      return this.emitExplanation(emit, c.id, c.body, p, true, c.refs_stripped);
    }

    const pack = await buildContextPack({
      db: this.db,
      snapshotId: p.snapshotId,
      selection: p.selection,
      resolved: p.resolved,
      maxTokens: EXPLAIN_BUDGET,
      facts: await this.facts(p.snapshotId),
    });
    const input = {
      kind: p.resolved.kind,
      depth: p.depth,
      selection: { path: p.selection.path, startLine: p.selection.startLine, endLine: p.selection.endLine },
      enclosingSymbol: p.resolved.symbol?.name ?? null,
      note: p.resolved.note ?? null,
    };
    const user = userMessage({ task: explainTask(p.resolved.kind, p.depth), input, pack: pack.text });
    const run = (tier: Tier) =>
      this.generate<ExplanationBody>({
        ownerId: p.ownerId,
        snapshotId: p.snapshotId,
        task: 'explain',
        tier,
        system: SYSTEM_RULES,
        user,
        schema: EXPLANATION_JSON_SCHEMA as unknown as Record<string, unknown>,
        normalise: (raw) => normaliseExplanation(raw, p.resolved.kind),
        fallback: (text) =>
          text.trim() && !text.trim().startsWith('{')
            ? {
                kind: p.resolved.kind,
                sections: { what: { text: text.trim().slice(0, 1200), refs: [] } },
                concepts: [],
                exploreNext: [],
                uncertainty: [
                  {
                    text: "The model's reply wasn't in the expected format, so only its plain text is shown.",
                  },
                ],
              }
            : null,
        ...(signal ? { signal } : {}),
      });

    let { value, model } = await run('fast');
    let verified = this.verifyExplanation(value, pack);
    if (
      verified.stats.total > 0 &&
      verified.stats.stripped / verified.stats.total > 0.3 &&
      this.config.MODEL_STRONG !== this.config.MODEL_FAST
    ) {
      try {
        const second = await run('strong');
        const v2 = this.verifyExplanation(second.value, pack);
        if (v2.stats.stripped <= verified.stats.stripped) {
          value = second.value;
          model = second.model;
          verified = v2;
        }
      } catch (e) {
        this.log.warn({ code: e instanceof AppError ? e.code : 'error' }, 'strong-tier regeneration skipped');
      }
    }
    const explanationId = randomUUID();
    await this.db.query(
      `INSERT INTO explanations (id, snapshot_id, owner_id, parent_id, cache_key, selection, kind, depth, symbol_id, body, prompt_version, model, refs_stripped)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        explanationId,
        p.snapshotId,
        p.ownerId,
        p.parentId ?? null,
        key,
        JSON.stringify(p.selection),
        p.resolved.kind,
        p.depth,
        p.resolved.symbol?.id ?? null,
        JSON.stringify(verified.body),
        PROMPT_VERSION,
        model,
        verified.stats.stripped,
      ],
    );
    if (verified.stats.stripped) {
      await this.db
        .query(
          `UPDATE llm_calls SET refs_stripped=$1 WHERE id = (SELECT max(id) FROM llm_calls WHERE owner_id=$2 AND task='explain')`,
          [verified.stats.stripped, p.ownerId],
        )
        .catch(() => undefined);
    }
    return this.emitExplanation(emit, explanationId, verified.body, p, false, verified.stats.stripped);
  }

  private emitExplanation(
    emit: Emit,
    id: string,
    body: ExplanationBody,
    p: PreparedExplain,
    cached: boolean,
    stripped: number,
  ) {
    emit('meta', {
      explanationId: id,
      kind: p.resolved.kind,
      cached,
      depth: p.depth,
      note: p.resolved.note ?? null,
      spansMultiple: p.resolved.spansMultiple,
      parentId: p.parentId ?? null,
    });
    const s = body.sections;
    emit('section', { name: 'what', ...s.what });
    if (s.why) emit('section', { name: 'why', ...s.why });
    if (s.steps) emit('section', { name: 'steps', steps: s.steps });
    if (s.inputs) emit('section', { name: 'inputs', ...s.inputs });
    if (s.dependsOn) emit('section', { name: 'dependsOn', ...s.dependsOn });
    if (s.effects) emit('section', { name: 'effects', ...s.effects });
    if (s.edgeCases) emit('section', { name: 'edgeCases', items: s.edgeCases });
    emit('done', {
      explanationId: id,
      concepts: body.concepts,
      exploreNext: body.exploreNext,
      tryIt: body.tryIt ?? null,
      uncertainty: body.uncertainty,
      refsStripped: stripped,
    });
  }

  // ------------------------------------------------------------------ thread messages

  private async loadExplanation(ownerId: string, explanationId: string) {
    const r = await this.db.query<{
      id: string;
      snapshot_id: string;
      owner_id: string;
      selection: Selection;
      depth: Depth;
      body: ExplanationBody;
      symbol_id: string | null;
      kind: string;
    }>(
      'SELECT id, snapshot_id, owner_id, selection, depth, body, symbol_id, kind FROM explanations WHERE id=$1',
      [explanationId],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    if (row.owner_id !== ownerId)
      throw new AppError('NOT_OWNER', 'Only the browser that created this explanation can continue it.');
    return row;
  }

  async prepareMessage(ownerId: string, explanationId: string) {
    return this.loadExplanation(ownerId, explanationId);
  }

  async streamMessage(
    ownerId: string,
    explanationId: string,
    req: {
      intent: 'followup' | 'simpler' | 'deeper' | 'concept';
      text?: string | undefined;
      conceptId?: string | undefined;
    },
    emit: Emit,
    signal?: AbortSignal,
  ): Promise<void> {
    const ex = await this.loadExplanation(ownerId, explanationId);
    if (req.intent === 'simpler' || req.intent === 'deeper') {
      const prepared = await this.prepareExplain({
        ownerId,
        snapshotId: ex.snapshot_id,
        selection: ex.selection,
        depth: req.intent,
        parentId: ex.id,
      });
      return this.streamExplain(prepared, emit, signal);
    }
    const resolved = await resolveSelection(this.db, ex.snapshot_id, ex.selection);
    const history = await this.db.query<{ role: string; body: { text?: string; plain?: string } }>(
      'SELECT role, body FROM messages WHERE explanation_id=$1 ORDER BY created_at DESC LIMIT 4',
      [explanationId],
    );
    const hist = history.rows
      .reverse()
      .map((m) => ({ role: m.role, text: (m.body.text ?? m.body.plain ?? '').slice(0, 600) }));
    const summary =
      `${ex.body.sections.what.text}${ex.body.sections.dependsOn ? ` ${ex.body.sections.dependsOn.text}` : ''}`.slice(
        0,
        1700,
      );

    if (req.intent === 'followup') {
      const question = (req.text ?? '').trim();
      const pack = await buildContextPack({
        db: this.db,
        snapshotId: ex.snapshot_id,
        selection: ex.selection,
        resolved,
        question,
        maxTokens: FOLLOWUP_BUDGET,
        facts: await this.facts(ex.snapshot_id),
      });
      const user = userMessage({
        task: followupTask(ex.depth),
        input: { question, depth: ex.depth, previousExplanationSummary: summary, recentThread: hist },
        pack: pack.text,
      });
      const { value } = await this.generate<FollowUpBody>({
        ownerId,
        snapshotId: ex.snapshot_id,
        task: 'followup',
        tier: 'fast',
        system: SYSTEM_RULES,
        user,
        schema: FOLLOWUP_JSON_SCHEMA as unknown as Record<string, unknown>,
        normalise: normaliseFollowUp,
        fallback: (t) =>
          t.trim() && !t.trim().startsWith('{')
            ? { text: t.trim().slice(0, 1200), refs: [], uncertainty: [] }
            : null,
        ...(signal ? { signal } : {}),
      });
      const stats: VerifyStats = { total: 0, stripped: 0 };
      const body: FollowUpBody = { ...value, refs: verifyRefs(value.refs, pack.ranges, stats) };
      await this.db.query(
        `INSERT INTO messages (explanation_id, role, intent, body) VALUES ($1,'user','followup',$2)`,
        [explanationId, JSON.stringify({ text: question })],
      );
      const id = randomUUID();
      await this.db.query(
        `INSERT INTO messages (id, explanation_id, role, intent, body) VALUES ($1,$2,'assistant','followup',$3)`,
        [id, explanationId, JSON.stringify(body)],
      );
      emit('message', { messageId: id, ...body });
      emit('done', {
        messageId: id,
        refs: body.refs,
        uncertainty: body.uncertainty,
        refsStripped: stats.stripped,
      });
      return;
    }

    // concept
    const conceptId = req.conceptId ?? '';
    const label = CONCEPT_LABELS[conceptId] ?? conceptId.replace(/^other:/, '');
    if (!CONCEPT_LABELS[conceptId] && !conceptId.startsWith('other:'))
      throw new AppError('INVALID_REQUEST', 'Unknown concept.');
    const cachedConcept = await this.db.query<{ id: string; body: ConceptBody }>(
      `SELECT m.id, m.body FROM messages m JOIN explanations e ON e.id = m.explanation_id
       WHERE e.snapshot_id=$1 AND e.symbol_id IS NOT DISTINCT FROM $2 AND m.intent='concept' AND m.body->>'concept' = $3 LIMIT 1`,
      [ex.snapshot_id, ex.symbol_id, conceptId],
    );
    if (cachedConcept.rows[0]) {
      const c = cachedConcept.rows[0];
      await logLlmCall(this.db, {
        ownerId,
        snapshotId: ex.snapshot_id,
        task: 'concept',
        model: modelFor(this.config, 'fast'),
        promptVersion: PROMPT_VERSION,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        totalMs: 0,
        status: 'ok',
        cacheHit: true,
      });
      emit('message', { messageId: c.id, cached: true, ...c.body });
      emit('done', { messageId: c.id, refs: c.body.inYourCode, uncertainty: [], refsStripped: 0 });
      return;
    }
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: ex.snapshot_id,
      selection: ex.selection,
      resolved,
      maxTokens: EXPLAIN_BUDGET,
      facts: await this.facts(ex.snapshot_id),
    });
    const user = userMessage({
      task: conceptTask(conceptId, label),
      input: { conceptId, conceptLabel: label, previousExplanationSummary: summary },
      pack: pack.text,
    });
    const { value } = await this.generate<ConceptBody>({
      ownerId,
      snapshotId: ex.snapshot_id,
      task: 'concept',
      tier: 'fast',
      system: SYSTEM_RULES,
      user,
      schema: CONCEPT_JSON_SCHEMA as unknown as Record<string, unknown>,
      normalise: normaliseConcept,
      ...(signal ? { signal } : {}),
    });
    const stats: VerifyStats = { total: 0, stripped: 0 };
    const okRefs = verifyRefs(
      value.inYourCode.map((x) => ({ path: x.path, line: x.line })),
      pack.ranges,
      stats,
    );
    const body: ConceptBody = {
      ...value,
      concept: conceptId,
      inYourCode: value.inYourCode.filter((x) => okRefs.some((r) => r.path === x.path && r.line === x.line)),
    };
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO messages (id, explanation_id, role, intent, body) VALUES ($1,$2,'assistant','concept',$3)`,
      [id, explanationId, JSON.stringify(body)],
    );
    emit('message', { messageId: id, cached: false, ...body });
    emit('done', { messageId: id, refs: body.inYourCode, uncertainty: [], refsStripped: stats.stripped });
  }

  // ------------------------------------------------------------------ optional checks

  async createCheck(ownerId: string, explanationId: string, signal?: AbortSignal) {
    const ex = await this.loadExplanation(ownerId, explanationId);
    const resolved = await resolveSelection(this.db, ex.snapshot_id, ex.selection);
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: ex.snapshot_id,
      selection: ex.selection,
      resolved,
      maxTokens: EXPLAIN_BUDGET,
      facts: null,
    });
    const user = userMessage({ task: checkTask(), input: { kind: resolved.kind }, pack: pack.text });
    const { value } = await this.generate<CheckBody>({
      ownerId,
      snapshotId: ex.snapshot_id,
      task: 'check',
      tier: 'fast',
      system: SYSTEM_RULES,
      user,
      schema: CHECK_JSON_SCHEMA as unknown as Record<string, unknown>,
      normalise: normaliseCheck,
      ...(signal ? { signal } : {}),
    });
    const stats: VerifyStats = { total: 0, stripped: 0 };
    const body: CheckBody = { ...value, answerRefs: verifyRefs(value.answerRefs, pack.ranges, stats) };
    // A check whose answer cannot be tied to the shown code is not answerable from the code (docs/09 §9): discard it.
    if (body.answerRefs.length === 0 || value.correctIndex === undefined || value.correctIndex > 3)
      throw new AppError('AI_ERROR', "Couldn't make a good question for this selection.");
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO check_attempts (explanation_id, question) VALUES ($1,$2) RETURNING id`,
      [explanationId, JSON.stringify(body)],
    );
    return { checkId: r.rows[0]!.id, type: body.type, question: body.question, options: body.options ?? [] };
  }

  async answerCheck(ownerId: string, checkId: string, answerIndex: number) {
    const r = await this.db.query<{
      id: string;
      explanation_id: string;
      question: CheckBody;
      owner_id: string;
    }>(
      `SELECT c.id, c.explanation_id, c.question, e.owner_id FROM check_attempts c JOIN explanations e ON e.id=c.explanation_id WHERE c.id=$1`,
      [checkId],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    if (row.owner_id !== ownerId) throw new AppError('NOT_OWNER');
    const q = row.question;
    const correct = answerIndex === q.correctIndex;
    const result = { correct, feedback: q.explanation, refs: q.answerRefs, correctIndex: q.correctIndex };
    await this.db.query('UPDATE check_attempts SET answer=$2, result=$3 WHERE id=$1', [
      checkId,
      JSON.stringify({ answerIndex }),
      JSON.stringify(result),
    ]);
    return { correct, feedback: q.explanation, refs: q.answerRefs, correctIndex: q.correctIndex ?? null };
  }

  // ------------------------------------------------------------------ project summary

  async summarise(snapshotId: string): Promise<Overview['summary']> {
    if (!this.llm) return { status: 'unavailable', provenance: 'explained' };
    const snap = await this.db.query<{
      overview: { facts: unknown; startingPoints: { path: string }[] } | null;
    }>('SELECT overview FROM snapshots WHERE id=$1', [snapshotId]);
    const ov = snap.rows[0]?.overview;
    const paths = (
      await this.db.query<{ path: string }>('SELECT path FROM files WHERE snapshot_id=$1 ORDER BY path', [
        snapshotId,
      ])
    ).rows.map((r) => r.path);
    const top = await topSymbols(this.db, snapshotId, 6);
    const headerFiles = [
      ...new Set([...(ov?.startingPoints ?? []).map((s) => s.path), ...top.map((t) => t.path)]),
    ].slice(0, 10);
    const parts: string[] = [];
    for (const p of headerFiles) {
      const f = await getFileContent(this.db, snapshotId, p);
      if (!f) continue;
      const lines = f.content.split('\n').slice(0, 20);
      parts.push(
        `[FILE_HEADER] file: ${p}\n${lines.map((l, i) => `${i + 1}| ${l.slice(0, 200)}`).join('\n')}`,
      );
    }
    const readme = paths.find((p) => /^readme(\.md)?$/i.test(p));
    if (readme) {
      const f = await getFileContent(this.db, snapshotId, readme);
      if (f) parts.push(`[README_EXCERPT]\n${f.content.slice(0, 2800)}`);
    }
    parts.unshift(
      `[PROJECT_FACTS]\n${JSON.stringify(ov?.facts ?? {})}\n[FILE_LIST]\n${paths.slice(0, 120).join('\n')}`,
    );
    const user = userMessage({ task: OVERVIEW_TASK, input: {}, pack: parts.join('\n\n') });
    const pathSet = new Set(paths);
    const { value } = await this.generate<{
      summary: string;
      modules: { name: string; paths: string[] }[];
      refs: { path: string; line: number }[];
    }>({
      ownerId: null,
      snapshotId,
      task: 'overview',
      tier: 'strong',
      system: SYSTEM_RULES,
      user,
      schema: OVERVIEW_JSON_SCHEMA as unknown as Record<string, unknown>,
      normalise: (raw) => {
        const r = OverviewOutputSchema.safeParse(raw);
        if (!r.success || !r.data.summary.trim()) throw new ModelOutputError('overview schema');
        return r.data;
      },
    });
    const words = value.summary.trim().split(/\s+/);
    const text = words.length > 220 ? `${words.slice(0, 220).join(' ')}…` : value.summary.trim();
    // Links must point at real files; line defaults to the top of the file.
    const cleanRefs = value.refs.filter((r) => pathSet.has(r.path) && r.line >= 1).slice(0, 8);
    const modules = value.modules
      .map((m) => ({ name: m.name, paths: m.paths.filter((p) => pathSet.has(p)) }))
      .filter((m) => m.name.trim() && m.paths.length)
      .slice(0, 8);
    return { status: 'ready', text, refs: cleanRefs, modules, provenance: 'explained' };
  }
}
