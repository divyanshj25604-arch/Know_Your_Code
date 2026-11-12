import type { FastifyReply, FastifyRequest } from 'fastify';
import { KycError } from '@kyc/core';
import { getSnapshot, type SnapshotRow } from '../index/snapshots';
import type { Services } from '../services';

/** Header (or `?share=` query parameter, for links) carrying a read-only share token. */
export const SHARE_HEADER = 'x-kyc-share';

function shareTokenOf(req: FastifyRequest): string | null {
  const h = req.headers[SHARE_HEADER];
  if (typeof h === 'string' && h.length > 0) return h;
  const q = (req.query as Record<string, unknown> | undefined)?.share;
  return typeof q === 'string' && q.length > 0 ? q : null;
}

/**
 * Read access to a snapshot (P1.5): its owner, or anyone holding a valid share token for exactly this snapshot.
 * Everyone else gets NOT_FOUND — the same answer as for an id that does not exist — and it is decided before any
 * status check, so a stranger learns nothing about whether an id exists, has expired or is still processing.
 */
export async function authorizeSnapshotRead(
  svc: Services,
  req: FastifyRequest,
  reply: FastifyReply,
  snapshotId: string,
): Promise<{ snap: SnapshotRow; access: 'owner' | 'share' }> {
  const snap = await getSnapshot(svc.db, snapshotId);
  if (!snap) throw new KycError('NOT_FOUND');
  const who = await svc.identity.peek(req, reply);
  if (who && who.userId === snap.ownerId) return { snap, access: 'owner' };
  const token = shareTokenOf(req);
  if (token && svc.shares.verify(token, snap.id, snap.sharesRevokedAt)) return { snap, access: 'share' };
  throw new KycError('NOT_FOUND');
}

/** Owner-only actions on a snapshot (sharing). Non-owners get NOT_FOUND, as for reads. */
export async function authorizeSnapshotOwner(
  svc: Services,
  req: FastifyRequest,
  reply: FastifyReply,
  snapshotId: string,
): Promise<SnapshotRow> {
  const snap = await getSnapshot(svc.db, snapshotId);
  const who = await svc.identity.peek(req, reply);
  if (!snap || !who || who.userId !== snap.ownerId) throw new KycError('NOT_FOUND');
  return snap;
}

/** The snapshot's code can be served: not expired, not failed, finished processing. */
export function assertUsable(snap: SnapshotRow): SnapshotRow {
  if (snap.expiresAt.getTime() < Date.now()) throw new KycError('SNAPSHOT_EXPIRED');
  if (snap.status === 'failed')
    throw new KycError((snap.errorCode as 'INDEX_FAILED') ?? 'INDEX_FAILED', snap.errorMessage ?? undefined);
  if (snap.status !== 'ready' && snap.status !== 'ready_partial') throw new KycError('SNAPSHOT_NOT_READY');
  return snap;
}
