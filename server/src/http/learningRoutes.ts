import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LearnerPositionSchema, LearnerTrackSchema, type LearnerPositionsResponse } from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { getPositions, ownsRepository, savePosition } from '../index/learning';
import type { Services } from '../services';
import { parse } from './validate';

const RepoParam = z.object({ id: z.string().uuid() });
const TrackParam = RepoParam.extend({ track: LearnerTrackSchema });

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
}
