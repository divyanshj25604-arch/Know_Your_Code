import type { FileView, TreeNode } from '@kyc/contracts';
import type { Db } from '../db/pool';
import type { ExtractedFile } from '../ingestion/extract';

export async function insertFiles(
  db: Db,
  snapshotId: string,
  files: ExtractedFile[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const BATCH = 200;
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    const r = await db.query<{ id: string; path: string }>(
      `INSERT INTO files (snapshot_id, path, language, analysable, generated, size_bytes, line_count, content)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::bool[], $5::bool[], $6::int[], $7::int[], $8::text[])
       RETURNING id, path`,
      [
        snapshotId,
        chunk.map((f) => f.path),
        chunk.map((f) => f.language),
        chunk.map((f) => f.analysable),
        chunk.map((f) => f.generated),
        chunk.map((f) => f.sizeBytes),
        chunk.map((f) => f.lineCount),
        chunk.map((f) => f.content),
      ],
    );
    for (const row of r.rows) ids.set(row.path, row.id);
  }
  return ids;
}

export async function listFilePaths(
  db: Db,
  snapshotId: string,
): Promise<{ path: string; analysable: boolean; language: string | null }[]> {
  const r = await db.query<{ path: string; analysable: boolean; language: string | null }>(
    'SELECT path, analysable, language FROM files WHERE snapshot_id=$1 ORDER BY path',
    [snapshotId],
  );
  return r.rows;
}

export function buildTree(files: { path: string; analysable: boolean }[]): TreeNode {
  const root: TreeNode = { name: '/', type: 'dir', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      cur.children ??= [];
      if (i === parts.length - 1) {
        cur.children.push({ name: part, type: 'file', path: f.path, analysable: f.analysable });
        return;
      }
      let next = cur.children.find((c) => c.type === 'dir' && c.name === part);
      if (!next) {
        next = { name: part, type: 'dir', children: [] };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (n: TreeNode) => {
    n.children?.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
    n.children?.forEach(sort);
  };
  sort(root);
  return root;
}

const VIEW_TRUNCATE_BYTES = 300 * 1024;
const VIEW_TRUNCATE_LINES = 2000;

export async function getFile(db: Db, snapshotId: string, path: string): Promise<FileView | null> {
  const r = await db.query<{
    path: string;
    language: string | null;
    line_count: number;
    content: string;
    size_bytes: number;
    generated: boolean;
    analysable: boolean;
  }>(
    'SELECT path, language, line_count, content, size_bytes, generated, analysable FROM files WHERE snapshot_id=$1 AND path=$2',
    [snapshotId, path],
  );
  const f = r.rows[0];
  if (!f) return null;
  let content = f.content;
  let truncated = false;
  if (f.size_bytes > VIEW_TRUNCATE_BYTES) {
    const lines = content.split('\n');
    if (lines.length > VIEW_TRUNCATE_LINES) {
      content = lines.slice(0, VIEW_TRUNCATE_LINES).join('\n');
      truncated = true;
    }
  }
  return {
    path: f.path,
    language: f.language,
    lines: f.line_count,
    content,
    truncated,
    generated: f.generated,
    analysable: f.analysable,
  };
}

export async function getFileContent(
  db: Db,
  snapshotId: string,
  path: string,
): Promise<{ id: string; content: string; lineCount: number } | null> {
  const r = await db.query<{ id: string; content: string; line_count: number }>(
    'SELECT id, content, line_count FROM files WHERE snapshot_id=$1 AND path=$2',
    [snapshotId, path],
  );
  return r.rows[0] ? { id: r.rows[0].id, content: r.rows[0].content, lineCount: r.rows[0].line_count } : null;
}

export async function loadAnalysableFiles(
  db: Db,
  snapshotId: string,
): Promise<{ path: string; content: string }[]> {
  const r = await db.query<{ path: string; content: string }>(
    'SELECT path, content FROM files WHERE snapshot_id=$1 AND analysable ORDER BY path',
    [snapshotId],
  );
  return r.rows;
}

export async function loadConfigFiles(
  db: Db,
  snapshotId: string,
): Promise<{ path: string; content: string }[]> {
  const r = await db.query<{ path: string; content: string }>(
    `SELECT path, content FROM files WHERE snapshot_id=$1 AND path IN ('tsconfig.json','jsconfig.json','package.json')`,
    [snapshotId],
  );
  return r.rows;
}
