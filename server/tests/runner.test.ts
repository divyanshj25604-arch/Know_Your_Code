import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyse } from '../src/analysis/analyse';
import { readPathAliases } from '../src/analysis/project';
import { runAnalysis } from '../src/analysis/runner';
import { analysable, loadFixture } from './fixture-loader';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, '.build', 'worker.mjs');

beforeAll(async () => {
  mkdirSync(path.dirname(workerPath), { recursive: true });
  // Compile the real worker entry (node_modules stay external so they resolve from this directory tree).
  await build({
    entryPoints: [path.join(here, '..', 'src', 'analysis', 'worker.ts')],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });
});

const input = () => {
  const all = loadFixture('express-cjs');
  return {
    files: analysable(all),
    opts: { knownPaths: all.map((f) => f.path), aliases: readPathAliases(all) },
  };
};

describe('runAnalysis', () => {
  it('produces exactly the same symbols and edges in a worker thread as inline', async () => {
    const { files, opts } = input();
    const inline = await analyse(files, opts);
    const progress: number[] = [];
    const viaWorker = await runAnalysis(files, {
      ...opts,
      mode: 'worker',
      workerPath,
      onProgress: (d) => progress.push(d),
    });
    expect(viaWorker.symbols).toEqual(inline.symbols);
    expect(viaWorker.edges).toEqual(inline.edges);
    expect(viaWorker.failedFiles).toEqual(inline.failedFiles);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('keeps the event loop responsive while a worker analyses a large input', async () => {
    const big = Array.from({ length: 400 }, (_, i) => ({
      path: `src/f${i}.ts`,
      content: Array.from(
        { length: 60 },
        (_, j) => `export function fn${i}_${j}(a: number) { return a + ${j}; }`,
      ).join('\n'),
    }));
    let maxGap = 0;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 5);
    const res = await runAnalysis(big, { mode: 'worker', workerPath, knownPaths: big.map((f) => f.path) });
    clearInterval(t);
    expect(res.symbols.length).toBeGreaterThan(20_000);
    expect(maxGap).toBeLessThan(250); // the main thread kept ticking throughout
  });

  it('terminates a worker that exceeds the time limit and reports a user-safe error', async () => {
    const big = Array.from({ length: 300 }, (_, i) => ({
      path: `f${i}.ts`,
      content: `export const x${i} = ${i};\n`.repeat(200),
    }));
    const err = await runAnalysis(big, { mode: 'worker', workerPath, timeoutMs: 30 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'INDEX_FAILED', message: 'Processing took too long and was stopped.' });
  });

  it('fails clearly when a worker is required but missing, and falls back inline in auto mode', async () => {
    const { files, opts } = input();
    await expect(
      runAnalysis(files, { ...opts, mode: 'worker', workerPath: '/nonexistent/worker.js' }),
    ).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    const res = await runAnalysis(files, { ...opts, mode: 'auto', workerPath: '/nonexistent/worker.js' });
    expect(res.symbols.length).toBeGreaterThan(0);
  });
});
