/**
 * Layered (Sugiyama-style) layout for the small, focused graphs Explore shows: cycles are broken by reversing back
 * edges, nodes are ranked by longest path, ordered within a rank by the barycentre of their neighbours, then placed
 * on a grid. Pure and deterministic, so the same graph always lands in the same place.
 */

export interface LayoutNode {
  id: string;
}
export interface LayoutEdge {
  from: string;
  to: string;
}
export interface Placed {
  x: number;
  y: number;
  rank: number;
}
export interface LayoutOptions {
  direction: 'LR' | 'TB';
  nodeWidth: number;
  nodeHeight: number;
  rankGap: number;
  nodeGap: number;
  /** Pin ranks for some nodes (a focused node in the middle, callers left, callees right). */
  fixedRank?: Map<string, number>;
}
export interface Layout {
  positions: Map<string, Placed>;
  width: number;
  height: number;
}

export function layered(nodes: LayoutNode[], edges: LayoutEdge[], o: LayoutOptions): Layout {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const es = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  // 1. Break cycles: DFS in input order; an edge to a node on the stack is reversed.
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of es) out.get(e.from)!.push(e.to);
  const state = new Map<string, 0 | 1 | 2>();
  const reversed = new Set<string>();
  const visit = (start: string) => {
    const stack: { id: string; i: number }[] = [{ id: start, i: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = out.get(top.id)![top.i++];
      if (next === undefined) {
        state.set(top.id, 2);
        stack.pop();
      } else if (state.get(next) === 1) reversed.add(`${top.id}\u0000${next}`);
      else if (!state.get(next)) {
        state.set(next, 1);
        stack.push({ id: next, i: 0 });
      }
    }
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  const dag = es.map((e) => (reversed.has(`${e.from}\u0000${e.to}`) ? { from: e.to, to: e.from } : e));

  // 2. Rank by longest path from the sources (fixed ranks win).
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  if (o.fixedRank) {
    for (const [id, r] of o.fixedRank) if (known.has(id)) rank.set(id, r);
  } else {
    for (let pass = 0; pass < ids.length; pass++) {
      let changed = false;
      for (const e of dag) {
        const r = rank.get(e.from)! + 1;
        if (r > rank.get(e.to)!) {
          rank.set(e.to, r);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  const maxRank = Math.max(0, ...rank.values());
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of ids) layers[rank.get(id)!]!.push(id);

  // 3. Order within ranks: a few barycentre sweeps, down then up.
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of dag) {
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
  }
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  index();
  const sweep = (layer: string[], ref: number) => {
    const bc = new Map<string, number>();
    for (const id of layer) {
      const ns = neighbours.get(id)!.filter((n) => rank.get(n) === ref);
      bc.set(id, ns.length ? ns.reduce((a, n) => a + pos.get(n)!, 0) / ns.length : pos.get(id)!);
    }
    layer.sort((a, b) => bc.get(a)! - bc.get(b)! || pos.get(a)! - pos.get(b)!);
    layer.forEach((id, i) => pos.set(id, i));
  };
  for (let it = 0; it < 4; it++) {
    for (let r = 1; r <= maxRank; r++) sweep(layers[r]!, r - 1);
    for (let r = maxRank - 1; r >= 0; r--) sweep(layers[r]!, r + 1);
  }
  index();

  // 4. Coordinates: ranks along the main axis, each layer centred on the cross axis.
  const along = (o.direction === 'LR' ? o.nodeWidth : o.nodeHeight) + o.rankGap;
  const across = (o.direction === 'LR' ? o.nodeHeight : o.nodeWidth) + o.nodeGap;
  const widest = Math.max(1, ...layers.map((l) => l.length));
  const positions = new Map<string, Placed>();
  layers.forEach((layer, r) => {
    const offset = ((widest - layer.length) * across) / 2;
    layer.forEach((id, i) => {
      const a = r * along;
      const c = offset + i * across;
      positions.set(id, o.direction === 'LR' ? { x: a, y: c, rank: r } : { x: c, y: a, rank: r });
    });
  });
  const mainSize = (maxRank + 1) * along - o.rankGap;
  const crossSize = widest * across - o.nodeGap;
  return {
    positions,
    width: o.direction === 'LR' ? mainSize : crossSize,
    height: o.direction === 'LR' ? crossSize : mainSize,
  };
}
