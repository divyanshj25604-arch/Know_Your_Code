import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CheckAnswerRequestSchema, ExplainRequestSchema, MessageRequestSchema } from '@kyc/contracts';
import { AppError } from './errors';
import { getOwner } from './owner';
import { openSse } from './sse';
import { loadUsableSnapshot } from './routes';
import type { Services } from '../services';

const IdParam = z.object({ id: z.string().uuid() });

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new AppError('INVALID_REQUEST', 'That request was not valid.', {
      issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  return r.data;
}

export function registerAiRoutes(app: FastifyInstance, svc: Services) {
  const { db, config, limiter, ai } = svc;

  app.post('/api/v1/explanations', async (req, reply) => {
    const body = parse(ExplainRequestSchema, req.body);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('explain', ownerId, config.RATE_EXPLANATIONS_PER_HOUR, 3600_000);
    const snap = await loadUsableSnapshot(svc, body.snapshotId);
    if (snap.ownerId !== ownerId)
      throw new AppError(
        'NOT_OWNER',
        'Only the browser that imported this repository can request explanations for it.',
      );
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
      if (!(e instanceof AppError))
        req.log.error(
          { err: { message: (e as Error).message, stack: (e as Error).stack } },
          'explain failed',
        );
      sse.emitError(e);
    } finally {
      sse.end();
    }
  });

  app.post('/api/v1/explanations/:id/messages', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(MessageRequestSchema, req.body);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('followup', ownerId, config.RATE_FOLLOWUPS_PER_HOUR, 3600_000);
    const ex = await ai.prepareMessage(ownerId, id); // 404 / 403 before streaming
    await loadUsableSnapshot(svc, ex.snapshot_id);
    const sse = openSse(req, reply);
    try {
      await ai.streamMessage(ownerId, id, body, sse.emit, sse.signal);
    } catch (e) {
      if (!(e instanceof AppError))
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
    const ownerId = await getOwner(db, config, req, reply);
    const r = await db.query<{
      id: string;
      owner_id: string;
      snapshot_id: string;
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
    if (!e) throw new AppError('NOT_FOUND');
    if (e.owner_id !== ownerId) throw new AppError('NOT_OWNER');
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
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('check', ownerId, 30, 3600_000);
    return ai.createCheck(ownerId, id);
  });

  app.post('/api/v1/checks/:id/answer', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(CheckAnswerRequestSchema, req.body);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('check-answer', ownerId, 60, 3600_000);
    if (body.answerIndex === undefined) {
      throw new AppError(
        'INVALID_REQUEST',
        'Pick one of the options. Free-text answers are not supported yet.',
      );
    }
    return ai.answerCheck(ownerId, id, body.answerIndex);
  });
}
