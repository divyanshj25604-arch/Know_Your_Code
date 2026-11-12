import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AnnotationCreateSchema,
  AnnotationUpdateSchema,
  type AnnotationView,
  type FileGraphView,
  type FileOutlineView,
} from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { getFileGraph, getFileOutline } from '../index/fileGraph';
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from '../index/annotations';
import { ownsRepository } from '../index/learning';
import { assertUsable, authorizeSnapshotRead } from './snapshotAccess';
import type { Services } from '../services';
import { parse } from './validate';

const IdParam = z.object({ id: z.string().uuid() });
const PathQuery = z.object({ path: z.string().min(1).max(1024) });

/** Explore graphs (snapshot readers, share tokens included) and annotations (owner only; others get 404). */
export function registerGraphRoutes(app: FastifyInstance, svc: Services) {
  const { db, identity, limiter } = svc;

  // ---------------------------------------------------------------- graphs, snapshot readers

  app.get('/api/v1/snapshots/:id/file-graph', async (req, reply): Promise<FileGraphView> => {
    const { id } = parse(IdParam, req.params);
    const snap = assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    return getFileGraph(db, snap.id);
  });

  app.get('/api/v1/snapshots/:id/file-outline', async (req, reply): Promise<FileOutlineView> => {
    const { id } = parse(IdParam, req.params);
    const { path } = parse(PathQuery, req.query);
    const snap = assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    const outline = await getFileOutline(db, snap.id, path);
    if (!outline) throw new KycError('FILE_NOT_FOUND');
    return outline;
  });

  // ---------------------------------------------------------------- annotations, owner only

  app.get('/api/v1/repositories/:id/annotations', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId } = await identity.require(req, reply);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    return { annotations: await listAnnotations(db, userId, id) };
  });

  app.post('/api/v1/repositories/:id/annotations', async (req, reply): Promise<AnnotationView> => {
    const { id } = parse(IdParam, req.params);
    const body = parse(AnnotationCreateSchema, req.body);
    const { userId } = await identity.require(req, reply);
    limiter.check('annotation', userId, 300, 3600_000);
    if (!(await ownsRepository(db, userId, id))) throw new KycError('NOT_FOUND');
    reply.status(201);
    return createAnnotation(db, userId, id, body);
  });

  app.patch('/api/v1/annotations/:id', async (req, reply): Promise<AnnotationView> => {
    const { id } = parse(IdParam, req.params);
    const { body } = parse(AnnotationUpdateSchema, req.body);
    const { userId } = await identity.require(req, reply);
    limiter.check('annotation', userId, 300, 3600_000);
    const updated = await updateAnnotation(db, userId, id, body);
    if (!updated) throw new KycError('NOT_FOUND');
    return updated;
  });

  app.delete('/api/v1/annotations/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId } = await identity.require(req, reply);
    if (!(await deleteAnnotation(db, userId, id))) throw new KycError('NOT_FOUND');
    return reply.status(204).send();
  });
}
