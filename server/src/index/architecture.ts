import type { ArchitectureView } from '@kyc/contracts';
import type { ArchitectureMap } from '@kyc/core';
import type { Queryable } from '../db/pool';

/** Store one run's module map (P3.1). Call inside the content transaction, after files are inserted. */
export async function persistArchitecture(
  q: Queryable,
  snapshotId: string,
  runId: string,
  fileIds: Map<string, string>,
  map: ArchitectureMap,
): Promise<void> {
  await q.query('DELETE FROM modules WHERE snapshot_id=$1', [snapshotId]);
  const ids = new Map<string, string>();
  for (const m of map.modules) {
    const r = await q.query<{ id: string }>(
      `INSERT INTO modules (snapshot_id, analysis_run_id, module_key, name, kind, root_path) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [snapshotId, runId, m.key, m.name, m.kind, m.root],
    );
    const id = r.rows[0]!.id;
    ids.set(m.key, id);
    const files = m.files.map((p) => fileIds.get(p)).filter((x): x is string => !!x);
    if (files.length)
      await q.query(`INSERT INTO module_files (module_id, file_id) SELECT $1, unnest($2::uuid[])`, [
        id,
        files,
      ]);
  }
  for (const d of map.dependencies) {
    const from = ids.get(d.from);
    const to = ids.get(d.to);
    if (from && to)
      await q.query(
        `INSERT INTO module_dependencies (from_module, to_module, import_count) VALUES ($1,$2,$3)`,
        [from, to, d.imports],
      );
  }
  await q.query('UPDATE analysis_runs SET monorepo=$2 WHERE id=$1', [runId, map.monorepo]);
}

/** The architecture map of a snapshot's current analysis run. */
export async function getArchitecture(q: Queryable, snapshotId: string): Promise<ArchitectureView> {
  const mods = await q.query<{
    id: string;
    module_key: string;
    name: string;
    kind: 'package' | 'directory';
    root_path: string;
    files: string[] | null;
  }>(
    `SELECT m.id, m.module_key, m.name, m.kind, m.root_path,
            array_agg(f.path ORDER BY f.path) FILTER (WHERE f.path IS NOT NULL) AS files
     FROM snapshots s JOIN modules m ON m.analysis_run_id = s.current_analysis_run_id
     LEFT JOIN module_files mf ON mf.module_id = m.id LEFT JOIN files f ON f.id = mf.file_id
     WHERE s.id=$1 GROUP BY m.id ORDER BY m.module_key`,
    [snapshotId],
  );
  const deps = await q.query<{ from_key: string; to_key: string; import_count: number }>(
    `SELECT a.module_key AS from_key, b.module_key AS to_key, d.import_count
     FROM snapshots s JOIN modules a ON a.analysis_run_id = s.current_analysis_run_id
     JOIN module_dependencies d ON d.from_module = a.id JOIN modules b ON b.id = d.to_module
     WHERE s.id=$1 ORDER BY a.module_key, b.module_key`,
    [snapshotId],
  );
  const mono = await q.query<{ monorepo: boolean | null }>(
    'SELECT r.monorepo FROM snapshots s JOIN analysis_runs r ON r.id = s.current_analysis_run_id WHERE s.id=$1',
    [snapshotId],
  );
  return {
    available: mods.rows.length > 0,
    monorepo: mono.rows[0]?.monorepo ?? false,
    modules: mods.rows.map((m) => ({
      key: m.module_key,
      name: m.name,
      kind: m.kind,
      root: m.root_path,
      files: m.files ?? [],
    })),
    dependencies: deps.rows.map((d) => ({ from: d.from_key, to: d.to_key, imports: d.import_count })),
  };
}
