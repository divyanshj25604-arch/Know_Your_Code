import type { AnnotationTargetKind, AnnotationView } from '@kyc/contracts';
import type { Db } from '../db/pool';

/**
 * Annotations: a learner's notes on graph entities, one repository at a time. Every query is scoped by user id, so a
 * row id alone never reaches another learner's note. Bodies are user text, stored as written and never logged.
 */
interface Row {
  id: string;
  target_kind: AnnotationTargetKind;
  target_key: string;
  target_label: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  commit_sha: string | null;
  body: string;
  created_at: Date;
  updated_at: Date;
}

const COLS =
  'id, target_kind, target_key, target_label, path, start_line, end_line, commit_sha, body, created_at, updated_at';

const view = (r: Row): AnnotationView => ({
  id: r.id,
  targetKind: r.target_kind,
  targetKey: r.target_key,
  targetLabel: r.target_label,
  path: r.path,
  startLine: r.start_line,
  endLine: r.end_line,
  commitSha: r.commit_sha,
  body: r.body,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export interface AnnotationInput {
  targetKind: AnnotationTargetKind;
  targetKey: string;
  targetLabel: string;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  commitSha: string | null;
  body: string;
}

/** The caller's annotations on one repository, most recently updated first. */
export async function listAnnotations(
  db: Db,
  userId: string,
  repositoryId: string,
): Promise<AnnotationView[]> {
  const r = await db.query<Row>(
    `SELECT ${COLS} FROM annotations WHERE user_id=$1 AND repository_id=$2
     ORDER BY updated_at DESC, created_at DESC, id`,
    [userId, repositoryId],
  );
  return r.rows.map(view);
}

/** Add a note. Several notes on the same target are allowed. The caller checks repository ownership first. */
export async function createAnnotation(
  db: Db,
  userId: string,
  repositoryId: string,
  a: AnnotationInput,
): Promise<AnnotationView> {
  const r = await db.query<Row>(
    `INSERT INTO annotations
       (user_id, repository_id, target_kind, target_key, target_label, path, start_line, end_line, commit_sha, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${COLS}`,
    [
      userId,
      repositoryId,
      a.targetKind,
      a.targetKey,
      a.targetLabel,
      a.path,
      a.startLine,
      a.endLine,
      a.commitSha,
      a.body,
    ],
  );
  return view(r.rows[0]!);
}

/** Replace the body of the caller's own note; null when it does not exist or belongs to someone else. */
export async function updateAnnotation(
  db: Db,
  userId: string,
  annotationId: string,
  body: string,
): Promise<AnnotationView | null> {
  const r = await db.query<Row>(
    `UPDATE annotations SET body=$3, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
    [annotationId, userId, body],
  );
  return r.rows[0] ? view(r.rows[0]) : null;
}

export async function deleteAnnotation(db: Db, userId: string, annotationId: string): Promise<boolean> {
  const r = await db.query('DELETE FROM annotations WHERE id=$1 AND user_id=$2', [annotationId, userId]);
  return (r.rowCount ?? 0) > 0;
}
