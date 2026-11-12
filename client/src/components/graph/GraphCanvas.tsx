import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { layered } from './layout';

/** Confidence of a node or relationship: parser fact, likely (pattern or inference), or not followed. */
export type Prov = 'verified' | 'pattern' | 'unknown';

export interface GraphNode {
  id: string;
  label: string;
  /** Second line: a path, a count or a kind, in mono. */
  sub?: string;
  kind: 'module' | 'file' | 'symbol' | 'package' | 'database' | 'step' | 'unknown' | 'current';
  provenance?: Prov;
  /** Small marker in the corner, for example the number of notes. */
  badge?: string;
  /** Longer description, shown on hover and focus and read by screen readers. */
  hint?: string;
  /** Activating it goes one level deeper (drill down). */
  canDrill?: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** Relationship type, always written out ("imports", "calls ×3", "renders"). */
  label: string;
  provenance: Prov;
  hint?: string;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const W = 196;
const H = 46;
const PAD = 28;
const MIN_K = 0.3;
const MIN_FIT_K = 0.7;
const MAX_K = 2.5;
export const PROV_WORD: Record<Prov, string> = {
  verified: 'Verified',
  pattern: 'Likely',
  unknown: 'Not sure',
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * An interactive SVG graph for Explore: layered layout, pan (drag or arrow keys on the canvas), zoom (wheel, + and -,
 * or the buttons), fit, selectable nodes and edges, hover and focus details. Nodes use a roving tab stop: Tab reaches
 * the graph once, arrow keys move between nodes, Enter selects and Enter again opens or drills in. Line style carries
 * provenance (solid Verified, dashed Likely, dotted Not sure) next to written labels, never colour alone.
 */
export function GraphCanvas({
  label,
  nodes,
  edges,
  selectedId,
  selectedEdgeId = null,
  onSelect,
  onActivate,
  onSelectEdge,
  direction: wanted = 'auto',
  fixedRank,
  resetKey,
}: {
  label: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  selectedEdgeId?: string | null;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
  onSelectEdge?: (id: string) => void;
  /** 'auto' picks whichever of left-to-right and top-to-bottom fits the canvas at the larger, more readable size. */
  direction?: 'LR' | 'TB' | 'auto';
  fixedRank?: Map<string, number>;
  /** When this changes the graph is re-fitted (a new level or focus); otherwise the view is kept. */
  resetKey: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
  const [hover, setHover] = useState<{ id: string; kind: 'node' | 'edge' } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());

  const size = () => {
    const r = wrap.current?.getBoundingClientRect();
    return { w: r && r.width > 0 ? r.width : 800, h: r && r.height > 0 ? r.height : 480 };
  };
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    setBox(size());
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBox(size()));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitScale = (l: { width: number; height: number }, w: number, h: number) =>
    Math.min(1.2, (w - 2 * PAD) / l.width, (h - 2 * PAD) / l.height);

  const { layout, direction } = useMemo(() => {
    const make = (d: 'LR' | 'TB') =>
      layered(nodes, edges, {
        direction: d,
        nodeWidth: W,
        nodeHeight: H,
        rankGap: d === 'LR' ? 96 : 44,
        nodeGap: d === 'LR' ? 18 : 36,
        ...(fixedRank ? { fixedRank } : {}),
      });
    if (wanted !== 'auto') return { layout: make(wanted), direction: wanted };
    const lr = make('LR');
    const tb = make('TB');
    const { w, h } = box ?? { w: 800, h: 480 };
    // Prefer left-to-right unless top-to-bottom is clearly more readable in this canvas.
    return fitScale(tb, w, h) > fitScale(lr, w, h) * 1.15
      ? { layout: tb, direction: 'TB' as const }
      : { layout: lr, direction: 'LR' as const };
  }, [nodes, edges, wanted, fixedRank, box]);

  const fit = useCallback(() => {
    const { w, h } = size();
    // Never shrink below a readable size: a larger graph starts at its beginning and is panned.
    const k = Math.max(MIN_FIT_K, fitScale(layout, w, h));
    const cw = layout.width * k;
    const ch = layout.height * k;
    setView({ k, x: cw <= w - 2 * PAD ? (w - cw) / 2 : PAD, y: ch <= h - 2 * PAD ? (h - ch) / 2 : PAD });
  }, [layout]);

  // Re-fit on a new level or focus only, so selecting a node never moves the graph under the pointer.
  useLayoutEffect(() => {
    fit();
  }, [resetKey, direction]);

  // Code → graph: when the selection changes from outside, bring the node into view if it is off screen.
  useEffect(() => {
    if (!selectedId) return;
    const p = layout.positions.get(selectedId);
    if (!p) return;
    const { w, h } = size();
    setView((v) => {
      const sx = v.x + p.x * v.k;
      const sy = v.y + p.y * v.k;
      if (sx >= 0 && sy >= 0 && sx + W * v.k <= w && sy + H * v.k <= h) return v;
      return { ...v, x: w / 2 - (p.x + W / 2) * v.k, y: h / 2 - (p.y + H / 2) * v.k };
    });
  }, [selectedId, layout]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const { w, h } = size();
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const neighbours = useMemo(() => {
    const s = new Set<string>();
    const centre = hover?.kind === 'node' ? hover.id : selectedId;
    if (!centre) return s;
    s.add(centre);
    for (const e of edges) {
      if (e.from === centre) s.add(e.to);
      if (e.to === centre) s.add(e.from);
    }
    return s;
  }, [edges, selectedId, hover]);
  const focusCentre = hover?.kind === 'node' ? hover.id : selectedId;

  const tabStop =
    focusId ?? (selectedId && layout.positions.has(selectedId) ? selectedId : (nodes[0]?.id ?? null));

  const moveFocus = (from: string, key: string) => {
    const p = layout.positions.get(from);
    if (!p) return;
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
    if (!dir) return;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const [id, q] of layout.positions) {
      if (id === from) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const along = dx * dir[0]! + dy * dir[1]!;
      if (along <= 0) continue;
      const score = along + 2 * Math.abs(dx * dir[1]! + dy * dir[0]!);
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best) {
      setFocusId(best);
      nodeRefs.current.get(best)?.focus();
    }
  };

  const onNodeKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (id === selectedId && onActivate) onActivate(id);
      else onSelect(id);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(id, e.key);
    }
  };

  const onCanvasKey = (e: KeyboardEvent) => {
    const step = 40;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (pan[e.key]) {
      e.preventDefault();
      const [dx, dy] = pan[e.key]!;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (e.key === '+' || e.key === '=') zoomAt(1.2);
    else if (e.key === '-') zoomAt(1 / 1.2);
    else if (e.key === '0') fit();
  };

  const edgeGeom = (e: GraphEdge) => {
    const a = layout.positions.get(e.from);
    const b = layout.positions.get(e.to);
    if (!a || !b) return null;
    let d: string;
    let mx: number;
    let my: number;
    if (direction === 'LR') {
      if (b.rank > a.rank) {
        const x1 = a.x + W;
        const y1 = a.y + H / 2;
        const x2 = b.x;
        const y2 = b.y + H / 2;
        const c = Math.max(36, (x2 - x1) / 2);
        d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
        mx = (x1 + x2) / 2;
        my = (y1 + y2) / 2;
      } else {
        // Same rank or backwards: loop below the nodes so the arrow never crosses them.
        const x1 = a.x + W / 2;
        const y1 = a.y + H;
        const x2 = b.x + W / 2;
        const y2 = b.y + H;
        const dip = Math.max(y1, y2) + 34;
        d = `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`;
        mx = (x1 + x2) / 2;
        my = dip - 8;
      }
    } else {
      const x1 = a.x + W / 2;
      const y1 = a.y + H;
      const x2 = b.x + W / 2;
      const y2 = b.y;
      if (b.rank > a.rank) {
        const c = Math.max(20, (y2 - y1) / 2);
        d = `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`;
      } else {
        const side = Math.max(a.x, b.x) + W + 30;
        d = `M${a.x + W},${a.y + H / 2} C${side},${a.y + H / 2} ${side},${b.y + H / 2} ${b.x + W},${b.y + H / 2}`;
      }
      mx = (x1 + x2) / 2;
      my = (y1 + y2) / 2;
    }
    return { d, mx, my };
  };

  const showAllLabels = edges.length <= 12;
  const hovered =
    hover?.kind === 'node'
      ? nodes.find((n) => n.id === hover.id)
      : hover?.kind === 'edge'
        ? edges.find((e) => e.id === hover.id)
        : null;
  const hoverPos = (() => {
    if (!hover) return null;
    if (hover.kind === 'node') {
      const p = layout.positions.get(hover.id);
      return p ? { x: view.x + (p.x + W / 2) * view.k, y: view.y + (p.y + H) * view.k + 6 } : null;
    }
    const e = edges.find((x) => x.id === hover.id);
    const g = e && edgeGeom(e);
    return g ? { x: view.x + g.mx * view.k, y: view.y + g.my * view.k + 10 } : null;
  })();

  return (
    <div className="graph">
      <div
        ref={wrap}
        className="graph-canvas"
        role="group"
        aria-label={`${label}. Drag or use arrow keys to pan, + and - to zoom, 0 to fit.`}
        tabIndex={0}
        onKeyDown={onCanvasKey}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('.gnode, .gedge, .graph-controls')) return;
          drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.px;
          const dy = e.clientY - d.py;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <svg className="graph-svg" width="100%" height="100%" aria-hidden={nodes.length === 0}>
          <defs>
            <marker
              id="g-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="g-arrow" />
            </marker>
            <marker
              id="g-arrow-on"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="g-arrow-on" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {edges.map((e) => {
              const g = edgeGeom(e);
              if (!g) return null;
              const on =
                e.id === selectedEdgeId ||
                (hover?.kind === 'edge' && hover.id === e.id) ||
                (!!focusCentre && (e.from === focusCentre || e.to === focusCentre));
              const dim = !!focusCentre && !on;
              const word = PROV_WORD[e.provenance];
              return (
                <g
                  key={e.id}
                  className={`gedge prov-${e.provenance}${on ? ' on' : ''}${dim ? ' dim' : ''}${e.id === selectedEdgeId ? ' selected' : ''}`}
                  onPointerEnter={() => setHover({ id: e.id, kind: 'edge' })}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => onSelectEdge?.(e.id)}
                >
                  <path d={g.d} className="gedge-hit" />
                  <path d={g.d} className="gedge-line" markerEnd={`url(#${on ? 'g-arrow-on' : 'g-arrow'})`} />
                  {(showAllLabels || on) && (
                    <g transform={`translate(${g.mx},${g.my})`} className="gedge-label">
                      <rect
                        x={-(e.label.length * 3.4 + 8)}
                        y={-9}
                        width={e.label.length * 6.8 + 16}
                        height={18}
                        rx={4}
                      />
                      <text textAnchor="middle" dy="4">
                        {e.label}
                      </text>
                      <title>{`${e.label} (${word})${e.hint ? `: ${e.hint}` : ''}`}</title>
                    </g>
                  )}
                </g>
              );
            })}
            {nodes.map((n) => {
              const p = layout.positions.get(n.id);
              if (!p) return null;
              const selected = n.id === selectedId;
              const dim = !!focusCentre && !neighbours.has(n.id);
              const prov = n.provenance ?? 'verified';
              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(n.id, el);
                    else nodeRefs.current.delete(n.id);
                  }}
                  className={`gnode gnode-${n.kind} prov-${prov}${selected ? ' selected' : ''}${dim ? ' dim' : ''}`}
                  transform={`translate(${p.x},${p.y})`}
                  role="button"
                  tabIndex={n.id === tabStop ? 0 : -1}
                  aria-pressed={selected}
                  aria-label={`${n.label}${n.sub ? `, ${n.sub}` : ''}${n.provenance ? `, ${PROV_WORD[prov]}` : ''}${n.badge ? `, ${n.badge}` : ''}${n.canDrill ? ', can open a level deeper' : ''}`}
                  data-node={n.id}
                  onClick={() => (selected && onActivate ? onActivate(n.id) : onSelect(n.id))}
                  onKeyDown={(e) => onNodeKey(e, n.id)}
                  onFocus={() => {
                    setFocusId(n.id);
                    setHover({ id: n.id, kind: 'node' });
                  }}
                  onBlur={() => setHover(null)}
                  onPointerEnter={() => setHover({ id: n.id, kind: 'node' })}
                  onPointerLeave={() => setHover(null)}
                >
                  <rect width={W} height={H} rx={6} className="gnode-box" />
                  {n.canDrill && <path d={`M${W - 14},${H / 2 - 4} l4,4 l-4,4`} className="gnode-drill" />}
                  <text x={12} y={n.sub ? 19 : 28} className="gnode-label">
                    {clip(n.label, n.canDrill ? 23 : 25)}
                  </text>
                  {n.sub && (
                    <text x={12} y={36} className="gnode-sub">
                      {clip(n.sub, 30)}
                    </text>
                  )}
                  {n.badge && (
                    <g transform={`translate(${W - 8},-8)`} className="gnode-badge">
                      <rect
                        x={-n.badge.length * 6.5 - 10}
                        y={0}
                        width={n.badge.length * 6.5 + 14}
                        height={17}
                        rx={8}
                      />
                      <text x={-n.badge.length * 3.25 - 3} y={12} textAnchor="middle">
                        {n.badge}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {hovered && hoverPos && (
          <div className="graph-tip" role="tooltip" style={{ left: hoverPos.x, top: hoverPos.y }}>
            {'from' in hovered ? (
              <>
                <strong>{hovered.label}</strong> · {PROV_WORD[hovered.provenance]}
                {hovered.hint && <span className="graph-tip-sub">{hovered.hint}</span>}
              </>
            ) : (
              <>
                <strong>{hovered.label}</strong>
                {hovered.sub && <span className="graph-tip-sub mono">{hovered.sub}</span>}
                {hovered.hint && <span className="graph-tip-sub">{hovered.hint}</span>}
              </>
            )}
          </div>
        )}
        <div className="graph-controls">
          <button
            type="button"
            className="btn btn-small btn-quiet"
            onClick={() => zoomAt(1.2)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-small btn-quiet"
            onClick={() => zoomAt(1 / 1.2)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
      <p className="graph-legend small muted">
        <span className="legend-line prov-verified" aria-hidden="true" /> Verified
        <span className="legend-line prov-pattern" aria-hidden="true" /> Likely
        <span className="legend-line prov-unknown" aria-hidden="true" /> Not sure
        <span className="legend-sep">·</span> Arrows point to what is used
      </p>
    </div>
  );
}
