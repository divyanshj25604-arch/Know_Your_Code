import { CONCEPT_VOCAB, type ConceptIndex } from '@kyc/contracts';
import type { Queryable } from '../db/pool';

const EXAMPLES = 6;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures?|mocks?)\/|\.(test|spec)\.[a-z]+$/i;
const label = (id: string) => id.replace(/-/g, ' ');

/**
 * Concepts shown by a snapshot's code (P3.3), from the `concept:<id>` symbol tags the analyser writes. Examples are
 * chosen one per file first (so a concept is shown across the codebase), then further examples, in path order.
 * Test files are left out.
 */
export async function conceptIndex(q: Queryable, snapshotId: string): Promise<ConceptIndex> {
  const r = await q.query<{
    tag: string;
    id: string;
    symbol_key: string | null;
    qualified_name: string;
    path: string;
    start_line: number;
  }>(
    `SELECT t.tag, s.id, s.symbol_key, s.qualified_name, f.path, s.start_line
     FROM symbols s JOIN files f ON f.id = s.file_id CROSS JOIN LATERAL unnest(s.tags) AS t(tag)
     WHERE s.snapshot_id=$1 AND t.tag LIKE 'concept:%'
     ORDER BY t.tag, f.path, s.start_line, s.id`,
    [snapshotId],
  );
  const known = new Set<string>(CONCEPT_VOCAB);
  const by = new Map<string, typeof r.rows>();
  for (const row of r.rows) {
    if (TEST_PATH.test(row.path)) continue;
    const id = row.tag.slice('concept:'.length);
    if (!known.has(id)) continue;
    const list = by.get(id);
    if (list) list.push(row);
    else by.set(id, [row]);
  }
  const concepts = [...by.entries()].map(([id, rows]) => {
    const firstPerFile = rows.filter((x, i) => rows.findIndex((y) => y.path === x.path) === i);
    const rest = rows.filter((x) => !firstPerFile.includes(x));
    return {
      id,
      label: label(id),
      count: rows.length,
      files: firstPerFile.length,
      examples: [...firstPerFile, ...rest].slice(0, EXAMPLES).map((x) => ({
        symbolId: x.id,
        symbolKey: x.symbol_key,
        name: x.qualified_name,
        path: x.path,
        line: x.start_line,
      })),
    };
  });
  // Concepts shown in more places first; ties by id.
  concepts.sort((a, b) => b.files - a.files || b.count - a.count || (a.id < b.id ? -1 : 1));
  return { concepts };
}
