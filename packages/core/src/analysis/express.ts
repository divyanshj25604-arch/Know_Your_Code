import { Node, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import type { SymbolRow } from './types';

/**
 * Express adapter (P3.2). Statically reads how an Express application is wired: apps and routers, `use` mounts and
 * middleware in registration order, routes with their route-level middleware and handler, and literal HTTP client
 * calls (`fetch`, `axios`). Nothing is executed. Everything here is a recognised pattern (provenance "pattern"); a
 * piece that cannot be resolved statically is kept with a reason instead of being guessed.
 */

export type ExpressUnknownReason =
  | 'external_package'
  | 'no_declaration'
  | 'dynamic_path'
  | 'dynamic_url'
  | 'not_a_function'
  | 'unmounted_router';

export interface ExpressHandlerRef {
  /** Source text of the argument (shortened), e.g. `login`, `express.json()`. */
  label: string;
  /** The function that runs, when it is a function in this repository. */
  symbolKey: string | null;
  /** For middleware created by calling a factory (`auth('admin')`), the factory's symbol. */
  factory: boolean;
  /** Package the middleware comes from, when it is not repository code (`express` for `express.json()`). */
  external: string | null;
  reason: ExpressUnknownReason | null;
  path: string;
  line: number;
}

export interface ExpressRouter {
  id: string;
  kind: 'app' | 'router';
  name: string;
  path: string;
  line: number;
}

/** One `use` call argument: a mount of another router, or a middleware. */
export interface ExpressUse {
  router: string;
  /** Source position, to order registrations within a router. */
  order: number;
  prefix: string | null;
  mount: string | null;
  handler: ExpressHandlerRef | null;
  path: string;
  line: number;
}

export interface ExpressRoute {
  router: string;
  order: number;
  method: string;
  /** Path as written on its router; null when not a literal. */
  routePath: string | null;
  /** Route-level middleware first, the handler last (as registered). */
  handlers: ExpressHandlerRef[];
  path: string;
  line: number;
}

export interface ClientCall {
  client: 'fetch' | 'axios';
  /** Upper-case method; null when it cannot be read statically. */
  method: string | null;
  /** Literal URL; template substitutions become `*`. Null when not literal. */
  url: string | null;
  sourceKey: string | null;
  path: string;
  line: number;
}

export interface ExpressModel {
  routers: ExpressRouter[];
  uses: ExpressUse[];
  routes: ExpressRoute[];
  clientCalls: ClientCall[];
}

export const emptyExpressModel = (): ExpressModel => ({ routers: [], uses: [], routes: [], clientCalls: [] });

/** What the adapter needs from the analyser (kept narrow so the analyser's internals stay private). */
export interface ExpressHelpers {
  checker: ts.TypeChecker;
  relPath(sf: SourceFile): string;
  /** Package an expression's value comes from, if it is an external package. */
  externalOrigin(expr: ts.Node): string | null;
  /** Repository file a module specifier resolves to. */
  resolveFile(spec: string, containingFileName: string): string | null;
  /** The repository function symbol a name or function node stands for. */
  functionSymbol(node: Node): SymbolRow | null;
  enclosingSymbol(node: Node): SymbolRow | null;
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const LABEL_MAX = 60;
const label = (n: Node) => {
  const t = n.getText().replace(/\s+/g, ' ');
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};
const lineOf = (n: Node) => n.getStartLineNumber();
const literal = (n: Node | undefined): string | null =>
  n && (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) ? n.getLiteralText() : null;

function requireSpec(e: Node | undefined): string | null {
  if (!e || !Node.isCallExpression(e)) return null;
  const c = e.getExpression();
  return Node.isIdentifier(c) && c.getText() === 'require' ? literal(e.getArguments()[0]) : null;
}

/** `express()` is an app; `express.Router()`, `require('express').Router()` and an imported `Router()` are routers. */
function creationKind(h: ExpressHelpers, init: Node | undefined): 'app' | 'router' | null {
  if (!init || !Node.isCallExpression(init)) return null;
  const callee = init.getExpression();
  if (h.externalOrigin(callee.compilerNode) !== 'express') return null;
  if (Node.isPropertyAccessExpression(callee)) return callee.getName() === 'Router' ? 'router' : null;
  if (Node.isIdentifier(callee)) return callee.getText() === 'Router' ? 'router' : 'app';
  return null;
}

export function extractExpress(h: ExpressHelpers, files: SourceFile[]): ExpressModel {
  const model = emptyExpressModel();
  const byDecl = new Map<ts.Node, string>();
  /** The router a file exports as a whole (`module.exports = router`, `export default router`). */
  const fileExport = new Map<string, string>();

  // 1. Apps and routers.
  for (const sf of files) {
    const p = h.relPath(sf);
    for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = vd.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;
      const kind = creationKind(h, vd.getInitializer());
      if (!kind) continue;
      const id = `${p}#${nameNode.getText()}`;
      byDecl.set(vd.compilerNode, id);
      model.routers.push({ id, kind, name: nameNode.getText(), path: p, line: lineOf(vd) });
    }
  }
  if (model.routers.length === 0 && !files.some((sf) => /\bfetch\s*\(|axios/.test(sf.getFullText())))
    return model;

  const routerOfIdent = (id: Node): string | null => {
    const sym = h.checker.getSymbolAtLocation(id.compilerNode);
    const seen = new Set<ts.Symbol>();
    let s = sym;
    for (let i = 0; s && i < 5 && !seen.has(s); i++) {
      seen.add(s);
      for (const d of s.declarations ?? []) {
        const r = byDecl.get(d);
        if (r) return r;
        // `const routes = require('./routes/auth')` or `import routes from './routes/auth'`.
        if (ts.isVariableDeclaration(d) && d.initializer && ts.isIdentifier(d.name)) {
          const init = d.initializer;
          if (
            ts.isCallExpression(init) &&
            ts.isIdentifier(init.expression) &&
            init.expression.text === 'require' &&
            init.arguments[0] &&
            ts.isStringLiteralLike(init.arguments[0])
          ) {
            const f = h.resolveFile(init.arguments[0].text, d.getSourceFile().fileName);
            const r2 = f ? fileExport.get(f) : undefined;
            if (r2) return r2;
          }
        }
        if (ts.isImportClause(d) && ts.isStringLiteral(d.parent.moduleSpecifier)) {
          const f = h.resolveFile(d.parent.moduleSpecifier.text, d.getSourceFile().fileName);
          const r2 = f ? fileExport.get(f) : undefined;
          if (r2) return r2;
        }
      }
      if (s.flags & ts.SymbolFlags.Alias) {
        try {
          s = h.checker.getAliasedSymbol(s);
        } catch {
          break;
        }
      } else break;
    }
    return null;
  };

  const routerOf = (e: Node | undefined): string | null => {
    if (!e) return null;
    if (Node.isIdentifier(e)) return routerOfIdent(e);
    const spec = requireSpec(e);
    if (spec) {
      const f = h.resolveFile(spec, e.getSourceFile().getFilePath());
      return f ? (fileExport.get(f) ?? null) : null;
    }
    return null;
  };

  // 2. Which router each file exports.
  for (const sf of files) {
    const p = h.relPath(sf);
    for (const st of sf.getStatements()) {
      let target: Node | undefined;
      if (Node.isExpressionStatement(st)) {
        const e = st.getExpression();
        if (
          Node.isBinaryExpression(e) &&
          e.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          e.getLeft().getText() === 'module.exports'
        )
          target = e.getRight();
      } else if (Node.isExportAssignment(st)) target = st.getExpression();
      const r = target && Node.isIdentifier(target) ? routerOfIdent(target) : null;
      if (r) fileExport.set(p, r);
    }
  }

  const handlerRef = (arg: Node, p: string): ExpressHandlerRef => {
    const base = {
      label: label(arg),
      path: p,
      line: lineOf(arg),
      factory: false,
      external: null,
      reason: null,
    };
    if (
      Node.isArrowFunction(arg) ||
      Node.isFunctionExpression(arg) ||
      Node.isIdentifier(arg) ||
      Node.isPropertyAccessExpression(arg)
    ) {
      const sym = h.functionSymbol(arg);
      if (sym) return { ...base, symbolKey: sym.key };
      const ext = h.externalOrigin(arg.compilerNode);
      if (ext) return { ...base, symbolKey: null, external: ext, reason: 'external_package' };
      return { ...base, symbolKey: null, reason: 'no_declaration' };
    }
    if (Node.isCallExpression(arg)) {
      const callee = arg.getExpression();
      const ext = h.externalOrigin(callee.compilerNode);
      if (ext) return { ...base, symbolKey: null, external: ext, reason: 'external_package' };
      const sym = h.functionSymbol(callee);
      if (sym) return { ...base, symbolKey: sym.key, factory: true };
      return { ...base, symbolKey: null, reason: 'no_declaration' };
    }
    return { ...base, symbolKey: null, reason: 'not_a_function' };
  };

  // 3. use / verb / route(...).verb registrations, and client calls.
  for (const sf of files) {
    const p = h.relPath(sf);
    sf.forEachDescendant((n) => {
      if (!Node.isCallExpression(n)) return;
      const callee = n.getExpression();
      clientCall(h, n, p, model);
      if (!Node.isPropertyAccessExpression(callee)) return;
      const method = callee.getName();
      if (method !== 'use' && !VERBS.has(method)) return;
      const recv = callee.getExpression();
      let router = routerOf(recv);
      let routePath: string | null = null;
      let chained = false;
      // router.route('/x').get(handler)
      if (!router && Node.isCallExpression(recv)) {
        const rc = recv.getExpression();
        if (Node.isPropertyAccessExpression(rc) && rc.getName() === 'route') {
          router = routerOf(rc.getExpression());
          routePath = literal(recv.getArguments()[0]);
          chained = true;
        }
      }
      if (!router) return;
      const args = n.getArguments();
      if (method === 'use') {
        if (chained) return;
        const prefix = literal(args[0]);
        for (const a of args.slice(prefix !== null ? 1 : 0)) {
          const child = routerOf(a);
          model.uses.push({
            router,
            order: a.getStart(),
            prefix,
            mount: child,
            handler: child ? null : handlerRef(a, p),
            path: p,
            line: lineOf(a),
          });
        }
        return;
      }
      if (!chained) {
        // app.get('setting') reads a setting; a route has a path argument and at least one handler.
        if (args.length < 2) return;
        routePath = literal(args[0]);
      }
      const hs = (chained ? args : args.slice(1)).map((a) => handlerRef(a, p));
      model.routes.push({
        router,
        order: n.getStart(),
        method: method.toUpperCase(),
        routePath,
        handlers: hs,
        path: p,
        line: lineOf(n),
      });
    });
  }
  return model;
}

function clientCall(h: ExpressHelpers, n: Node, p: string, model: ExpressModel) {
  if (!Node.isCallExpression(n)) return;
  const callee = n.getExpression();
  const args = n.getArguments();
  let client: ClientCall['client'];
  let method: string | null;
  let urlNode: Node | undefined;
  if (Node.isIdentifier(callee) && callee.getText() === 'fetch') {
    // Only the global fetch: a repository function called `fetch` is an ordinary call.
    const decls = h.checker.getSymbolAtLocation(callee.compilerNode)?.declarations ?? [];
    if (
      decls.some(
        (d) => !d.getSourceFile().fileName.includes('/node_modules/') && !d.getSourceFile().isDeclarationFile,
      )
    )
      return;
    client = 'fetch';
    urlNode = args[0];
    method = 'GET';
    const init = args[1];
    if (init && Node.isObjectLiteralExpression(init)) {
      const m = init.getProperty('method');
      if (m)
        method = Node.isPropertyAssignment(m) ? (literal(m.getInitializer())?.toUpperCase() ?? null) : null;
    } else if (init) method = null;
  } else if (h.externalOrigin(callee.compilerNode) === 'axios') {
    client = 'axios';
    if (Node.isPropertyAccessExpression(callee) && VERBS.has(callee.getName())) {
      method = callee.getName().toUpperCase();
      urlNode = args[0];
    } else if (args[0] && Node.isObjectLiteralExpression(args[0])) {
      const cfg = args[0];
      const u = cfg.getProperty('url');
      urlNode = u && Node.isPropertyAssignment(u) ? u.getInitializer() : undefined;
      const m = cfg.getProperty('method');
      method =
        m && Node.isPropertyAssignment(m) ? (literal(m.getInitializer())?.toUpperCase() ?? null) : 'GET';
    } else if (
      Node.isIdentifier(callee) ||
      (Node.isPropertyAccessExpression(callee) && callee.getName() === 'request')
    ) {
      urlNode = args[0];
      method = 'GET';
    } else return; // axios.create, interceptors, ...
  } else return;
  let url: string | null = literal(urlNode);
  if (url === null && urlNode && Node.isTemplateExpression(urlNode)) {
    url = urlNode.getHead().getLiteralText();
    for (const span of urlNode.getTemplateSpans()) url += `*${span.getLiteral().getLiteralText()}`;
  }
  model.clientCalls.push({
    client,
    method,
    url,
    sourceKey: h.enclosingSymbol(n)?.key ?? null,
    path: p,
    line: n.getStartLineNumber(),
  });
}
