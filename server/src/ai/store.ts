import type {
  AssessmentResults,
  CapabilityId,
  CheckBody,
  Claim,
  ConceptBody,
  Depth,
  ExplanationBody,
  Selection,
} from '@kyc/contracts';
import { withTx, type Db } from '../db/pool';

/** Persistence of AI answers (explanations, thread messages, checks). All AI SQL lives here. */

export interface ExplanationRow {
  id: string;
  snapshot_id: string | null;
  owner_id: string;
  selection: Selection;
  depth: Depth;
  body: ExplanationBody;
  symbol_id: string | null;
  kind: string;
}

export async function cachedExplanation(db: Db, snapshotId: string, cacheKey: string, ownerId: string) {
  const r = await db.query<{ id: string; body: ExplanationBody; refs_stripped: number; claims: Claim[] }>(
    `SELECT id, body, refs_stripped, claims FROM explanations WHERE snapshot_id=$1 AND cache_key=$2 AND owner_id=$3
     ORDER BY created_at DESC LIMIT 1`,
    [snapshotId, cacheKey, ownerId],
  );
  return r.rows[0] ?? null;
}

/**
 * Store an answer. Repository and commit are copied from the snapshot so the explanation stays meaningful after
 * retention deletes the snapshot. Returns false when the snapshot vanished meanwhile.
 */
export async function insertExplanation(
  db: Db,
  e: {
    id: string;
    snapshotId: string;
    ownerId: string;
    parentId: string | null;
    cacheKey: string;
    selection: Selection;
    kind: string;
    depth: Depth;
    symbolId: string | null;
    symbolKey: string | null;
    body: unknown;
    promptVersion: string;
    model: string;
    refsStripped: number;
    capability: CapabilityId;
    capabilityVersion: string;
    claims: Claim[];
  },
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO explanations (id, snapshot_id, owner_id, parent_id, cache_key, selection, kind, depth, symbol_id, body,
                               prompt_version, model, refs_stripped, symbol_key, capability, capability_version, claims,
                               repository_id, commit_sha)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, s.repository_id, s.commit_sha
     FROM snapshots s WHERE s.id = $2`,
    [
      e.id,
      e.snapshotId,
      e.ownerId,
      e.parentId,
      e.cacheKey,
      JSON.stringify(e.selection),
      e.kind,
      e.depth,
      e.symbolId,
      JSON.stringify(e.body),
      e.promptVersion,
      e.model,
      e.refsStripped,
      e.symbolKey,
      e.capability,
      e.capabilityVersion,
      JSON.stringify(e.claims),
    ],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function getExplanation(db: Db, id: string): Promise<ExplanationRow | null> {
  const r = await db.query<ExplanationRow>(
    'SELECT id, snapshot_id, owner_id, selection, depth, body, symbol_id, kind FROM explanations WHERE id=$1',
    [id],
  );
  return r.rows[0] ?? null;
}

export async function recentThread(db: Db, explanationId: string, n: number) {
  const r = await db.query<{ role: string; body: { text?: string; plain?: string } }>(
    'SELECT role, body FROM messages WHERE explanation_id=$1 ORDER BY created_at DESC LIMIT $2',
    [explanationId, n],
  );
  return r.rows
    .reverse()
    .map((m) => ({ role: m.role, text: (m.body.text ?? m.body.plain ?? '').slice(0, 600) }));
}

export async function insertMessage(
  db: Db,
  m: {
    id?: string;
    explanationId: string;
    role: 'user' | 'assistant';
    intent: 'followup' | 'concept';
    body: unknown;
    capability?: CapabilityId;
    capabilityVersion?: string;
    claims?: Claim[];
  },
): Promise<void> {
  await db.query(
    `INSERT INTO messages (id, explanation_id, role, intent, body, capability, capability_version, claims)
     VALUES (COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8)`,
    [
      m.id ?? null,
      m.explanationId,
      m.role,
      m.intent,
      JSON.stringify(m.body),
      m.capability ?? null,
      m.capabilityVersion ?? null,
      JSON.stringify(m.claims ?? []),
    ],
  );
}

/** A concept already taught for the same symbol in this snapshot (reused across the learner's explanations). */
export async function cachedConcept(db: Db, snapshotId: string, symbolId: string | null, conceptId: string) {
  const r = await db.query<{ id: string; body: ConceptBody }>(
    `SELECT m.id, m.body FROM messages m JOIN explanations e ON e.id = m.explanation_id
     WHERE e.snapshot_id=$1 AND e.symbol_id IS NOT DISTINCT FROM $2 AND m.intent='concept' AND m.body->>'concept' = $3
     LIMIT 1`,
    [snapshotId, symbolId, conceptId],
  );
  return r.rows[0] ?? null;
}

export async function insertCheck(db: Db, explanationId: string, body: CheckBody): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO check_attempts (explanation_id, question, format) VALUES ($1,$2,$3) RETURNING id`,
    [explanationId, JSON.stringify(body), body.format],
  );
  return r.rows[0]!.id;
}

export async function getCheck(db: Db, checkId: string) {
  const r = await db.query<{ id: string; explanation_id: string; question: CheckBody; owner_id: string }>(
    `SELECT c.id, c.explanation_id, c.question, e.owner_id FROM check_attempts c
     JOIN explanations e ON e.id=c.explanation_id WHERE c.id=$1`,
    [checkId],
  );
  return r.rows[0] ?? null;
}

/**
 * Record an answer as a new attempt (history is kept, P3.5) and as the check's latest answer, in one transaction.
 */
export async function recordAnswer(
  db: Db,
  a: {
    checkId: string;
    userId: string;
    answer: Record<string, unknown>;
    verdict: 'correct' | 'partly' | 'incorrect';
    score: number;
    result: unknown;
  },
): Promise<string> {
  return withTx(db, async (c) => {
    await c.query('UPDATE check_attempts SET answer=$2, result=$3 WHERE id=$1', [
      a.checkId,
      JSON.stringify(a.answer),
      JSON.stringify(a.result),
    ]);
    const r = await c.query<{ id: string }>(
      `INSERT INTO assessment_attempts (check_attempt_id, user_id, answer, verdict, score, result)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [a.checkId, a.userId, JSON.stringify(a.answer), a.verdict, a.score, JSON.stringify(a.result)],
    );
    return r.rows[0]!.id;
  });
}

/** Every check the user created in a repository with all its attempts, newest first (P3.5 results). */
export async function assessmentResults(
  db: Db,
  userId: string,
  repositoryId: string,
): Promise<AssessmentResults> {
  const checks = await db.query<{
    id: string;
    explanation_id: string;
    question: CheckBody;
    format: 'choice' | 'open';
    created_at: Date;
  }>(
    `SELECT c.id, c.explanation_id, c.question, c.format, c.created_at
     FROM check_attempts c JOIN explanations e ON e.id = c.explanation_id
     WHERE e.owner_id=$1 AND e.repository_id=$2 ORDER BY c.created_at DESC, c.id`,
    [userId, repositoryId],
  );
  const attempts = await db.query<{
    id: string;
    check_attempt_id: string;
    answer: { answerIndex?: number; text?: string };
    verdict: 'correct' | 'partly' | 'incorrect';
    score: string;
    result: { feedback?: string };
    created_at: Date;
  }>(
    `SELECT a.id, a.check_attempt_id, a.answer, a.verdict, a.score, a.result, a.created_at
     FROM assessment_attempts a WHERE a.user_id=$1 AND a.check_attempt_id = ANY($2::uuid[])
     ORDER BY a.created_at DESC, a.id`,
    [userId, checks.rows.map((c) => c.id)],
  );
  const out = checks.rows.map((c) => ({
    checkId: c.id,
    explanationId: c.explanation_id,
    question: c.question.question,
    type: c.question.type,
    format: c.format,
    createdAt: c.created_at.toISOString(),
    attempts: attempts.rows
      .filter((a) => a.check_attempt_id === c.id)
      .map((a) => ({
        id: a.id,
        answer: a.answer,
        verdict: a.verdict,
        score: Number(a.score),
        feedback: a.result.feedback ?? '',
        createdAt: a.created_at.toISOString(),
      })),
  }));
  const attempted = out.filter((c) => c.attempts.length > 0);
  // A check counts by its latest attempt.
  const latest = attempted.map((c) => c.attempts[0]!);
  return {
    summary: {
      checks: out.length,
      attempted: attempted.length,
      correct: latest.filter((a) => a.verdict === 'correct').length,
      averageScore: latest.length ? latest.reduce((s, a) => s + a.score, 0) / latest.length : null,
    },
    checks: out,
  };
}

export async function snapshotFacts(db: Db, snapshotId: string) {
  const r = await db.query<{
    overview: { facts?: { frameworks: string[]; languages: Record<string, number> } } | null;
  }>('SELECT overview FROM snapshots WHERE id=$1', [snapshotId]);
  const f = r.rows[0]?.overview?.facts;
  return f ? { frameworks: f.frameworks, languages: f.languages } : null;
}

export async function summaryInputs(db: Db, snapshotId: string) {
  const snap = await db.query<{ overview: { facts: unknown; startingPoints: { path: string }[] } | null }>(
    'SELECT overview FROM snapshots WHERE id=$1',
    [snapshotId],
  );
  const paths = (
    await db.query<{ path: string }>('SELECT path FROM files WHERE snapshot_id=$1 ORDER BY path', [
      snapshotId,
    ])
  ).rows.map((r) => r.path);
  return { overview: snap.rows[0]?.overview ?? null, paths };
}
