import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EventsRequestSchema,
  FeedbackRequestSchema,
  ImportRequestSchema,
  ResolveRequestSchema,
  type ImportResponse,
  type Overview,
} from '@kyc/contracts';
import { AppError } from './errors';
import { getOwner } from './owner';
import { parseRepoUrl } from '../ingestion/url';
import {
  createSnapshot,
  deleteRepository,
  findReusable,
  getSnapshot,
  toView,
  upsertRepository,
  type SnapshotRow,
} from '../index/snapshots';
import { buildTree, getFile, listFilePaths } from '../index/files';
import { getRelations, getSymbolSnapshot } from '../index/symbols';
import { resolveSelection } from '../index/resolve';
import type { Services } from '../services';

const IdParam = z.object({ id: z.string().uuid() });
const FileQuery = z.object({ path: z.string().min(1).max(1024) });

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new AppError('INVALID_REQUEST', 'That request was not valid.', {
      issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  return r.data;
}

export async function loadUsableSnapshot(svc: Services, id: string): Promise<SnapshotRow> {
  const snap = await getSnapshot(svc.db, id);
  if (!snap) throw new AppError('NOT_FOUND');
  if (snap.expiresAt.getTime() < Date.now()) throw new AppError('SNAPSHOT_EXPIRED');
  if (snap.status === 'failed')
    throw new AppError((snap.errorCode as 'INDEX_FAILED') ?? 'INDEX_FAILED', snap.errorMessage ?? undefined);
  if (snap.status !== 'ready' && snap.status !== 'ready_partial') throw new AppError('SNAPSHOT_NOT_READY');
  return snap;
}

export function registerApiRoutes(app: FastifyInstance, svc: Services) {
  const { db, config, limiter, github, runner } = svc;
  const ip = (req: FastifyRequest) => req.ip;

  app.post('/api/v1/repositories', async (req, reply): Promise<ImportResponse> => {
    const body = parse(ImportRequestSchema, req.body);
    const repo = parseRepoUrl(body.url, body.ref);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('import:owner', ownerId, config.RATE_IMPORTS_PER_HOUR, 3600_000);
    limiter.check('import:ip', ip(req), config.RATE_IMPORTS_PER_HOUR * 4, 3600_000);

    // Fail fast (FR-IMP-01: distinct message within ~3 s) before queueing any work.
    const sha = await github.probe(repo, AbortSignal.timeout(10_000));
    const repositoryId = await upsertRepository(db, ownerId, repo.owner, repo.name);
    if (sha) {
      const reuse = await findReusable(db, repositoryId, sha);
      if (reuse) {
        const snap = await getSnapshot(db, reuse);
        reply.status(202);
        return { repositoryId, snapshotId: reuse, status: snap?.status ?? 'ready', reused: true };
      }
    }
    const snapshotId = await createSnapshot(db, repositoryId, repo.ref ?? null, sha, config.RETENTION_DAYS);
    runner.enqueue(snapshotId);
    reply.status(202);
    return { repositoryId, snapshotId, status: 'queued', reused: false };
  });

  app.get('/api/v1/snapshots/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const snap = await getSnapshot(db, id);
    if (!snap) throw new AppError('NOT_FOUND');
    return toView(snap);
  });

  app.get('/api/v1/snapshots/:id/overview', async (req) => {
    const { id } = parse(IdParam, req.params);
    const snap = await loadUsableSnapshot(svc, id);
    const ov = snap.overview as (Omit<Overview, 'summary'> & { summary?: Overview['summary'] }) | null;
    if (!ov) throw new AppError('SNAPSHOT_NOT_READY');
    return { ...ov, summary: ov.summary ?? { status: 'unavailable', provenance: 'explained' } };
  });

  app.get('/api/v1/snapshots/:id/tree', async (req) => {
    const { id } = parse(IdParam, req.params);
    await loadUsableSnapshot(svc, id);
    return { root: buildTree(await listFilePaths(db, id)) };
  });

  app.get('/api/v1/snapshots/:id/file', async (req) => {
    const { id } = parse(IdParam, req.params);
    const { path } = parse(FileQuery, req.query);
    await loadUsableSnapshot(svc, id);
    const f = await getFile(db, id, path);
    if (!f) throw new AppError('FILE_NOT_FOUND');
    return f;
  });

  app.post('/api/v1/snapshots/:id/resolve', async (req) => {
    const { id } = parse(IdParam, req.params);
    const { selection } = parse(ResolveRequestSchema, req.body);
    await loadUsableSnapshot(svc, id);
    const {
      text: _t,
      identifier: _i,
      fileAnalysable: _f,
      ...out
    } = await resolveSelection(db, id, selection);
    return out;
  });

  app.get('/api/v1/symbols/:id/relations', async (req) => {
    const { id } = parse(IdParam, req.params);
    const snapshotId = await getSymbolSnapshot(db, id);
    if (!snapshotId) throw new AppError('NOT_FOUND');
    await loadUsableSnapshot(svc, snapshotId);
    const rel = await getRelations(db, snapshotId, id);
    if (!rel) throw new AppError('NOT_FOUND');
    return rel;
  });

  app.delete('/api/v1/repositories/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('delete', ownerId, 20, 3600_000);
    const r = await db.query<{ owner_id: string }>('SELECT owner_id FROM repositories WHERE id=$1', [id]);
    if (!r.rows[0]) throw new AppError('NOT_FOUND');
    if (r.rows[0].owner_id !== ownerId) throw new AppError('NOT_OWNER');
    const deletedSnapshots = await deleteRepository(db, id, 'user');
    reply.status(202);
    return { deletedSnapshots };
  });

  /** "Continue with <repo>" on the landing page (docs/05 §15): the caller's own live snapshots only. */
  app.get('/api/v1/my/snapshots', async (req, reply) => {
    const ownerId = await getOwner(db, config, req, reply);
    const r = await db.query<{
      id: string;
      repository_id: string;
      gh_owner: string;
      gh_name: string;
      status: string;
      expires_at: Date;
    }>(
      `SELECT s.id, s.repository_id, r.gh_owner, r.gh_name, s.status, s.expires_at
       FROM snapshots s JOIN repositories r ON r.id=s.repository_id
       WHERE r.owner_id=$1 AND s.expires_at > now() AND s.status IN ('ready','ready_partial')
       ORDER BY s.created_at DESC LIMIT 10`,
      [ownerId],
    );
    return {
      snapshots: r.rows.map((x) => ({
        snapshotId: x.id,
        repositoryId: x.repository_id,
        repository: { owner: x.gh_owner, name: x.gh_name },
        status: x.status,
        expiresAt: x.expires_at.toISOString(),
      })),
    };
  });

  app.post('/api/v1/feedback', async (req, reply: FastifyReply) => {
    const b = parse(FeedbackRequestSchema, req.body);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('feedback', ownerId, 300, 3600_000);
    await db.query(
      `INSERT INTO feedback (owner_id, target_type, target_id, rating, reason, comment) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (owner_id, target_type, target_id) DO UPDATE SET rating=EXCLUDED.rating, reason=EXCLUDED.reason, comment=EXCLUDED.comment`,
      [ownerId, b.targetType, b.targetId, b.rating, b.reason ?? null, b.comment ?? null],
    );
    return reply.status(204).send();
  });

  app.post('/api/v1/events', async (req, reply: FastifyReply) => {
    const b = parse(EventsRequestSchema, req.body);
    const ownerId = await getOwner(db, config, req, reply);
    limiter.check('events', ownerId, 600, 3600_000);
    for (const e of b.events) {
      await db.query('INSERT INTO events (owner_id, name, props) VALUES ($1,$2,$3)', [
        ownerId,
        e.name,
        JSON.stringify(e.props),
      ]);
    }
    return reply.status(204).send();
  });
}
