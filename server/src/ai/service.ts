import { createHash, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  CONCEPT_VOCAB,
  type CapabilityId,
  type Claim,
  type Depth,
  type EvidenceSummary,
  type ExplanationBody,
  type Overview,
  type Relations,
  type Selection,
} from '@kyc/contracts';
import { KycError, relationsOf } from '@kyc/core';
import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import { getFileContent } from '../index/files';
import { PgGraphStore } from '../index/graphStore';
import { resolveSelection, type ResolvedSelection } from '../index/resolve';
import { topSymbols } from '../index/symbols';
import { buildContextPack } from '../retrieval/context';
import { logLlmCall, modelFor } from './cost';
import { Executor, type RunContext, type RunResult } from './executor';
import type { LlmClient } from './llm';
import { PROMPT_VERSION } from './prompts';
import { CAPABILITIES } from './registry';
import * as store from './store';

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

const CONCEPT_LABELS: Record<string, string> = Object.fromEntries(
  CONCEPT_VOCAB.map((id) => [id, id.replace(/-/g, ' ')]),
);

const summary = (env: {
  capability: CapabilityId;
  version: string;
  claims: Claim[];
  claimsDowngraded: number;
}): EvidenceSummary => ({
  capability: env.capability,
  version: env.version,
  claims: env.claims,
  claimsDowngraded: env.claimsDowngraded,
});

/**
 * Orchestrates the AI capabilities (P2.3): resolves the request, plans the context, runs the registered capability
 * through the executor, stores the answer and streams it. Capability logic lives in ai/capabilities, the model loop
 * in ai/executor.ts and all SQL in ai/store.ts.
 */
export class AiService {
  private readonly exec: Executor;

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    readonly llm: LlmClient | null,
    private readonly log: FastifyBaseLogger,
  ) {
    this.exec = new Executor(config, db, llm, log);
  }

  get configured(): boolean {
    return this.llm !== null;
  }

  /** Streams progress (characters generated so far) as `progress` events, at most every 200 characters. */
  private progress(emit: Emit, capability: CapabilityId): RunContext['onProgress'] {
    let last = 0;
    return (chars) => {
      if (chars - last < 200) return;
      last = chars;
      emit('progress', { capability, chars });
    };
  }

  private async cacheHit(ownerId: string, snapshotId: string, task: string) {
    await logLlmCall(this.db, {
      ownerId,
      snapshotId,
      task,
      model: modelFor(this.config, 'fast'),
      promptVersion: PROMPT_VERSION,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      totalMs: 0,
      status: 'ok',
      cacheHit: true,
    });
  }

  // ------------------------------------------------------------------ explain selection

  async prepareExplain(req: ExplainRequest): Promise<PreparedExplain> {
    const resolved = await resolveSelection(this.db, req.snapshotId, req.selection);
    const relations = resolved.symbol
      ? await relationsOf(new PgGraphStore(this.db, req.snapshotId), resolved.symbol.id)
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
          CAPABILITIES.explain_selection.version,
          model,
        ].join('|'),
      )
      .digest('hex');
  }

  /** Relations first (deterministic), then the validated sections. Errors after the stream opens go to `emit`. */
  async streamExplain(p: PreparedExplain, emit: Emit, signal?: AbortSignal): Promise<void> {
    emit(
      'relations',
      p.relations ?? { symbol: null, definedIn: null, calledBy: [], calls: [], imports: [], unresolved: [] },
    );
    const cap = CAPABILITIES.explain_selection;
    const key = this.cacheKey(p, modelFor(this.config, 'fast'));
    const cached = await store.cachedExplanation(this.db, p.snapshotId, key, p.ownerId);
    if (cached) {
      await this.cacheHit(p.ownerId, p.snapshotId, 'explain');
      return this.emitExplanation(emit, cached.id, cached.body, p, true, cached.refs_stripped, {
        capability: cap.id,
        version: cap.version,
        claims: cached.claims,
        claimsDowngraded: 0,
      });
    }
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: p.snapshotId,
      selection: p.selection,
      resolved: p.resolved,
      intent: 'explain',
      maxTokens: cap.budget,
      facts: await store.snapshotFacts(this.db, p.snapshotId),
    });
    const input = {
      kind: p.resolved.kind,
      depth: p.depth,
      selection: p.selection,
      enclosingSymbol: p.resolved.symbol?.name ?? null,
      note: p.resolved.note ?? null,
    };
    const ctx: RunContext = {
      ownerId: p.ownerId,
      snapshotId: p.snapshotId,
      ...(signal ? { signal } : {}),
      onProgress: this.progress(emit, cap.id),
    };
    let env: RunResult<ExplanationBody> = await this.exec.run(cap, input, pack, ctx);
    // Too many references outside what the model was shown: try once on the strong model, keep the better one.
    if (
      env.refsTotal > 0 &&
      env.refsStripped / env.refsTotal > 0.3 &&
      this.config.MODEL_STRONG !== this.config.MODEL_FAST
    ) {
      try {
        const second = await this.exec.run(cap, input, pack, { ...ctx, tier: 'strong' });
        if (second.refsStripped <= env.refsStripped) env = second;
      } catch (e) {
        this.log.warn({ code: e instanceof KycError ? e.code : 'error' }, 'strong-tier regeneration skipped');
      }
    }
    const id = randomUUID();
    const stored = await store.insertExplanation(this.db, {
      id,
      snapshotId: p.snapshotId,
      ownerId: p.ownerId,
      parentId: p.parentId ?? null,
      cacheKey: key,
      selection: p.selection,
      kind: p.resolved.kind,
      depth: p.depth,
      symbolId: p.resolved.symbol?.id ?? null,
      symbolKey: p.resolved.symbol?.key ?? null,
      body: env.payload,
      promptVersion: PROMPT_VERSION,
      model: env.model,
      refsStripped: env.refsStripped,
      capability: env.capability,
      capabilityVersion: env.version,
      claims: env.claims,
    });
    // The snapshot was deleted while the model was answering: there is nothing left to attach the answer to.
    if (!stored) throw new KycError('SNAPSHOT_EXPIRED');
    return this.emitExplanation(emit, id, env.payload, p, false, env.refsStripped, summary(env));
  }

  private emitExplanation(
    emit: Emit,
    id: string,
    body: ExplanationBody,
    p: PreparedExplain,
    cached: boolean,
    stripped: number,
    evidence: EvidenceSummary,
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
      evidence,
    });
  }

  // ------------------------------------------------------------------ thread: follow-up, simpler/deeper, concept

  /**
   * An explanation the caller owns whose code is still stored. Explanations outlive their snapshot (learning history
   * is kept after retention), but continuing one needs the code: SNAPSHOT_EXPIRED otherwise.
   */
  private async loadExplanation(ownerId: string, explanationId: string) {
    const row = await store.getExplanation(this.db, explanationId);
    if (!row) throw new KycError('NOT_FOUND');
    if (row.owner_id !== ownerId)
      throw new KycError('NOT_OWNER', 'Only the account that created this explanation can continue it.');
    if (!row.snapshot_id) throw new KycError('SNAPSHOT_EXPIRED');
    return { ...row, snapshot_id: row.snapshot_id };
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
    const previousExplanationSummary =
      `${ex.body.sections.what.text}${ex.body.sections.dependsOn ? ` ${ex.body.sections.dependsOn.text}` : ''}`.slice(
        0,
        1700,
      );
    const ctx = (cap: CapabilityId): RunContext => ({
      ownerId,
      snapshotId: ex.snapshot_id,
      ...(signal ? { signal } : {}),
      onProgress: this.progress(emit, cap),
    });
    const facts = await store.snapshotFacts(this.db, ex.snapshot_id);

    if (req.intent === 'followup') {
      const cap = CAPABILITIES.follow_up;
      const question = (req.text ?? '').trim();
      const pack = await buildContextPack({
        db: this.db,
        snapshotId: ex.snapshot_id,
        selection: ex.selection,
        resolved,
        intent: 'followup',
        question,
        maxTokens: cap.budget,
        facts,
      });
      const recent = await store.recentThread(this.db, explanationId, 4);
      const env = await this.exec.run(
        cap,
        { question, depth: ex.depth, previousExplanationSummary, recentThread: recent },
        pack,
        ctx(cap.id),
      );
      await store.insertMessage(this.db, {
        explanationId,
        role: 'user',
        intent: 'followup',
        body: { text: question },
      });
      const id = randomUUID();
      await store.insertMessage(this.db, {
        id,
        explanationId,
        role: 'assistant',
        intent: 'followup',
        body: env.payload,
        capability: env.capability,
        capabilityVersion: env.version,
        claims: env.claims,
      });
      emit('message', { messageId: id, ...env.payload });
      emit('done', {
        messageId: id,
        refs: env.payload.refs,
        uncertainty: env.payload.uncertainty,
        refsStripped: env.refsStripped,
        evidence: summary(env),
      });
      return;
    }

    // concept
    const cap = CAPABILITIES.teach_concept;
    const conceptId = req.conceptId ?? '';
    const label = CONCEPT_LABELS[conceptId] ?? conceptId.replace(/^other:/, '');
    if (!CONCEPT_LABELS[conceptId] && !conceptId.startsWith('other:'))
      throw new KycError('INVALID_REQUEST', 'Unknown concept.');
    const hit = await store.cachedConcept(this.db, ex.snapshot_id, ex.symbol_id, conceptId);
    if (hit) {
      await this.cacheHit(ownerId, ex.snapshot_id, 'concept');
      emit('message', { messageId: hit.id, cached: true, ...hit.body });
      emit('done', { messageId: hit.id, refs: hit.body.inYourCode, uncertainty: [], refsStripped: 0 });
      return;
    }
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: ex.snapshot_id,
      selection: ex.selection,
      resolved,
      intent: 'concept',
      maxTokens: cap.budget,
      facts,
    });
    const env = await this.exec.run(
      cap,
      { conceptId, conceptLabel: label, previousExplanationSummary },
      pack,
      ctx(cap.id),
    );
    const id = randomUUID();
    await store.insertMessage(this.db, {
      id,
      explanationId,
      role: 'assistant',
      intent: 'concept',
      body: env.payload,
      capability: env.capability,
      capabilityVersion: env.version,
      claims: env.claims,
    });
    emit('message', { messageId: id, cached: false, ...env.payload });
    emit('done', {
      messageId: id,
      refs: env.payload.inYourCode,
      uncertainty: [],
      refsStripped: env.refsStripped,
      evidence: summary(env),
    });
  }

  // ------------------------------------------------------------------ explain flow

  /**
   * Explain how execution flows from a symbol through its verified calls (up to `hops` hops). The flow steps come
   * from the retrieval planner before the model is called and are streamed first, so they are shown even if the
   * model fails. Stored as an explanation of kind "flow", so it is part of the learning history.
   */
  async streamFlow(
    o: { ownerId: string; snapshotId: string; symbolId: string; hops: number; depth: Depth },
    emit: Emit,
    signal?: AbortSignal,
  ): Promise<void> {
    const cap = CAPABILITIES.explain_flow;
    const graph = new PgGraphStore(this.db, o.snapshotId);
    const start = await graph.symbol(o.symbolId);
    if (!start) throw new KycError('NOT_FOUND');
    const selection: Selection = {
      path: start.path,
      startLine: start.startLine,
      startCol: start.startCol,
      endLine: start.endLine,
      endCol: start.endCol,
    };
    const resolved = await resolveSelection(this.db, o.snapshotId, selection);
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: o.snapshotId,
      selection,
      resolved,
      intent: 'flow',
      hops: o.hops,
      maxTokens: cap.budget,
      facts: null,
    });
    emit('flow', {
      start: { id: start.id, key: start.key, name: start.name, path: start.path, line: start.startLine },
      steps: pack.flow,
    });
    const env = await this.exec.run(
      cap,
      { depth: o.depth, start: { name: start.name, path: start.path, line: start.startLine } },
      pack,
      {
        ownerId: o.ownerId,
        snapshotId: o.snapshotId,
        ...(signal ? { signal } : {}),
        onProgress: this.progress(emit, cap.id),
      },
    );
    const id = randomUUID();
    const stored = await store.insertExplanation(this.db, {
      id,
      snapshotId: o.snapshotId,
      ownerId: o.ownerId,
      parentId: null,
      cacheKey: createHash('sha256')
        .update([o.snapshotId, o.symbolId, o.hops, o.depth, cap.version].join('|'))
        .digest('hex'),
      selection,
      kind: 'flow',
      depth: o.depth,
      symbolId: start.id,
      symbolKey: start.key,
      body: env.payload,
      promptVersion: PROMPT_VERSION,
      model: env.model,
      refsStripped: env.refsStripped,
      capability: env.capability,
      capabilityVersion: env.version,
      claims: env.claims,
    });
    if (!stored) throw new KycError('SNAPSHOT_EXPIRED');
    emit('section', { name: 'summary', ...env.payload.summary });
    emit('section', { name: 'flowSteps', steps: env.payload.steps });
    emit('done', {
      explanationId: id,
      uncertainty: env.payload.uncertainty,
      refsStripped: env.refsStripped,
      evidence: summary(env),
    });
  }

  // ------------------------------------------------------------------ assess and grade

  async createCheck(
    ownerId: string,
    explanationId: string,
    format: 'choice' | 'open' = 'choice',
    signal?: AbortSignal,
  ) {
    const ex = await this.loadExplanation(ownerId, explanationId);
    const resolved = await resolveSelection(this.db, ex.snapshot_id, ex.selection);
    const cap = CAPABILITIES.assess;
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: ex.snapshot_id,
      selection: ex.selection,
      resolved,
      intent: 'assess',
      maxTokens: cap.budget,
      facts: null,
    });
    const env = await this.exec.run(cap, { kind: resolved.kind, format }, pack, {
      ownerId,
      snapshotId: ex.snapshot_id,
      ...(signal ? { signal } : {}),
    });
    const body = env.payload;
    const checkId = await store.insertCheck(this.db, explanationId, body);
    return {
      checkId,
      type: body.type,
      format: body.format,
      question: body.question,
      options: body.options ?? [],
    };
  }

  /**
   * Grade an answer: an option index exactly, or free text with the rubric-grading capability. Every answer is kept
   * as an attempt (P3.5).
   */
  async answerCheck(ownerId: string, checkId: string, answer: { index?: number; text?: string }) {
    const row = await store.getCheck(this.db, checkId);
    if (!row) throw new KycError('NOT_FOUND');
    if (row.owner_id !== ownerId) throw new KycError('NOT_OWNER');
    const q = row.question;
    if (answer.index !== undefined) {
      if ((q.format ?? 'choice') !== 'choice')
        throw new KycError('INVALID_REQUEST', 'This question is answered in your own words.');
      const correct = answer.index === q.correctIndex;
      const result = {
        correct,
        feedback: q.explanation,
        refs: q.answerRefs,
        correctIndex: q.correctIndex ?? null,
      };
      await store.recordAnswer(this.db, {
        checkId,
        userId: ownerId,
        answer: { answerIndex: answer.index },
        verdict: correct ? 'correct' : 'incorrect',
        score: correct ? 1 : 0,
        result,
      });
      return result;
    }
    const text = (answer.text ?? '').trim();
    const ex = await this.loadExplanation(ownerId, row.explanation_id);
    const resolved = await resolveSelection(this.db, ex.snapshot_id, ex.selection);
    const cap = CAPABILITIES.grade;
    const pack = await buildContextPack({
      db: this.db,
      snapshotId: ex.snapshot_id,
      selection: ex.selection,
      resolved,
      intent: 'assess',
      maxTokens: cap.budget,
      facts: null,
    });
    const expected =
      q.options && q.correctIndex !== undefined
        ? (q.options[q.correctIndex] ?? q.explanation)
        : q.explanation;
    const env = await this.exec.run(
      cap,
      { question: q.question, expected, explanation: q.explanation, rubric: q.rubric ?? [], answer: text },
      pack,
      { ownerId, snapshotId: ex.snapshot_id },
    );
    const g = env.payload;
    const score = g.points.length ? g.points.filter((p) => p.met).length / g.points.length : 0;
    const result = {
      correct: g.verdict === 'correct',
      verdict: g.verdict,
      score,
      points: g.points,
      feedback: g.feedback,
      refs: g.refs,
      correctIndex: q.correctIndex ?? null,
      evidence: summary(env),
    };
    await store.recordAnswer(this.db, {
      checkId,
      userId: ownerId,
      answer: { text },
      verdict: g.verdict,
      score,
      result,
    });
    return result;
  }

  /** Assessment results of a repository for its owner (P3.5). */
  async results(ownerId: string, repositoryId: string) {
    return store.assessmentResults(this.db, ownerId, repositoryId);
  }

  // ------------------------------------------------------------------ project summary

  async summarise(snapshotId: string): Promise<Overview['summary']> {
    if (!this.llm) return { status: 'unavailable', provenance: 'explained' };
    const { overview, paths } = await store.summaryInputs(this.db, snapshotId);
    const top = await topSymbols(this.db, snapshotId, 6);
    const headerFiles = [
      ...new Set([...(overview?.startingPoints ?? []).map((s) => s.path), ...top.map((t) => t.path)]),
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
      `[PROJECT_FACTS]\n${JSON.stringify(overview?.facts ?? {})}\n[FILE_LIST]\n${paths.slice(0, 120).join('\n')}`,
    );
    const env = await this.exec.run(
      CAPABILITIES.summarise_project,
      { paths },
      null,
      { ownerId: null, snapshotId },
      parts.join('\n\n'),
    );
    return { status: 'ready', ...env.payload, provenance: 'explained' };
  }
}
