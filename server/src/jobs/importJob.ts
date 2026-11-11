import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { ERROR_MESSAGES, type Overview, type StageInfo } from '@kyc/contracts';
import type { Config } from '../config/env';
import { withTx, type Db, type Queryable } from '../db/pool';
import { KycError, readPathAliases, buildOverview, type AnalysisResult } from '@kyc/core';
import { GitHubClient } from '../ingestion/github';
import { extractTarball, type ExtractLimits, type ExtractResult } from '../ingestion/extract';
import { runAnalysis } from '../analysis/runner';
import {
  getSnapshot,
  markFailed,
  markReady,
  setStages,
  setStatus,
  type SnapshotRow,
} from '../index/snapshots';
import { insertFiles, listFilePaths } from '../index/files';
import { counts, persistAnalysis, topSymbols } from '../index/symbols';
import { completeRun, currentRun, failRun, relinkExplanationSymbols, startRun } from '../index/runs';

export interface ImportDeps {
  config: Config;
  db: Db;
  github: GitHubClient;
  log: FastifyBaseLogger;
  /** Optional hook after the deterministic index is ready (AI project summary). Failures are non-fatal. */
  summarise?: (snapshotId: string) => Promise<Overview['summary']>;
}

export function extractLimits(c: Config): ExtractLimits {
  return {
    maxAnalysableFiles: c.MAX_ANALYSABLE_FILES,
    maxAnalysableFileBytes: c.MAX_ANALYSABLE_FILE_BYTES,
    maxViewableFileBytes: c.MAX_VIEWABLE_FILE_BYTES,
    maxTotalTextBytes: c.MAX_TOTAL_TEXT_BYTES,
    maxTotalEntries: c.MAX_TOTAL_ENTRIES,
    maxUncompressedBytes: Math.max(c.MAX_TARBALL_BYTES * 6, 64 * 1024 * 1024),
  };
}

class Stages {
  private readonly list: StageInfo[];
  private started = new Map<string, number>();
  private lastWrite = 0;
  constructor(
    initial: StageInfo[],
    private readonly db: Db,
    private readonly id: string,
  ) {
    this.list = initial.map((s) => ({ ...s, state: 'pending' as const }));
  }
  get snapshot(): StageInfo[] {
    return this.list.map((s) => ({ ...s }));
  }
  async start(name: StageInfo['name']) {
    this.started.set(name, performance.now());
    const s = this.list.find((x) => x.name === name)!;
    s.state = 'running';
    await setStatus(this.db, this.id, name, this.snapshot);
  }
  async done(name: StageInfo['name'], state: 'done' | 'skipped' = 'done') {
    const s = this.list.find((x) => x.name === name)!;
    s.state = state;
    delete s.progress;
    s.ms = Math.round(performance.now() - (this.started.get(name) ?? performance.now()));
    await setStages(this.db, this.id, this.snapshot);
  }
  async progress(name: StageInfo['name'], done: number, total: number) {
    const s = this.list.find((x) => x.name === name)!;
    s.progress = { done, total };
    if (performance.now() - this.lastWrite > 400) {
      this.lastWrite = performance.now();
      await setStages(this.db, this.id, this.snapshot);
    }
  }
  failRunning() {
    for (const s of this.list) if (s.state === 'running') s.state = 'failed';
  }
}

interface RunContext {
  deps: ImportDeps;
  snap: SnapshotRow;
  /** The analysis_runs row recording this attempt. */
  runId: string;
  stages: Stages;
  deadline: number;
  signal: AbortSignal;
  checkAbort: () => void;
}

interface Fetched {
  extracted: ExtractResult;
  commitSha: string | null;
  contentHash: string;
}

const CONFIG_FILES = new Set(['tsconfig.json', 'jsconfig.json', 'package.json']);
const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Stages 1–2: download the archive and extract, filter and redact it in one stream. Nothing is written yet. */
async function fetchAndExtract(ctx: RunContext): Promise<Fetched> {
  const { deps, snap, stages, signal } = ctx;
  await stages.start('fetching');
  const handle = await deps.github.openTarball(
    { owner: snap.owner, name: snap.name, ...(snap.ref ? { ref: snap.ref } : {}) },
    signal,
  );
  const hash = createHash('sha1');
  // Hash inside the pipeline: a bare 'data' listener would start the stream flowing before extraction attaches.
  const hashing = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  handle.stream.on('error', (e) => hashing.destroy(e));
  handle.stream.pipe(hashing);
  await stages.done('fetching');
  await stages.start('filtering');
  let extracted: ExtractResult;
  try {
    extracted = await extractTarball(hashing, extractLimits(deps.config));
  } catch (e) {
    handle.abort();
    if (signal.aborted) throw new KycError('INDEX_FAILED', 'Downloading took too long and was stopped.');
    throw e;
  }
  ctx.checkAbort();
  const analysableCount = extracted.files.filter((f) => f.analysable).length;
  if (!extracted.files.some((f) => f.language !== null)) throw new KycError('UNSUPPORTED_LANGUAGE');
  if (analysableCount === 0 && extracted.files.every((f) => f.language === null || f.generated)) {
    throw new KycError('UNSUPPORTED_LANGUAGE');
  }
  await stages.done('filtering');
  return { extracted, commitSha: handle.commitSha, contentHash: hash.digest('hex') };
}

/** Stage 3: analyse the extracted (already redacted) text in the worker. Nothing is written yet. */
async function analyseExtracted(ctx: RunContext, extracted: ExtractResult): Promise<AnalysisResult> {
  const { deps, stages } = ctx;
  await stages.start('analysing');
  const files = extracted.files
    .filter((f) => f.analysable)
    .map((f) => ({ path: f.path, content: f.content }))
    .sort(byPath);
  const configFiles = extracted.files
    .filter((f) => CONFIG_FILES.has(f.path))
    .map((f) => ({ path: f.path, content: f.content }));
  return runAnalysis(files, {
    knownPaths: extracted.files.map((f) => f.path),
    aliases: readPathAliases(files, configFiles),
    checkAbort: ctx.checkAbort,
    onProgress: (d, t) => void stages.progress('analysing', d, t),
    mode: deps.config.ANALYSIS_MODE,
    ...(deps.config.ANALYSIS_WORKER_PATH ? { workerPath: deps.config.ANALYSIS_WORKER_PATH } : {}),
    timeoutMs: Math.max(1000, ctx.deadline - Date.now()),
    maxMemoryMb: deps.config.ANALYSIS_MAX_MEMORY_MB,
  });
}

type FullOverview = Omit<Overview, 'summary'> & { summary: Overview['summary'] };
type Skipped = { path: string; reason: string }[];

interface Persisted {
  overview: FullOverview;
  status: 'ready' | 'ready_partial';
  skipped: Skipped;
  files: number;
}

/**
 * Write everything one run produces in a single transaction: prior rows for this snapshot are removed first (so an
 * interrupted or repeated run can never collide with, or mix with, earlier rows), then files, symbols, edges, the
 * overview and the ready status. Readers see either the previous state or the complete new one.
 */
async function persistContent(ctx: RunContext, fetched: Fetched, result: AnalysisResult): Promise<Persisted> {
  const id = ctx.snap.id;
  const skipped: Skipped = [
    ...fetched.extracted.skipped.map((s) => ({ path: s.path, reason: s.reason })),
    ...result.failedFiles.map((f) => ({ path: f.path, reason: f.reason })),
  ];
  const status: 'ready' | 'ready_partial' = skipped.some(
    (s) => s.reason === 'parse_error' || s.reason === 'analysis_failed' || s.reason === 'total_size_limit',
  )
    ? 'ready_partial'
    : 'ready';
  const pkg = fetched.extracted.files.find((f) => f.path === 'package.json')?.content ?? null;
  return withTx(ctx.deps.db, async (c) => {
    // Earlier runs' rows go (their run records stay as history); this run's rows replace them in one step.
    await c.query('DELETE FROM files WHERE snapshot_id=$1', [id]); // cascades to symbols and edges
    const fileIds = await insertFiles(c, id, fetched.extracted.files);
    const written = await persistAnalysis(c, id, ctx.runId, fileIds, result);
    await relinkExplanationSymbols(c, id);
    const allFiles = await listFilePaths(c, id);
    const cnt = await counts(c, id);
    const top = await topSymbols(c, id, 5);
    const overview: FullOverview = {
      ...buildOverview({ files: allFiles, packageJson: pkg, counts: cnt, top, skipped }),
      summary: { status: 'unavailable', provenance: 'explained' },
    };
    await markReady(
      c,
      id,
      status,
      overview,
      skipped,
      ctx.stages.snapshot,
      fetched.commitSha,
      fetched.contentHash,
    );
    await completeRun(c, ctx.runId, id, {
      outcome: status,
      stages: ctx.stages.snapshot,
      files: allFiles.length,
      symbols: written.symbols,
      edges: written.edges,
      result,
    });
    return { overview, status, skipped, files: allFiles.length };
  });
}

/** Stage 4 (optional): AI project summary. Runs after the content is committed and can never undo it. */
async function summarise(ctx: RunContext, persisted: Persisted) {
  const { deps, stages, snap } = ctx;
  const summariseFn = deps.summarise;
  if (!summariseFn) return;
  const { overview } = persisted;
  try {
    overview.summary = await summariseFn(snap.id);
  } catch (e) {
    deps.log.warn({ err: (e as Error).message }, 'summary failed (non-fatal)');
    overview.summary = { status: 'failed', provenance: 'explained' };
  }
  await stages.done('summarising', overview.summary.status === 'ready' ? 'done' : 'skipped');
  await markReady(
    deps.db,
    snap.id,
    persisted.status,
    overview,
    persisted.skipped,
    stages.snapshot,
    null,
    null,
  );
}

/**
 * Record a failed run atomically. If the snapshot already has a good (succeeded) run, its rows were never touched:
 * the snapshot goes back to that run's state and readers keep working. Otherwise no half-indexed content survives
 * and the snapshot is marked failed. Either way the run and the job keep the cause.
 */
async function recordFailure(ctx: RunContext, e: unknown) {
  const { deps, stages, snap } = ctx;
  stages.failRunning();
  const app = e instanceof KycError ? e : null;
  const code = app?.code ?? 'INDEX_FAILED';
  const message = app?.message ?? ERROR_MESSAGES.INDEX_FAILED.message;
  const err = e instanceof Error ? e : new Error(String(e));
  const internal = `${app ? code : err.name}: ${err.message}`;
  if (!app)
    deps.log.error({ err: { message: err.message, stack: err.stack }, snapshotId: snap.id }, 'import failed');
  else deps.log.warn({ code, snapshotId: snap.id }, 'import rejected');
  try {
    await withTx(deps.db, async (c) => {
      await failRun(c, ctx.runId, code);
      const previous = await currentRun(c, snap.id);
      if (previous && previous.id !== ctx.runId) {
        await restoreRun(c, snap.id, previous, internal);
        deps.log.warn({ snapshotId: snap.id, keptRun: previous.id }, 're-analysis failed; previous run kept');
        return;
      }
      await c.query('DELETE FROM files WHERE snapshot_id=$1', [snap.id]);
      await markFailed(c, snap.id, code, message, stages.snapshot, internal);
    });
  } catch (writeErr) {
    // The database is unreachable or the snapshot vanished; the job stays "running" and recover() retries it.
    deps.log.error(
      { err: { message: (writeErr as Error).message }, snapshotId: snap.id },
      'could not record the import failure',
    );
  }
}

/** Put a snapshot back to the state its current good run produced (its rows were never modified). */
async function restoreRun(
  c: Queryable,
  snapshotId: string,
  run: { outcome: 'ready' | 'ready_partial'; stages: StageInfo[] },
  internalError: string,
) {
  await c.query(
    `UPDATE snapshots SET status=$2, stages=$3, error_code=NULL, error_message=NULL WHERE id=$1`,
    [snapshotId, run.outcome, JSON.stringify(run.stages)],
  );
  await c.query(`UPDATE jobs SET state='failed', last_error=$2, updated_at=now() WHERE snapshot_id=$1`, [
    snapshotId,
    internalError.slice(0, 500),
  ]);
}

/** Run the full import pipeline for one queued snapshot. Never throws; failures are recorded on the snapshot. */
export async function runImport(deps: ImportDeps, snapshotId: string): Promise<void> {
  const snap = await getSnapshot(deps.db, snapshotId);
  if (!snap) return;
  const runId = await startRun(deps.db, snapshotId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.config.IMPORT_TIMEOUT_MS);
  const deadline = Date.now() + deps.config.IMPORT_TIMEOUT_MS;
  const ctx: RunContext = {
    deps,
    snap,
    runId,
    stages: new Stages(snap.stages, deps.db, snapshotId),
    deadline,
    signal: controller.signal,
    checkAbort: () => {
      if (Date.now() > deadline)
        throw new KycError('INDEX_FAILED', 'Processing took too long and was stopped.');
    },
  };
  const t0 = performance.now();
  try {
    const fetched = await fetchAndExtract(ctx);
    const result = await analyseExtracted(ctx, fetched.extracted);
    await ctx.stages.done('analysing');
    if (deps.summarise) await ctx.stages.start('summarising');
    else await ctx.stages.done('summarising', 'skipped');
    const persisted = await persistContent(ctx, fetched, result);
    clearTimeout(timer);
    deps.log.info(
      {
        snapshotId,
        ms: Math.round(performance.now() - t0),
        files: persisted.files,
        symbols: result.symbols.length,
        timings: result.timings,
      },
      'import complete',
    );
    await summarise(ctx, persisted).catch((e: unknown) =>
      deps.log.error({ err: { message: (e as Error).message }, snapshotId }, 'could not store the summary'),
    );
  } catch (e) {
    await recordFailure(ctx, e);
  } finally {
    clearTimeout(timer);
  }
}
