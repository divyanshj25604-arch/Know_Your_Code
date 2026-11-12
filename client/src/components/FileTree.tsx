import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TreeNode } from '@kyc/contracts';

interface Row {
  node: TreeNode;
  depth: number;
  key: string;
}

function flatten(node: TreeNode, open: Set<string>, filter: string, depth = 0, prefix = ''): Row[] {
  const out: Row[] = [];
  for (const c of node.children ?? []) {
    const key = c.type === 'dir' ? `${prefix}${c.name}/` : (c.path ?? `${prefix}${c.name}`);
    if (c.type === 'dir') {
      const kids = flatten(c, open, filter, depth + 1, key);
      if (filter && kids.length === 0) continue;
      out.push({ node: c, depth, key });
      if (filter || open.has(key)) out.push(...kids);
    } else if (!filter || (c.path ?? '').toLowerCase().includes(filter)) {
      out.push({ node: c, depth, key });
    }
  }
  return out;
}

export function FileTree({
  root,
  activePath,
  onOpen,
}: {
  root: TreeNode;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Expand the folders leading to the active file.
  useEffect(() => {
    if (!activePath) return;
    const parts = activePath.split('/');
    setOpen((prev) => {
      const next = new Set(prev);
      let acc = '';
      for (const p of parts.slice(0, -1)) {
        acc += `${p}/`;
        next.add(acc);
      }
      return next;
    });
  }, [activePath]);

  // "/" focuses the filter (docs/06 §E).
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && t && !['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const rows = useMemo(() => flatten(root, open, filter.trim().toLowerCase()), [root, open, filter]);
  const currentFocus =
    focusKey && rows.some((r) => r.key === focusKey)
      ? focusKey
      : (rows.find((r) => r.node.path === activePath)?.key ?? rows[0]?.key ?? null);

  const focusRow = (key: string) => {
    // Focus synchronously: the row is already rendered, and deferring lets rapid key presses act on a stale row.
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
    setFocusKey(key);
  };

  const onKey = (e: KeyboardEvent<HTMLLIElement>, row: Row, idx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows[idx + 1]) focusRow(rows[idx + 1]!.key);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows[idx - 1]) focusRow(rows[idx - 1]!.key);
    } else if (e.key === 'ArrowRight' && row.node.type === 'dir') {
      e.preventDefault();
      if (!open.has(row.key)) setOpen(new Set(open).add(row.key));
      else if (rows[idx + 1]) focusRow(rows[idx + 1]!.key);
    } else if (e.key === 'ArrowLeft' && row.node.type === 'dir' && open.has(row.key)) {
      e.preventDefault();
      const n = new Set(open);
      n.delete(row.key);
      setOpen(n);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(row);
    }
  };

  const activate = (row: Row) => {
    if (row.node.type === 'dir') {
      const n = new Set(open);
      if (n.has(row.key)) n.delete(row.key);
      else n.add(row.key);
      setOpen(n);
    } else if (row.node.path) onOpen(row.node.path);
  };

  return (
    <nav className="tree" aria-label="Files">
      <label className="sr-only" htmlFor="tree-filter">
        Filter files by name
      </label>
      <input
        id="tree-filter"
        ref={filterRef}
        className="tree-filter"
        type="search"
        placeholder="Filter files ( / )"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoComplete="off"
      />
      {rows.length === 0 ? (
        <p className="muted tree-empty">No files match “{filter}”.</p>
      ) : (
        <ul role="tree" ref={listRef} className="tree-list">
          {rows.map((r, i) => {
            const isDir = r.node.type === 'dir';
            const expanded = isDir ? Boolean(filter) || open.has(r.key) : undefined;
            const active = !isDir && r.node.path === activePath;
            return (
              <li
                key={r.key}
                role="treeitem"
                aria-level={r.depth + 1}
                aria-expanded={expanded}
                aria-selected={active}
                tabIndex={r.key === currentFocus ? 0 : -1}
                data-key={r.key}
                className={`tree-item${active ? ' is-active' : ''}${!isDir && r.node.analysable === false ? ' is-viewonly' : ''}`}
                style={{ paddingLeft: `${8 + r.depth * 14}px` }}
                onClick={() => {
                  setFocusKey(r.key);
                  activate(r);
                }}
                onKeyDown={(e) => onKey(e, r, i)}
                onFocus={() => setFocusKey(r.key)}
                title={r.node.path ?? r.node.name}
              >
                <span aria-hidden="true" className="tree-icon">
                  {isDir ? (expanded ? '▾' : '▸') : '·'}
                </span>
                {r.node.name}
                {!isDir && r.node.analysable === false && <span className="sr-only"> (not analysed)</span>}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
