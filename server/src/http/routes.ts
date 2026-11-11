import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EventsRequestSchema,
  FeedbackRequestSchema,
  ImportRequestSchema,
  ResolveRequestSchema,
  type ImportResponse,
  type Overview,
  type ShareTokenResponse,
} from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { parse } from './validate';
import { assertUsable, authorizeSnapshotOwner, authorizeSnapshotRead } from './snapshotAccess';
import { parseRepoUrl } from '../ingestion/url';
import {
  createSnapshot,
  deleteRepository,
  findReusable,
  getSnapshot,
  revokeShares,
  toView,
  upsertRepository,
  type SnapshotRow,
} from '../index/snapshots';
import { buildTree, getFile, listFilePaths } from '../index/files';
import { getSymbolSnapshot } from '../index/symbols';
import { PgGraphStore } from '../index/graphStore';
import { relationsOf } from '@kyc/core';
import { resolveSelection } from '../index/resolve';
import type { Services } from '../services';
import { MAX_SHARE_TTL_HOURS } from '../auth/shareTokens';

const IdParam = z.object({ id: z.string().uuid() });
const FileQuery = z.object({ path: z.string().min(1).max(1024) });
const ShareRequest = z
  .object({ ttlHours: z.number().int().min(1).max(MAX_SHARE_TTL_HOURS).default(72) })
  .default({});

/**
 * A snapshot whose code can be served, for callers that have already authorised the request some other way (the
 * AI routes check ownership of the explanation first). Read routes use authorizeSnapshotRead instead.
 */
export async function loadUsableSnapshot(svc: Services, id: string): Promise<SnapshotRow> {
  const snap = await getSnapshot(svc.db, id);
  if (!snap) throw new KycError('NOT_FOUND');
  return assertUsable(snap);
}

export function registerApiRoutes(app: FastifyInstance, svc: Services) {
  const { db, config, limiter, github, runner, identity } = svc;
  const ip = (req: FastifyRequest) => req.ip;

  app.post('/api/v1/repositories', async (req, reply): Promise<ImportResponse> => {
    const body = parse(ImportRequestSchema, req.body);
    const repo = parseRepoUrl(body.url, body.ref);
    const { userId: ownerId } = await identity.require(req, reply);
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
    const created = await createSnapshot(db, repositoryId, repo.ref ?? null, sha, config.RETENTION_DAYS);
    reply.status(202);
    if (created.outcome === 'existing') {
      // A concurrent request for the same commit got there first: report its state, never run it twice.
      const snap = await getSnapshot(db, created.id);
      return { repositoryId, snapshotId: created.id, status: snap?.status ?? 'queued', reused: true };
    }
    runner.enqueue(created.id);
    return { repositoryId, snapshotId: created.id, status: 'queued', reused: false };
  });

  // ---------------------------------------------------------------- snapshot reads: owner or share token (P1.5)

  app.get('/api/v1/snapshots/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { snap } = await authorizeSnapshotRead(svc, req, reply, id);
    return toView(snap);
  });

  app.get('/api/v1/snapshots/:id/overview', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const snap = assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    const ov = snap.overview as (Omit<Overview, 'summary'> & { summary?: Overview['summary'] }) | null;
    if (!ov) throw new KycError('SNAPSHOT_NOT_READY');
    return { ...ov, summary: ov.summary ?? { status: 'unavailable', provenance: 'explained' } };
  });

  app.get('/api/v1/snapshots/:id/tree', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    return { root: buildTree(await listFilePaths(db, id)) };
  });

  app.get('/api/v1/snapshots/:id/file', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { path } = parse(FileQuery, req.query);
    assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    const f = await getFile(db, id, path);
    if (!f) throw new KycError('FILE_NOT_FOUND');
    return f;
  });

  app.post('/api/v1/snapshots/:id/resolve', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { selection } = parse(ResolveRequestSchema, req.body);
    assertUsable((await authorizeSnapshotRead(svc, req, reply, id)).snap);
    const {
      text: _t,
      identifier: _i,
      fileAnalysable: _f,
      ...out
    } = await resolveSelection(db, id, selection);
    return out;
  });

  /** Indirect path: a symbol id names its snapshot, which is authorised exactly like a direct read. */
  app.get('/api/v1/symbols/:id/relations', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const snapshotId = await getSymbolSnapshot(db, id);
    if (!snapshotId) throw new KycError('NOT_FOUND');
    assertUsable((await authorizeSnapshotRead(svc, req, reply, snapshotId)).snap);
    const rel = await relationsOf(new PgGraphStore(db, snapshotId), id);
    if (!rel) throw new KycError('NOT_FOUND');
    return rel;
  });

  /** Owner only: a read-only link to this snapshot, valid for up to 7 days or until revoked. */
  app.post('/api/v1/snapshots/:id/share-tokens', async (req, reply): Promise<ShareTokenResponse> => {
    const { id } = parse(IdParam, req.params);
    const { ttlHours } = parse(ShareRequest, req.body ?? {});
    const snap = assertUsable(await authorizeSnapshotOwner(svc, req, reply, id));
    limiter.check('share', snap.ownerId, 60, 3600_000);
    // Stamp strictly after the last revocation, so a link created right after revoking is never born revoked.
    const issuedAt = Math.max(Date.now(), (snap.sharesRevokedAt?.getTime() ?? 0) + 1);
    const { token, expiresAt } = svc.shares.issue(snap.id, ttlHours, issuedAt);
    reply.status(201);
    return { token, expiresAt: expiresAt.toISOString() };
  });

  /** Owner only: invalidate every share link issued for this snapshot so far. */
  app.delete('/api/v1/snapshots/:id/share-tokens', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const snap = await authorizeSnapshotOwner(svc, req, reply, id);
    await revokeShares(db, snap.id);
    return reply.status(204).send();
  });

  app.delete('/api/v1/repositories/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('delete', ownerId, 20, 3600_000);
    const r = await db.query<{ owner_id: string }>('SELECT owner_id FROM repositories WHERE id=$1', [id]);
    if (!r.rows[0]) throw new KycError('NOT_FOUND');
    if (r.rows[0].owner_id !== ownerId) throw new KycError('NOT_OWNER');
    const deletedSnapshots = await deleteRepository(db, id, 'user');
    reply.status(202);
    return { deletedSnapshots };
  });

  /** "Continue with <repo>" on the landing page (docs/05 §15): the caller's own live snapshots only. */
  app.get('/api/v1/my/snapshots', async (req, reply) => {
    const { userId: ownerId } = await identity.require(req, reply);
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
    const { userId: ownerId } = await identity.require(req, reply);
    limiter.check('feedback', ownerId, 300, 3600_000);
    // Only the owner of the thing being rated can rate it (also rejects ids that do not exist).
    const owned = await db.query(
      b.targetType === 'explanation'
        ? 'SELECT 1 FROM explanations WHERE id=$1 AND owner_id=$2'
        : b.targetType === 'message'
          ? 'SELECT 1 FROM messages m JOIN explanations e ON e.id=m.explanation_id WHERE m.id=$1 AND e.owner_id=$2'
          : 'SELECT 1 FROM check_attempts c JOIN explanations e ON e.id=c.explanation_id WHERE c.id=$1 AND e.owner_id=$2',
      [b.targetId, ownerId],
    );
    if (!owned.rowCount) throw new KycError('NOT_FOUND');
    // Exactly one typed foreign key is set (the database enforces it); target_id is derived from it.
    await db.query(
      `INSERT INTO feedback (owner_id, target_type, explanation_id, message_id, check_attempt_id, rating, reason, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (owner_id, target_type, target_id)
       DO UPDATE SET rating=EXCLUDED.rating, reason=EXCLUDED.reason, comment=EXCLUDED.comment`,
      [
        ownerId,
        b.targetType,
        b.targetType === 'explanation' ? b.targetId : null,
        b.targetType === 'message' ? b.targetId : null,
        b.targetType === 'check' ? b.targetId : null,
        b.rating,
        b.reason ?? null,
        b.comment ?? null,
      ],
    );
    return reply.status(204).send();
  });

  app.post('/api/v1/events', async (req, reply: FastifyReply) => {
    const b = parse(EventsRequestSchema, req.body);
    const { userId: ownerId } = await identity.require(req, reply);
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
