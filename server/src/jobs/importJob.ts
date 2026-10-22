import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { ERROR_MESSAGES, type StageInfo } from '@kyc/contracts';
import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import { AppError } from '../http/errors';
import { GitHubClient } from '../ingestion/github';
import { extractTarball, type ExtractLimits } from '../ingestion/extract';
import { runAnalysis } from '../analysis/runner';
import { readPathAliases } from '../analysis/project';
import { buildOverview } from '../analysis/overview';
import { getSnapshot, markFailed, markReady, setStages, setStatus } from '../index/snapshots';
import { insertFiles, listFilePaths, loadAnalysableFiles, loadConfigFiles } from '../index/files';
import { counts, persistAnalysis, topSymbols } from '../index/symbols';
import type { Overview } from '@kyc/contracts';

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

/** Run the full import pipeline for one queued snapshot. Never throws; failures are recorded on the snapshot. */
export async function runImport(deps: ImportDeps, snapshotId: string): Promise<void> {
  const { config, db, log } = deps;
  const snap = await getSnapshot(db, snapshotId);
  if (!snap) return;
  const stages = new Stages(snap.stages, db, snapshotId);
  const deadline = Date.now() + config.IMPORT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.IMPORT_TIMEOUT_MS);
  const checkAbort = () => {
    if (Date.now() > deadline)
      throw new AppError('INDEX_FAILED', 'Processing took too long and was stopped.');
  };
  const t0 = performance.now();
  try {
    // 1. Fetch
    await stages.start('fetching');
    const handle = await deps.github.openTarball(
      { owner: snap.owner, name: snap.name, ...(snap.ref ? { ref: snap.ref } : {}) },
      controller.signal,
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
    // 2. Filter (extraction streams the download)
    await stages.done('fetching');
    await stages.start('filtering');
    let extracted;
    try {
      extracted = await extractTarball(hashing, extractLimits(config));
    } catch (e) {
      handle.abort();
      if (controller.signal.aborted)
        throw new AppError('INDEX_FAILED', 'Downloading took too long and was stopped.');
      throw e;
    }
    checkAbort();
    const analysableCount = extracted.files.filter((f) => f.analysable).length;
    const hasJsTs = extracted.files.some((f) => f.language !== null);
    if (!hasJsTs) throw new AppError('UNSUPPORTED_LANGUAGE');
    if (analysableCount === 0 && extracted.files.every((f) => f.language === null || f.generated)) {
      throw new AppError('UNSUPPORTED_LANGUAGE');
    }
    const fileIds = await insertFiles(db, snapshotId, extracted.files);
    await stages.done('filtering');

    // 3. Analyse
    await stages.start('analysing');
    const files = await loadAnalysableFiles(db, snapshotId);
    const cfg = await loadConfigFiles(db, snapshotId);
    const aliases = readPathAliases(files, cfg);
    const result = await runAnalysis(files, {
      knownPaths: [...fileIds.keys()],
      aliases,
      checkAbort,
      onProgress: (d, t) => void stages.progress('analysing', d, t),
      mode: config.ANALYSIS_MODE,
      ...(config.ANALYSIS_WORKER_PATH ? { workerPath: config.ANALYSIS_WORKER_PATH } : {}),
      timeoutMs: Math.max(1000, deadline - Date.now()),
      maxMemoryMb: config.ANALYSIS_MAX_MEMORY_MB,
    });
    await persistAnalysis(db, snapshotId, fileIds, result);
    await stages.done('analysing');

    // 4. Overview (deterministic) + optional AI summary
    const allFiles = await listFilePaths(db, snapshotId);
    const skipped: { path: string; reason: string }[] = [
      ...extracted.skipped.map((s) => ({ path: s.path, reason: s.reason })),
      ...result.failedFiles.map((f) => ({ path: f.path, reason: f.reason })),
    ];
    const pkg = cfg.find((f) => f.path === 'package.json')?.content ?? null;
    const [c, top] = await Promise.all([counts(db, snapshotId), topSymbols(db, snapshotId, 5)]);
    const overview: Omit<Overview, 'summary'> & { summary: Overview['summary'] } = {
      ...buildOverview({ files: allFiles, packageJson: pkg, counts: c, top, skipped }),
      summary: { status: 'unavailable', provenance: 'explained' },
    };
    const finalStatus: 'ready' | 'ready_partial' = skipped.some(
      (s) => s.reason === 'parse_error' || s.reason === 'analysis_failed' || s.reason === 'total_size_limit',
    )
      ? 'ready_partial'
      : 'ready';
    if (deps.summarise) {
      await stages.start('summarising');
      await markReady(
        db,
        snapshotId,
        finalStatus,
        overview,
        skipped,
        stages.snapshot,
        handle.commitSha,
        hash.digest('hex'),
      );
      try {
        overview.summary = await deps.summarise(snapshotId);
      } catch (e) {
        log.warn({ err: (e as Error).message }, 'summary failed (non-fatal)');
        overview.summary = { status: 'failed', provenance: 'explained' };
      }
      await stages.done('summarising', overview.summary.status === 'ready' ? 'done' : 'skipped');
      await markReady(
        db,
        snapshotId,
        finalStatus,
        overview,
        skipped,
        stages.snapshot,
        handle.commitSha,
        null,
      );
    } else {
      await stages.done('summarising', 'skipped');
      await markReady(
        db,
        snapshotId,
        finalStatus,
        overview,
        skipped,
        stages.snapshot,
        handle.commitSha,
        hash.digest('hex'),
      );
    }
    log.info(
      {
        snapshotId,
        ms: Math.round(performance.now() - t0),
        files: allFiles.length,
        symbols: c.symbols,
        edges: c.edges,
        timings: result.timings,
      },
      'import complete',
    );
  } catch (e) {
    stages.failRunning();
    const app = e instanceof AppError ? e : null;
    const code = app?.code ?? 'INDEX_FAILED';
    const message = app?.message ?? ERROR_MESSAGES.INDEX_FAILED.message;
    if (!app)
      log.error(
        { err: { message: (e as Error).message, stack: (e as Error).stack }, snapshotId },
        'import failed',
      );
    else log.warn({ code, snapshotId }, 'import rejected');
    // A failed import must not leave half-indexed content behind.
    await db.query('DELETE FROM files WHERE snapshot_id=$1', [snapshotId]).catch(() => undefined);
    await markFailed(db, snapshotId, code, message, stages.snapshot).catch(() => undefined);
  } finally {
    clearTimeout(timer);
  }
}
