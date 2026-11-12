import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CheckAnswerRequestSchema,
  CreateCheckRequestSchema,
  ExplainRequestSchema,
  FlowExplainRequestSchema,
  MessageRequestSchema,
} from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { parse } from './validate';
import { openSse } from './sse';
import { ownsRepository } from '../index/learning';
import { loadUsableSnapshot } from './routes';
import { assertUsable } from './snapshotAccess';
import { getSnapshot } from '../index/snapshots';
import type { Services } from '../services';

const IdParam = z.object({ id: z.string().uuid() });
const ConceptParam = IdParam.extend({ conceptId: z.string().regex(/^[a-zA-Z-]{1,40}$/) });

export function registerAiRoutes(app: FastifyInstance, svc: Services) {
  const { db, config, limiter, ai, identity } = svc;

  app.post('/api/v1/explanations', async (req, reply) => {
    const body = parse(ExplainRequestSchema, req.body);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('explain', ownerId, config.RATE_EXPLANATIONS_PER_HOUR, 3600_000);
    // Ownership first, then status: a stranger learns nothing about the snapshot's state.
    const snap = await getSnapshot(db, body.snapshotId);
    if (!snap) throw new KycError('NOT_FOUND');
    if (snap.ownerId !== ownerId)
      throw new KycError(
        'NOT_OWNER',
        'Only the account that imported this repository can request explanations for it.',
      );
    assertUsable(snap);
    // Validation errors (bad selection, missing file) surface as normal HTTP errors, before the stream opens.
    const prepared = await ai.prepareExplain({
      ownerId,
      snapshotId: body.snapshotId,
      selection: body.selection,
      depth: body.depth,
    });
    const sse = openSse(req, reply);
    try {
      await ai.streamExplain(prepared, sse.emit, sse.signal);
    } catch (e) {
      if (!(e instanceof KycError))
        req.log.error(
          { err: { message: (e as Error).message, stack: (e as Error).stack } },
          'explain failed',
        );
      sse.emitError(e);
    } finally {
      sse.end();
    }
  });

  /** Explain how execution flows from a symbol through its verified calls (explain_flow capability). */
  app.post('/api/v1/flows/explain', async (req, reply) => {
    const body = parse(FlowExplainRequestSchema, req.body);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('explain', ownerId, config.RATE_EXPLANATIONS_PER_HOUR, 3600_000);
    const snap = await getSnapshot(db, body.snapshotId);
    if (!snap) throw new KycError('NOT_FOUND');
    if (snap.ownerId !== ownerId)
      throw new KycError(
        'NOT_OWNER',
        'Only the account that imported this repository can request explanations for it.',
      );
    assertUsable(snap);
    const sse = openSse(req, reply);
    try {
      await ai.streamFlow(
        { ownerId, snapshotId: body.snapshotId, symbolId: body.symbolId, hops: body.hops, depth: 'default' },
        sse.emit,
        sse.signal,
      );
    } catch (e) {
      if (!(e instanceof KycError))
        req.log.error({ err: { message: (e as Error).message, stack: (e as Error).stack } }, 'flow failed');
      sse.emitError(e);
    } finally {
      sse.end();
    }
  });

  app.post('/api/v1/explanations/:id/messages', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(MessageRequestSchema, req.body);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('followup', ownerId, config.RATE_FOLLOWUPS_PER_HOUR, 3600_000);
    const ex = await ai.prepareMessage(ownerId, id); // 404 / 403 before streaming
    await loadUsableSnapshot(svc, ex.snapshot_id);
    const sse = openSse(req, reply);
    try {
      await ai.streamMessage(ownerId, id, body, sse.emit, sse.signal);
    } catch (e) {
      if (!(e instanceof KycError))
        req.log.error(
          { err: { message: (e as Error).message, stack: (e as Error).stack } },
          'message failed',
        );
      sse.emitError(e);
    } finally {
      sse.end();
    }
  });

  /** Restore an explanation and its thread (docs/05 §15, DP7 Back restores state). */
  app.get('/api/v1/explanations/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId: ownerId } = await identity.require(req, reply);
    const r = await db.query<{
      id: string;
      owner_id: string;
      snapshot_id: string | null; // null once retention has deleted the code; the history is kept
      selection: unknown;
      kind: string;
      depth: string;
      body: unknown;
      parent_id: string | null;
      refs_stripped: number;
    }>(
      'SELECT id, owner_id, snapshot_id, selection, kind, depth, body, parent_id, refs_stripped FROM explanations WHERE id=$1',
      [id],
    );
    const e = r.rows[0];
    if (!e) throw new KycError('NOT_FOUND');
    if (e.owner_id !== ownerId) throw new KycError('NOT_OWNER');
    const msgs = await db.query<{ id: string; role: string; intent: string; body: unknown }>(
      'SELECT id, role, intent, body FROM messages WHERE explanation_id=$1 ORDER BY created_at',
      [id],
    );
    return {
      id: e.id,
      snapshotId: e.snapshot_id,
      selection: e.selection,
      kind: e.kind,
      depth: e.depth,
      parentId: e.parent_id,
      body: e.body,
      refsStripped: e.refs_stripped,
      messages: msgs.rows,
    };
  });

  app.post('/api/v1/explanations/:id/checks', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('check', ownerId, 30, 3600_000);
    const { format } = parse(CreateCheckRequestSchema, req.body ?? {});
    return ai.createCheck(ownerId, id, format);
  });

  app.post('/api/v1/checks/:id/answer', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(CheckAnswerRequestSchema, req.body);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('check-answer', ownerId, 60, 3600_000);
    if (body.answerIndex === undefined && !body.text?.trim())
      throw new KycError('INVALID_REQUEST', 'Pick one of the options or write your answer.');
    // An option index is graded exactly; free text goes to the rubric-grading capability.
    return ai.answerCheck(
      ownerId,
      id,
      body.answerIndex !== undefined ? { index: body.answerIndex } : { text: body.text ?? '' },
    );
  });

  /** Assessment results for one repository: every check and every attempt (P3.5). Owner only. */
  app.get('/api/v1/repositories/:id/assessment', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId } = await identity.require(req, reply);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    return ai.results(userId, id);
  });

  /** Teach a concept with real examples from across the repository (P3.3). Owner only, like explanations. */
  app.post('/api/v1/snapshots/:id/concepts/:conceptId/teach', async (req, reply) => {
    const { id, conceptId } = parse(ConceptParam, req.params);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('explain', ownerId, config.RATE_EXPLANATIONS_PER_HOUR, 3600_000);
    const snap = await getSnapshot(db, id);
    if (!snap) throw new KycError('NOT_FOUND');
    if (snap.ownerId !== ownerId)
      throw new KycError(
        'NOT_OWNER',
        'Only the account that imported this repository can request explanations for it.',
      );
    assertUsable(snap);
    const sse = openSse(req, reply);
    try {
      await ai.streamConcept({ ownerId, snapshotId: id, conceptId }, sse.emit, sse.signal);
    } catch (e) {
      if (!(e instanceof KycError))
        req.log.error(
          { err: { message: (e as Error).message, stack: (e as Error).stack } },
          'concept failed',
        );
      sse.emitError(e);
    } finally {
      sse.end();
    }
  });
}
