import type {
  FlowDetail,
  LearningPathView,
  PathItemResult,
  PathItemSubmit,
  PathsView,
  ProgressStatus,
} from '@kyc/contracts';
import {
  KycError,
  buildLearningPaths,
  itemView,
  missionMet,
  type LearningPathContent,
  type PathFunction,
} from '@kyc/core';
import { withTx, type Db, type Queryable } from '../db/pool';
import { getArchitecture } from './architecture';
import { conceptIndex } from './concepts';
import { getFlow, listFlows } from './flows';

const MAX_FLOWS = 50;

/** The learning paths a snapshot's analysis supports (P3.7). Deterministic: the same snapshot gives the same paths. */
export async function pathContent(q: Queryable, snapshotId: string): Promise<LearningPathContent[]> {
  const [architecture, concepts, list, fns] = await Promise.all([
    getArchitecture(q, snapshotId),
    conceptIndex(q, snapshotId),
    listFlows(q, snapshotId),
    q.query<{
      symbol_key: string;
      qualified_name: string;
      path: string;
      start_line: number;
      end_line: number;
      tags: string[];
    }>(
      `SELECT s.symbol_key, s.qualified_name, f.path, s.start_line, s.end_line, s.tags
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.snapshot_id=$1 AND s.kind IN ('function','method') AND s.symbol_key IS NOT NULL
       ORDER BY f.path, s.start_line`,
      [snapshotId],
    ),
  ]);
  const flows: FlowDetail[] = [];
  for (const f of list.flows.slice(0, MAX_FLOWS)) {
    const d = await getFlow(q, f.id);
    if (d) flows.push(d);
  }
  const functions: PathFunction[] = fns.rows.map((r) => ({
    key: r.symbol_key,
    name: r.qualified_name,
    path: r.path,
    startLine: r.start_line,
    endLine: r.end_line,
    tags: r.tags,
  }));
  return buildLearningPaths({ architecture, concepts, flows, functions });
}

const itemKey = (pathId: string, itemId: string) => `${pathId}/${itemId}`;

async function progressOf(q: Queryable, userId: string, repositoryId: string) {
  const r = await q.query<{ subject_kind: string; subject_key: string; status: 'started' | 'completed' }>(
    `SELECT subject_kind, subject_key, status FROM learning_progress
     WHERE user_id=$1 AND repository_id=$2 AND subject_kind IN ('path','lesson','mission','check')`,
    [userId, repositoryId],
  );
  return new Map(r.rows.map((x) => [`${x.subject_kind}:${x.subject_key}`, x.status]));
}

function toView(p: LearningPathContent, progress: Map<string, 'started' | 'completed'>): LearningPathView {
  const items = p.items.map((i) =>
    itemView(i, progress.get(`${i.kind}:${itemKey(p.id, i.id)}`) ?? 'not_started'),
  );
  const done = items.every((i) => i.status === 'completed');
  const any = items.some((i) => i.status !== 'not_started');
  const status: ProgressStatus = done ? 'completed' : any ? 'started' : 'not_started';
  return { id: p.id, level: p.level, title: p.title, summary: p.summary, status, items };
}

export async function pathsView(
  q: Queryable,
  snapshotId: string,
  userId: string,
  repositoryId: string,
): Promise<PathsView> {
  const [paths, progress] = await Promise.all([
    pathContent(q, snapshotId),
    progressOf(q, userId, repositoryId),
  ]);
  return { paths: paths.map((p) => toView(p, progress)) };
}

/** Record progress for one subject; never moves a completed subject back to started. */
async function record(
  q: Queryable,
  userId: string,
  repositoryId: string,
  kind: 'path' | 'lesson' | 'mission' | 'check',
  key: string,
  status: 'started' | 'completed',
  attempted: boolean,
) {
  await q.query(
    `INSERT INTO learning_progress (user_id, repository_id, subject_kind, subject_key, status, completed_at, attempts)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $5='completed' THEN now() END, $6)
     ON CONFLICT (user_id, repository_id, subject_kind, md5(subject_key)) DO UPDATE SET
       status = CASE WHEN learning_progress.status='completed' THEN 'completed' ELSE EXCLUDED.status END,
       completed_at = COALESCE(learning_progress.completed_at, EXCLUDED.completed_at),
       attempts = learning_progress.attempts + EXCLUDED.attempts,
       updated_at = now()`,
    [userId, repositoryId, kind, key, status, attempted ? 1 : 0],
  );
}

/**
 * Complete a lesson, or grade a mission or check exactly against the code graph, and record the result. When every
 * item of the path is complete, the path is recorded as completed too.
 */
export async function submitPathItem(
  db: Db,
  o: {
    snapshotId: string;
    repositoryId: string;
    userId: string;
    pathId: string;
    itemId: string;
    body: PathItemSubmit;
  },
): Promise<PathItemResult> {
  const paths = await pathContent(db, o.snapshotId);
  const path = paths.find((p) => p.id === o.pathId);
  const item = path?.items.find((i) => i.id === o.itemId);
  if (!path || !item) throw new KycError('NOT_FOUND', 'This learning path item was not found.');
  if (item.kind !== o.body.kind) throw new KycError('INVALID_REQUEST', `This item is a ${item.kind}.`);

  let correct = true;
  let feedback = '';
  let refs: { path: string; line: number }[] = [];
  if (item.kind === 'lesson') feedback = 'Lesson complete.';
  else if (item.kind === 'mission' && o.body.kind === 'mission') {
    correct = missionMet(item, { path: o.body.path, line: o.body.line });
    feedback = correct ? 'Found it.' : `Not this place. ${item.hint}`;
    refs = correct ? [item.answer] : [];
  } else if (item.kind === 'check' && o.body.kind === 'check') {
    if (o.body.answerIndex >= item.options.length)
      throw new KycError('INVALID_REQUEST', 'That option does not exist.');
    correct = o.body.answerIndex === item.correctIndex;
    feedback = correct
      ? `Correct. ${item.explanation}`
      : 'Not quite. Look at the code again and try once more.';
    refs = correct ? item.refs : [];
  }

  return withTx(db, async (c) => {
    await record(
      c,
      o.userId,
      o.repositoryId,
      item.kind,
      itemKey(path.id, item.id),
      correct ? 'completed' : 'started',
      item.kind !== 'lesson',
    );
    const progress = await progressOf(c, o.userId, o.repositoryId);
    const view = toView(path, progress);
    await record(
      c,
      o.userId,
      o.repositoryId,
      'path',
      path.id,
      view.status === 'completed' ? 'completed' : 'started',
      false,
    );
    const itemStatus = view.items.find((i) => i.id === item.id)!.status;
    return { correct, feedback, itemStatus, pathStatus: view.status, refs };
  });
}
