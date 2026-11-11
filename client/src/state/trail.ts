import type { HistoryEntry } from '../lib/expl';

/**
 * Branching exploration trail (P2.1). Unlike a browser history, going back and then somewhere new adds a sibling
 * branch: the forward trail is never discarded. Forward follows the most recently visited child.
 */
export interface TrailNode {
  id: string;
  parentId: string | null;
  children: string[];
  /** Most recently visited child: where Forward goes. */
  lastChildId: string | null;
  entry: HistoryEntry;
  /** Server id of the explanation shown at this stop (lets a reload restore it). */
  explanationId: string | null;
}

export interface Trail {
  nodes: Record<string, TrailNode>;
  roots: string[];
  lastRootId: string | null;
  /** null: the project overview (no stop selected). */
  currentId: string | null;
}

export const emptyTrail = (): Trail => ({ nodes: {}, roots: [], lastRootId: null, currentId: null });

export type TrailAction =
  | { type: 'push'; entry: HistoryEntry }
  | { type: 'go'; id: string | null }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'patch'; id: string; fn: (e: HistoryEntry) => HistoryEntry }
  | { type: 'link'; id: string; explanationId: string }
  | { type: 'replace'; trail: Trail };

/** Mark `id` as its parent's most recently visited child, all the way up. */
function touch(t: Trail, id: string | null): Trail {
  if (id === null) return t;
  const nodes = { ...t.nodes };
  let cur: TrailNode | undefined = nodes[id];
  let lastRootId = t.lastRootId;
  while (cur) {
    if (cur.parentId === null) {
      lastRootId = cur.id;
      break;
    }
    const parent: TrailNode | undefined = nodes[cur.parentId];
    if (!parent) break;
    nodes[parent.id] = { ...parent, lastChildId: cur.id };
    cur = nodes[parent.id];
  }
  return { ...t, nodes, lastRootId };
}

export function trailReducer(t: Trail, a: TrailAction): Trail {
  switch (a.type) {
    case 'push': {
      const id = a.entry.id;
      const parentId = t.currentId;
      const node: TrailNode = {
        id,
        parentId,
        children: [],
        lastChildId: null,
        entry: a.entry,
        explanationId: null,
      };
      const nodes = { ...t.nodes, [id]: node };
      const roots = parentId === null ? [...t.roots, id] : t.roots;
      if (parentId !== null) {
        const p = nodes[parentId]!;
        nodes[parentId] = { ...p, children: [...p.children, id] };
      }
      return touch({ ...t, nodes, roots, currentId: id }, id);
    }
    case 'go':
      if (a.id !== null && !t.nodes[a.id]) return t;
      return touch({ ...t, currentId: a.id }, a.id);
    case 'back':
      return t.currentId === null ? t : { ...t, currentId: t.nodes[t.currentId]?.parentId ?? null };
    case 'forward': {
      const next = t.currentId === null ? t.lastRootId : (t.nodes[t.currentId]?.lastChildId ?? null);
      return next ? { ...t, currentId: next } : t;
    }
    case 'patch': {
      const n = t.nodes[a.id];
      return n ? { ...t, nodes: { ...t.nodes, [a.id]: { ...n, entry: a.fn(n.entry) } } } : t;
    }
    case 'link': {
      const n = t.nodes[a.id];
      return n ? { ...t, nodes: { ...t.nodes, [a.id]: { ...n, explanationId: a.explanationId } } } : t;
    }
    case 'replace':
      return a.trail;
  }
}

/** Stops from the root to the current one (the breadcrumb). */
export function trailPath(t: Trail): TrailNode[] {
  const out: TrailNode[] = [];
  let cur = t.currentId ? t.nodes[t.currentId] : undefined;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? t.nodes[cur.parentId] : undefined;
  }
  return out;
}

export const canForward = (t: Trail): boolean =>
  t.currentId === null ? t.lastRootId !== null : (t.nodes[t.currentId]?.lastChildId ?? null) !== null;

// ---------------------------------------------------------------- persistence (learner_positions.state)

export const TRAIL_STATE_VERSION = 1;
/** Bounded so the saved state stays small: the oldest stops beyond this are dropped from what is saved. */
const MAX_SAVED_NODES = 200;

interface SavedNode {
  id: string;
  parentId: string | null;
  lastChildId: string | null;
  path: string;
  line: number;
  label: string;
  relationSymbolId?: string;
  explanationId: string | null;
}

export interface SavedTrail {
  v: number;
  nodes: SavedNode[];
  roots: string[];
  lastRootId: string | null;
  currentId: string | null;
}

export function serialiseTrail(t: Trail): SavedTrail {
  // Keep the current path and the most recent other stops.
  const keep = new Set(trailPath(t).map((n) => n.id));
  for (const id of Object.keys(t.nodes).reverse()) {
    if (keep.size >= MAX_SAVED_NODES) break;
    keep.add(id);
  }
  const nodes = Object.values(t.nodes)
    .filter((n) => keep.has(n.id))
    .map((n) => ({
      id: n.id,
      parentId: n.parentId && keep.has(n.parentId) ? n.parentId : null,
      lastChildId: n.lastChildId && keep.has(n.lastChildId) ? n.lastChildId : null,
      path: n.entry.path,
      line: n.entry.line,
      label: n.entry.label,
      ...(n.entry.relationSymbolId ? { relationSymbolId: n.entry.relationSymbolId } : {}),
      explanationId: n.explanationId,
    }));
  return {
    v: TRAIL_STATE_VERSION,
    nodes,
    roots: nodes.filter((n) => n.parentId === null).map((n) => n.id),
    lastRootId: t.lastRootId && keep.has(t.lastRootId) ? t.lastRootId : null,
    currentId: t.currentId,
  };
}

const isNode = (x: unknown): x is SavedNode => {
  const n = x as SavedNode;
  return (
    !!n &&
    typeof n.id === 'string' &&
    typeof n.path === 'string' &&
    typeof n.line === 'number' &&
    typeof n.label === 'string' &&
    (n.parentId === null || typeof n.parentId === 'string')
  );
};

/** Rebuild a trail from saved state. Anything malformed or from another version yields null (start fresh). */
export function restoreTrail(raw: unknown): Trail | null {
  const s = raw as Partial<SavedTrail> | null;
  if (!s || s.v !== TRAIL_STATE_VERSION || !Array.isArray(s.nodes) || !s.nodes.every(isNode)) return null;
  const ids = new Set(s.nodes.map((n) => n.id));
  const nodes: Record<string, TrailNode> = {};
  for (const n of s.nodes) {
    nodes[n.id] = {
      id: n.id,
      parentId: n.parentId && ids.has(n.parentId) ? n.parentId : null,
      children: [],
      lastChildId: n.lastChildId && ids.has(n.lastChildId) ? n.lastChildId : null,
      entry: {
        id: n.id,
        path: n.path,
        line: n.line,
        label: n.label,
        ...(n.relationSymbolId ? { relationSymbolId: n.relationSymbolId, relations: null } : {}),
        expl: null,
      },
      explanationId: typeof n.explanationId === 'string' ? n.explanationId : null,
    };
  }
  for (const n of Object.values(nodes)) if (n.parentId) nodes[n.parentId]!.children.push(n.id);
  const currentId = s.currentId && ids.has(s.currentId) ? s.currentId : null;
  return {
    nodes,
    roots: Object.values(nodes)
      .filter((n) => n.parentId === null)
      .map((n) => n.id),
    lastRootId: s.lastRootId && ids.has(s.lastRootId) ? s.lastRootId : null,
    currentId,
  };
}
