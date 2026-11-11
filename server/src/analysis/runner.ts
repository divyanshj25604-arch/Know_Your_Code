import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { KycError, analyse, type AnalyseOptions, type AnalysisInput, type AnalysisResult } from '@kyc/core';
import type { WorkerMessage, WorkerRequest } from './worker';

export interface RunOptions extends AnalyseOptions {
  mode?: 'auto' | 'worker' | 'inline';
  /** Absolute path to the compiled worker script. Defaults to ./analysis/worker.js next to the running bundle. */
  workerPath?: string;
  /** Hard wall-clock limit; the worker is terminated when it passes. */
  timeoutMs?: number;
  /** V8 old-space cap for the worker, in MB (docs/07 §10 memory bound). */
  maxMemoryMb?: number;
}

/** The configured worker (ANALYSIS_WORKER_PATH, passed in by the caller) or the one next to the running bundle. */
export function resolveWorkerPath(explicit?: string): string | null {
  const p = explicit ?? fileURLToPath(new URL('./analysis/worker.js', import.meta.url));
  return existsSync(p) ? p : null;
}

/**
 * Run the analyser in a worker thread so a large import never stalls other users' requests; fall back to the same
 * code in-process when no compiled worker exists (tsx dev, unit tests) or `mode: 'inline'` is requested.
 */
export async function runAnalysis(files: AnalysisInput[], opts: RunOptions = {}): Promise<AnalysisResult> {
  const mode = opts.mode ?? 'auto';
  const path = mode === 'inline' ? null : resolveWorkerPath(opts.workerPath);
  if (!path) {
    if (mode === 'worker') throw new KycError('INDEX_FAILED', 'Analysis worker is not available.');
    return analyse(files, opts);
  }
  return new Promise<AnalysisResult>((resolve, reject) => {
    const worker = new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: opts.maxMemoryMb ?? 2048 } });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new KycError('INDEX_FAILED', 'Processing took too long and was stopped.'))),
      opts.timeoutMs ?? 120_000,
    );
    worker.on('message', (m: WorkerMessage) => {
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total);
      else if (m.type === 'done') finish(() => resolve(m.result));
      else finish(() => reject(new KycError('INDEX_FAILED', 'Analysis failed.')));
    });
    worker.on('error', (e: Error & { code?: string }) =>
      finish(() =>
        reject(
          new KycError(
            'INDEX_FAILED',
            e.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? 'This repository is too large to analyse.'
              : 'Analysis failed.',
          ),
        ),
      ),
    );
    worker.on('exit', (code) =>
      finish(() =>
        reject(new KycError('INDEX_FAILED', code === 0 ? 'Analysis ended early.' : 'Analysis failed.')),
      ),
    );
    const req: WorkerRequest = {
      files,
      opts: {
        ...(opts.knownPaths ? { knownPaths: opts.knownPaths } : {}),
        ...(opts.aliases ? { aliases: opts.aliases } : {}),
        ...(opts.maxUnresolvedPerSymbol ? { maxUnresolvedPerSymbol: opts.maxUnresolvedPerSymbol } : {}),
      },
    };
    worker.postMessage(req);
  });
}
