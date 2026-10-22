import { parentPort } from 'node:worker_threads';
import { analyse, type AnalyseOptions } from './analyse';
import type { AnalysisInput, AnalysisResult } from './types';

/**
 * Worker-thread entry: run the (CPU-heavy, synchronous-in-parts) analysis off the API's event loop.
 * Messages in:  { files, opts }   Messages out: { type: 'progress' | 'done' | 'error', ... }
 */
export interface WorkerRequest {
  files: AnalysisInput[];
  opts: Pick<AnalyseOptions, 'knownPaths' | 'aliases' | 'maxUnresolvedPerSymbol'>;
}
export type WorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

if (parentPort) {
  const port = parentPort;
  port.once('message', async (req: WorkerRequest) => {
    try {
      const result = await analyse(req.files, {
        ...req.opts,
        onProgress: (done, total) =>
          port.postMessage({ type: 'progress', done, total } satisfies WorkerMessage),
      });
      port.postMessage({ type: 'done', result } satisfies WorkerMessage);
    } catch (e) {
      port.postMessage({ type: 'error', message: (e as Error).message } satisfies WorkerMessage);
    }
  });
}
