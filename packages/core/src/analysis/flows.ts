import type { ClientCall, ExpressHandlerRef, ExpressModel, ExpressRoute, ExpressUse } from './express';
import type { EdgeRow, SymbolRow } from './types';

/**
 * Request flows (P3.2): for every Express route, the path a request takes through the code, from the client call
 * (when one is found) through the route, its middleware in registration order and the handler, then down the verified
 * call graph. Steps are built only from recognised patterns and resolved edges; anything the analysis cannot follow
 * is an explicit `unknown` step with a reason. A relationship is never invented.
 */

export type RequestFlowStepKind =
  'client' | 'route' | 'middleware' | 'handler' | 'call' | 'response' | 'unknown';

export interface RequestFlowStep {
  kind: RequestFlowStepKind;
  label: string;
  path: string | null;
  line: number | null;
  symbolKey: string | null;
  /** verified: a resolved call edge; pattern: a recognised framework pattern; unknown: could not be followed. */
  provenance: 'verified' | 'pattern' | 'unknown';
  /** Call depth below the handler (0 for client, route, middleware and handler steps). */
  depth: number;
  /** Plain-language reason, set for unknown steps and for library middleware. */
  reason: string | null;
  /** The call edge a verified step stands for (resolved to an edge id when persisted). */
  edge: { sourceKey: string; targetKey: string; line: number } | null;
}

export interface DiscoveredFlow {
  /** Stable within a snapshot: method, full path and where the route is registered. */
  key: string;
  method: string;
  /** Full path including mount prefixes; null when it is not a literal. */
  routePath: string | null;
  name: string;
  /** Number of client calls that match this route. */
  clients: number;
  steps: RequestFlowStep[];
}

const MAX_DEPTH = 4;
const MAX_CALL_STEPS = 24;
const MAX_UNKNOWN_PER_SYMBOL = 3;
const MAX_FLOWS = 200;

const REASON: Record<string, string> = {
  external_package:
    'code from an installed package; it is not part of this repository, so it is not followed',
  no_declaration:
    'no declaration was found in this repository (for example a method on a value whose type is not known)',
  computed_member:
    'the function is chosen at run time (computed property), so it cannot be followed statically',
  callback_parameter: 'calls a function it was given as a parameter; which one depends on the caller',
  dynamic_import: 'loaded with a dynamic import, which cannot be followed statically',
  parse_error: 'the file it comes from could not be parsed',
  dynamic_path: 'the route path is not a literal string, so the URL is not known statically',
  dynamic_url: 'the URL is not a literal string, so it cannot be matched to a route',
  not_a_function: 'this argument is not a function the analysis recognises',
  unmounted_router: 'this router is not mounted on an app anywhere the analysis can see',
};

const joinPath = (a: string, b: string) =>
  `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';

/** Whether a mount prefix applies to a full path (Express matches whole segments). */
const prefixApplies = (prefix: string, full: string) => {
  const p = prefix.replace(/\/+$/, '');
  return p === '' || full === p || full.startsWith(`${p}/`);
};

/** Whether a client URL (with `*` for template substitutions) matches a route path (with `:params`). */
export function urlMatchesRoute(url: string, route: string): boolean {
  const clean = url
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (!clean.startsWith('/') && clean !== '') return false;
  const a = clean.split('/').filter(Boolean);
  const b = route.replace(/\/+$/, '').split('/').filter(Boolean);
  if (b.at(-1) === '*') {
    if (a.length < b.length - 1) return false;
  } else if (a.length !== b.length) return false;
  return b.every((seg, i) => {
    if (seg === '*' && i === b.length - 1) return true;
    const s = a[i]!;
    if (seg.startsWith(':')) return s !== '';
    return s === seg || s === '*';
  });
}

interface Chain {
  base: string;
  /** Middleware in front of the route, outermost first, each with the absolute path prefix it applies to. */
  middleware: { use: ExpressUse; prefix: string }[];
  unmounted: boolean;
}

export function discoverFlows(model: ExpressModel, symbols: SymbolRow[], edges: EdgeRow[]): DiscoveredFlow[] {
  if (model.routes.length === 0) return [];
  const symByKey = new Map(symbols.map((s) => [s.key, s]));
  const callsBySource = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    if (e.type !== 'calls' || !e.sourceKey) continue;
    const list = callsBySource.get(e.sourceKey);
    if (list) list.push(e);
    else callsBySource.set(e.sourceKey, [e]);
  }
  const end = (e: EdgeRow) => (typeof e.meta.end === 'number' ? e.meta.end : 0);
  for (const list of callsBySource.values()) list.sort((a, b) => a.line - b.line || end(a) - end(b));
  const routers = new Map(model.routers.map((r) => [r.id, r]));
  const usesOf = (router: string) =>
    model.uses.filter((u) => u.router === router).sort((a, b) => a.order - b.order);

  /**
   * Every way a router is reached from an app: the full path prefix, and the middleware registered in front of the
   * point `cutoff` (the route, or the mount of a child router), outermost first.
   */
  const chains = (router: string, cutoff: number, seen: Set<string>): Chain[] => {
    const local = (base: string) =>
      usesOf(router)
        .filter((u) => !u.mount && u.handler && u.order < cutoff)
        .map((use) => ({ use, prefix: joinPath(base, use.prefix ?? '/') }));
    const parents = model.uses.filter((u) => u.mount === router);
    if (parents.length === 0 || seen.has(router))
      return [{ base: '', middleware: local(''), unmounted: routers.get(router)?.kind !== 'app' }];
    const out: Chain[] = [];
    for (const m of parents)
      for (const up of chains(m.router, m.order, new Set([...seen, router]))) {
        const base = joinPath(up.base, m.prefix ?? '/');
        out.push({ base, middleware: [...up.middleware, ...local(base)], unmounted: up.unmounted });
      }
    return out;
  };

  const symStep = (kind: RequestFlowStepKind, h: ExpressHandlerRef, labelPrefix = ''): RequestFlowStep => {
    const sym = h.symbolKey ? symByKey.get(h.symbolKey) : undefined;
    if (sym)
      return {
        kind,
        label: `${labelPrefix}${h.factory ? `${h.label} (created by ${sym.qualifiedName})` : sym.qualifiedName}`,
        path: sym.path,
        line: sym.startLine,
        symbolKey: sym.key,
        provenance: 'pattern',
        depth: 0,
        reason: null,
        edge: null,
      };
    if (h.external)
      return {
        kind,
        label: `${labelPrefix}${h.label}`,
        path: h.path,
        line: h.line,
        symbolKey: null,
        provenance: 'pattern',
        depth: 0,
        reason: `from the ${h.external} package; ${REASON.external_package}`,
        edge: null,
      };
    return {
      kind: 'unknown',
      label: `${labelPrefix}${h.label}`,
      path: h.path,
      line: h.line,
      symbolKey: null,
      provenance: 'unknown',
      depth: 0,
      reason: REASON[h.reason ?? 'no_declaration'] ?? h.reason,
      edge: null,
    };
  };

  /** Depth-first walk of verified calls below a function, with unresolved calls labelled. */
  const callSteps = (rootKey: string): RequestFlowStep[] => {
    const out: RequestFlowStep[] = [];
    const visited = new Set<string>([rootKey]);
    const root = symByKey.get(rootKey);
    const params = symbols
      .filter((s) => s.parentKey === rootKey && s.kind === 'parameter')
      .sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol)
      .map((s) => s.name);
    const res = params[1];
    let responded = false;
    const walk = (key: string, depth: number) => {
      const list = callsBySource.get(key) ?? [];
      const unresolved = list.filter((e) => !e.targetKey && e.reason);
      // A chained call such as `res.status(401).json` also produces `res.status`; keep the full chain only.
      const texts = unresolved.map((e) => String(e.meta.calleeText ?? ''));
      const shown = unresolved.filter(
        (e, i) => !texts.some((t, j) => j !== i && t.startsWith(`${texts[i]}(`)),
      );
      let unknowns = 0;
      for (const e of list) {
        if (out.length >= MAX_CALL_STEPS) return;
        if (e.targetKey) {
          if (visited.has(e.targetKey)) continue;
          const t = symByKey.get(e.targetKey);
          if (!t) continue;
          visited.add(e.targetKey);
          out.push({
            kind: 'call',
            label: t.qualifiedName,
            path: t.path,
            line: t.startLine,
            symbolKey: t.key,
            provenance: 'verified',
            depth,
            reason: null,
            edge: { sourceKey: key, targetKey: t.key, line: e.line },
          });
          if (depth < MAX_DEPTH) walk(t.key, depth + 1);
          continue;
        }
        if (!shown.includes(e)) continue;
        const text = String(e.meta.calleeText ?? 'a call');
        const src = symByKey.get(key);
        if (key === rootKey && res && text.startsWith(`${res}.`)) {
          if (responded) continue;
          responded = true;
          out.push({
            kind: 'response',
            label: `Sends the response (${text})`,
            path: src?.path ?? null,
            line: e.line,
            symbolKey: null,
            provenance: 'pattern',
            depth,
            reason: null,
            edge: null,
          });
          continue;
        }
        if (unknowns >= MAX_UNKNOWN_PER_SYMBOL) continue;
        unknowns++;
        out.push({
          kind: 'unknown',
          label: text,
          path: src?.path ?? null,
          line: e.line,
          symbolKey: null,
          provenance: 'unknown',
          depth,
          reason:
            e.reason === 'external_package' && e.targetExternal
              ? `from the ${e.targetExternal} package; ${REASON.external_package}`
              : (REASON[e.reason ?? ''] ?? e.reason),
          edge: null,
        });
      }
    };
    if (root) walk(rootKey, 1);
    return out;
  };

  const flows: DiscoveredFlow[] = [];
  const byKey = new Set<string>();
  const routes = [...model.routes].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.order - b.order,
  );
  for (const route of routes) {
    for (const chain of chains(route.router, route.order, new Set())) {
      if (flows.length >= MAX_FLOWS) break;
      const full = route.routePath === null ? null : joinPath(chain.base, route.routePath);
      const middleware = chain.middleware
        .filter((m) => full === null || prefixApplies(m.prefix, full))
        .map((m) => m.use);
      const key = `${route.method} ${full ?? '(dynamic)'}@${route.path}:${route.line}`;
      if (byKey.has(key)) continue;
      byKey.add(key);
      flows.push(buildFlow(route, full, chain, middleware, model.clientCalls, symStep, callSteps, key));
    }
  }
  return flows;
}

function buildFlow(
  route: ExpressRoute,
  full: string | null,
  chain: Chain,
  middleware: ExpressUse[],
  clientCalls: ClientCall[],
  symStep: (kind: RequestFlowStepKind, h: ExpressHandlerRef, prefix?: string) => RequestFlowStep,
  callSteps: (key: string) => RequestFlowStep[],
  key: string,
): DiscoveredFlow {
  const steps: RequestFlowStep[] = [];
  const name = `${route.method} ${full ?? route.routePath ?? '(dynamic path)'}`;
  const clients = full
    ? clientCalls.filter(
        (c) =>
          c.url !== null &&
          (c.method === null || c.method === route.method || route.method === 'ALL') &&
          urlMatchesRoute(c.url, full),
      )
    : [];
  for (const c of clients)
    steps.push({
      kind: 'client',
      label: `${c.client}${c.method ? ` ${c.method}` : ''} ${c.url}`,
      path: c.path,
      line: c.line,
      symbolKey: c.sourceKey,
      provenance: 'pattern',
      depth: 0,
      reason: c.method === null ? 'the request method is not a literal; matched on the URL only' : null,
      edge: null,
    });
  steps.push({
    kind: 'route',
    label: name,
    path: route.path,
    line: route.line,
    symbolKey: null,
    provenance: full === null ? 'unknown' : 'pattern',
    depth: 0,
    reason: full === null ? REASON.dynamic_path! : null,
    edge: null,
  });
  if (chain.unmounted)
    steps.push({
      kind: 'unknown',
      label: 'Router mount point',
      path: route.path,
      line: route.line,
      symbolKey: null,
      provenance: 'unknown',
      depth: 0,
      reason: `${REASON.unmounted_router}; the full URL may have a prefix`,
      edge: null,
    });
  for (const u of middleware) steps.push(symStep('middleware', u.handler!));
  const hs = route.handlers;
  for (const h of hs.slice(0, -1)) steps.push(symStep('middleware', h));
  const handler = hs.at(-1);
  if (handler) {
    const s = symStep('handler', handler);
    steps.push(s);
    if (s.kind === 'handler' && s.symbolKey && !handler.factory) steps.push(...callSteps(s.symbolKey));
  } else
    steps.push({
      kind: 'unknown',
      label: 'Handler',
      path: route.path,
      line: route.line,
      symbolKey: null,
      provenance: 'unknown',
      depth: 0,
      reason: 'no handler argument was found',
      edge: null,
    });
  return { key, method: route.method, routePath: full, name, clients: clients.length, steps };
}
