import type { TourView } from '@kyc/contracts';
import type { Db } from '../db/pool';

const MAX_STOPS = 8;

/**
 * A guided tour of one snapshot (P3.4), computed from verified facts only: where the app starts (entry points),
 * then the most-used functions in order of use. Deterministic for a snapshot. Stops carry stable symbol keys so
 * progress through them can outlive the snapshot.
 */
export async function buildTour(db: Db, snapshotId: string, overview: unknown): Promise<TourView> {
  const ov = overview as { facts?: { entryPoints?: string[] } } | null;
  const stops: TourView['stops'] = [];
  for (const path of (ov?.facts?.entryPoints ?? []).slice(0, 2)) {
    stops.push({
      path,
      line: 1,
      title: `Start here: ${path}`,
      why: 'This is an entry point: the file the application starts from.',
      symbolKey: null,
    });
  }
  const top = await db.query<{
    symbol_key: string | null;
    qualified_name: string;
    path: string;
    start_line: number;
    uses: number;
  }>(
    `SELECT s.symbol_key, s.qualified_name, f.path, s.start_line, count(*)::int AS uses
     FROM edges e JOIN symbols s ON s.id = e.target_symbol_id JOIN files f ON f.id = s.file_id
     WHERE e.snapshot_id=$1 AND e.type IN ('calls','references','route_handler')
       AND s.kind IN ('function','method','class') AND NOT ('callback' = ANY(s.tags))
       AND f.path !~* '(^|/)(tests?|__tests__|spec|specs|e2e|fixtures?|mocks?)/|\\.(test|spec)\\.[a-z]+$'
     GROUP BY s.symbol_key, s.qualified_name, f.path, s.start_line
     ORDER BY uses DESC, f.path, s.start_line LIMIT $2`,
    [snapshotId, MAX_STOPS],
  );
  for (const t of top.rows) {
    if (stops.length >= MAX_STOPS) break;
    stops.push({
      path: t.path,
      line: t.start_line,
      title: t.qualified_name,
      why: `Used from ${t.uses} place${t.uses === 1 ? '' : 's'} in the code (verified by static analysis).`,
      symbolKey: t.symbol_key,
    });
  }
  return { stops };
}
