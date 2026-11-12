import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BookmarkRequestSchema,
  LearnerPositionSchema,
  LearnerTrackSchema,
  type LearnerPositionsResponse,
  type TourView,
} from '@kyc/contracts';
import { KycError } from '@kyc/core';
import {
  deleteBookmark,
  getPositions,
  listBookmarks,
  ownsRepository,
  saveBookmark,
  savePosition,
} from '../index/learning';
import { buildTour } from '../index/tour';
import { getArchitecture } from '../index/architecture';
import { conceptIndex } from '../index/concepts';
import { assertUsable, authorizeSnapshotRead } from './snapshotAccess';
import type { Services } from '../services';
import { parse } from './validate';

const RepoParam = z.object({ id: z.string().uuid() });
const TrackParam = RepoParam.extend({ track: LearnerTrackSchema });
const IdParam = RepoParam;

/** Server-persisted learner position (P2.1), per repository and track. Owner only; others get 404. */
export function registerLearningRoutes(app: FastifyInstance, svc: Services) {
  const { db, identity, limiter } = svc;

  app.get('/api/v1/repositories/:id/positions', async (req, reply): Promise<LearnerPositionsResponse> => {
    const { id } = parse(RepoParam, req.params);
    const { userId } = await identity.require(req, reply);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    return getPositions(db, userId, id);
  });

  app.put('/api/v1/repositories/:id/positions/:track', async (req, reply) => {
    const { id, track } = parse(TrackParam, req.params);
    const body = parse(LearnerPositionSchema, req.body);
    const { userId } = await identity.require(req, reply);
    // Saved as the learner moves (debounced by the client); generous but bounded.
    limiter.check('position', userId, 1200, 3600_000);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    return savePosition(db, userId, id, track, body);
  });

  // ---------------------------------------------------------------- bookmarks (P3.4), owner only

  app.get('/api/v1/repositories/:id/bookmarks', async (req, reply) => {
    const { id } = parse(RepoParam, req.params);
    const { userId } = await identity.require(req, reply);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    return { bookmarks: await listBookmarks(db, userId, id) };
  });

  app.post('/api/v1/repositories/:id/bookmarks', async (req, reply) => {
    const { id } = parse(RepoParam, req.params);
    const body = parse(BookmarkRequestSchema, req.body);
    const { userId } = await identity.require(req, reply);
    limiter.check('bookmark', userId, 300, 3600_000);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    const { bookmark, created } = await saveBookmark(db, userId, id, body);
    reply.status(created ? 201 : 200);
    return bookmark;
  });

  app.delete('/api/v1/bookmarks/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId } = await identity.require(req, reply);
    if (!(await deleteBookmark(db, userId, id))) throw new KycError('NOT_FOUND');
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- guided tour (P3.4), snapshot readers

  app.get('/api/v1/snapshots/:id/tour', async (req, reply): Promise<TourView> => {
    const { id } = parse(IdParam, req.params);
    const snap = assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    return buildTour(db, snap.id, snap.overview);
  });

  // ---------------------------------------------------------------- architecture map (P3.1), snapshot readers

  app.get('/api/v1/snapshots/:id/architecture', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const snap = assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    return getArchitecture(db, snap.id);
  });

  // ---------------------------------------------------------------- concepts (P3.3), snapshot readers

  app.get('/api/v1/snapshots/:id/concepts', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const snap = assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    return conceptIndex(db, snap.id);
  });
}
