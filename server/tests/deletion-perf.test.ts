import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisResult, EdgeRow, SymbolRow } from '../src/analysis/types';
import type { Db } from '../src/db/pool';
import type { ExtractedFile } from '../src/ingestion/extract';
import { insertFiles } from '../src/index/files';
import { createSnapshot, deleteRepository, ensureOwner, upsertRepository } from '../src/index/snapshots';
import { persistAnalysis } from '../src/index/symbols';
import { testDb } from './helpers';

let db: Db;
beforeAll(() => {
  db = testDb();
});
afterAll(() => db.end());

/** A graph about the size of a mid-sized real repo (commander.js: ~5.9k symbols, ~10k edges). */
function syntheticGraph(files: number, perFile: number): { files: ExtractedFile[]; result: AnalysisResult } {
  const fs: ExtractedFile[] = [];
  const symbols: SymbolRow[] = [];
  for (let f = 0; f < files; f++) {
    const path = `src/f${f}.js`;
    fs.push({
      path,
      language: 'js',
      analysable: true,
      generated: false,
      sizeBytes: 10,
      lineCount: perFile * 3,
      content: 'x',
      redactions: 0,
    });
    for (let s = 0; s < perFile; s++) {
      symbols.push({
        key: `${path}#${s}`,
        path,
        name: `fn${s}`,
        qualifiedName: `fn${s}`,
        kind: s % 3 === 0 ? 'parameter' : 'function',
        tags: [],
        exported: false,
        signature: null,
        startLine: s * 3 + 1,
        startCol: 0,
        endLine: s * 3 + 3,
        endCol: 1,
        parentKey: s % 3 === 0 && s > 0 ? `${path}#${s - 1}` : null,
      });
    }
  }
  const edges: EdgeRow[] = [];
  for (let i = 0; i < symbols.length * 2; i++) {
    const a = symbols[(i * 7) % symbols.length]!;
    const b = symbols[(i * 13 + 5) % symbols.length]!;
    edges.push({
      type: 'calls',
      sourceKey: a.key,
      sourcePath: a.path,
      targetKey: b.key,
      targetPath: b.path,
      targetExternal: null,
      line: 1,
      provenance: 'verified',
      reason: null,
      meta: {},
    });
  }
  return {
    files: fs,
    result: {
      symbols,
      edges,
      diagnostics: [],
      failedFiles: [],
      timings: { projectMs: 0, symbolsMs: 0, edgesMs: 0 },
    },
  };
}

async function load(owner: string, name: string, files: number, perFile: number) {
  const repo = await upsertRepository(db, owner, 'acme', name);
  const snap = await createSnapshot(db, repo, null, null, 7);
  const g = syntheticGraph(files, perFile);
  const ids = await insertFiles(db, snap, g.files);
  await persistAnalysis(db, snap, ids, g.result);
  return repo;
}

describe('deleting a repository while other repositories are stored', () => {
  it('stays fast because foreign-key columns are indexed, and leaves nothing behind', async () => {
    await db.query('TRUNCATE owners, deletion_log CASCADE');
    const owner = await ensureOwner(db, null);
    // Other users' data. Without FK indexes every cascaded check scans ALL of it (quadratic), so size matters here.
    for (let i = 0; i < 8; i++) await load(owner, `other${i}`, 60, 100); // 8 x (6,000 symbols, 12,000 edges)
    const target = await load(owner, 'target', 60, 100);
    await db.query('ANALYZE');

    if (process.env.KYC_TEST_DROP_FK_INDEXES === '1') {
      // Manual proof that the test detects the problem: run once with this set and expect a failure.
      await db.query(
        'DROP INDEX IF EXISTS edges_source_symbol, edges_target_symbol, symbols_parent, symbols_file, explanations_symbol',
      );
    }

    const t = performance.now();
    await deleteRepository(db, target, 'user');
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(2000);
    expect((await db.query(`SELECT count(*)::int AS n FROM symbols`)).rows[0].n).toBe(8 * 6000); // only the others remain
    expect((await db.query(`SELECT count(*)::int AS n FROM edges`)).rows[0].n).toBe(8 * 12000);
    await db.query('TRUNCATE owners CASCADE');
  }, 120_000);
});
