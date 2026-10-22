import path from 'node:path';
import { Node, SyntaxKind, ts, type Project, type SourceFile } from 'ts-morph';
import { buildProject, readPathAliases, toRelPath, type PathAliases } from './project';
import type {
  AnalysisInput,
  AnalysisResult,
  Diagnostic,
  EdgeRow,
  SymbolKind,
  SymbolRow,
  UnresolvedReason,
} from './types';

export interface AnalyseOptions {
  /** Every stored file path (including view-only files) so imports of .json/.css can be recorded as resolved. */
  knownPaths?: string[];
  aliases?: PathAliases;
  /** Cap on unresolved edges per source symbol, to keep noisy files bounded. */
  maxUnresolvedPerSymbol?: number;
  /** Called as files are processed (symbols pass, then edges pass). */
  onProgress?: (done: number, total: number) => void;
  /** Throw to abort (used for the import timeout). Checked between files. */
  checkAbort?: () => void;
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'use', 'all', 'options', 'head']);
const MAX_SIGNATURE = 200;

interface Ctx {
  project: Project;
  checker: ts.TypeChecker;
  symbols: SymbolRow[];
  byDecl: Map<ts.Node, SymbolRow>;
  /** Function-like symbols by their AST node, for finding the enclosing symbol of an expression. */
  scopeNodes: Map<ts.Node, SymbolRow>;
  edges: EdgeRow[];
  diagnostics: Diagnostic[];
  broken: Set<string>;
  known: Set<string>;
  unresolvedCount: Map<string, number>;
  maxUnresolved: number;
}

// ---------------------------------------------------------------- positions

function range(node: Node): Pick<SymbolRow, 'startLine' | 'startCol' | 'endLine' | 'endCol'> {
  const sf = node.getSourceFile();
  const s = sf.getLineAndColumnAtPos(node.getStart());
  const e = sf.getLineAndColumnAtPos(node.getEnd());
  return { startLine: s.line, startCol: s.column - 1, endLine: e.line, endCol: e.column - 1 };
}

function lineOf(node: Node): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).line;
}

function relPath(sf: SourceFile): string {
  return toRelPath(sf.getFilePath()) ?? sf.getFilePath();
}

function squish(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_SIGNATURE ? `${t.slice(0, MAX_SIGNATURE - 1)}…` : t;
}

function signatureUntilBody(node: Node, body: Node | undefined, prefix = ''): string {
  const text = node.getSourceFile().getFullText();
  const end =
    body && body.getKind() === SyntaxKind.Block ? body.getStart() : (body?.getStart() ?? node.getEnd());
  const head = text.slice(node.getStart(), Math.min(end, node.getEnd()));
  return squish(prefix + head);
}

// ---------------------------------------------------------------- symbol extraction

function addSymbol(
  ctx: Ctx,
  declNode: Node,
  name: string,
  kind: SymbolKind,
  parent: SymbolRow | null,
  extra: { tags?: string[]; exported?: boolean; signature?: string | null; rangeNode?: Node } = {},
): SymbolRow {
  const rn = extra.rangeNode ?? declNode;
  const p = relPath(rn.getSourceFile());
  const r = range(rn);
  const row: SymbolRow = {
    key: `${p}#${rn.getStart()}-${rn.getEnd()}-${kind}-${name}`,
    path: p,
    name,
    qualifiedName: parent ? `${parent.qualifiedName}.${name}` : name,
    kind,
    tags: extra.tags ?? [],
    exported: extra.exported ?? false,
    signature: extra.signature ?? null,
    ...r,
    parentKey: parent?.key ?? null,
  };
  ctx.symbols.push(row);
  ctx.byDecl.set(declNode.compilerNode, row);
  return row;
}

function isFunctionLike(n: Node): n is Node & { getBody(): Node | undefined } {
  return (
    Node.isFunctionDeclaration(n) ||
    Node.isArrowFunction(n) ||
    Node.isFunctionExpression(n) ||
    Node.isMethodDeclaration(n) ||
    Node.isConstructorDeclaration(n) ||
    Node.isGetAccessorDeclaration(n) ||
    Node.isSetAccessorDeclaration(n)
  );
}

function containsJsx(n: Node): boolean {
  return (
    n.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    n.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    n.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

function bindingNames(nameNode: Node): { node: Node; name: string }[] {
  if (Node.isIdentifier(nameNode)) return [{ node: nameNode, name: nameNode.getText() }];
  const out: { node: Node; name: string }[] = [];
  if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.getElements()) {
      if (Node.isBindingElement(el)) {
        const n = el.getNameNode();
        if (Node.isIdentifier(n)) out.push({ node: el, name: n.getText() });
        else out.push(...bindingNames(n));
      }
    }
  }
  return out;
}

function requireSpecOf(expr: Node | undefined): string | null {
  if (!expr) return null;
  let e: Node = expr;
  while (Node.isAwaitExpression(e) || Node.isParenthesizedExpression(e)) e = e.getExpression();
  if (Node.isCallExpression(e)) {
    const callee = e.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === 'require') {
      const a = e.getArguments()[0];
      if (a && (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a)))
        return a.getLiteralText();
    }
  }
  return null;
}

function routeInfo(call: Node): { verb: string; path: string } | null {
  if (!Node.isCallExpression(call)) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const verb = callee.getName();
  if (!HTTP_VERBS.has(verb)) return null;
  const first = call.getArguments()[0];
  if (!first || !(Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first))) return null;
  const p = first.getLiteralText();
  if (!p.startsWith('/')) return null;
  return { verb: verb.toUpperCase(), path: p };
}

function addParams(ctx: Ctx, fn: Node, owner: SymbolRow) {
  if (!isFunctionLike(fn)) return;
  const params = (fn as unknown as { getParameters(): Node[] }).getParameters();
  for (const p of params) {
    if (!Node.isParameterDeclaration(p)) continue;
    const nameNode = p.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      addSymbol(ctx, p, nameNode.getText(), 'parameter', owner, { signature: squish(p.getText()) });
    } else {
      for (const b of bindingNames(nameNode)) addSymbol(ctx, b.node, b.name, 'parameter', owner);
    }
  }
}

function makeFunctionSymbol(
  ctx: Ctx,
  declNode: Node,
  fn: Node,
  name: string,
  parent: SymbolRow | null,
  opts: { exported?: boolean; tags?: string[]; signature?: string | null; rangeNode?: Node } = {},
): SymbolRow {
  const sym = addSymbol(
    ctx,
    declNode,
    name,
    Node.isMethodDeclaration(fn) ||
      Node.isConstructorDeclaration(fn) ||
      Node.isGetAccessorDeclaration(fn) ||
      Node.isSetAccessorDeclaration(fn)
      ? 'method'
      : 'function',
    parent,
    {
      exported: opts.exported,
      tags: opts.tags ?? [],
      signature:
        opts.signature ??
        signatureUntilBody(declNode, (fn as unknown as { getBody(): Node | undefined }).getBody()),
      rangeNode: opts.rangeNode,
    },
  );
  ctx.scopeNodes.set(fn.compilerNode, sym);
  if (/^[A-Z]/.test(name) && containsJsx(fn) && !sym.tags.includes('react-component'))
    sym.tags.push('react-component');
  addParams(ctx, fn, sym);
  return sym;
}

function extractObjectMethods(ctx: Ctx, obj: Node, owner: SymbolRow) {
  if (!Node.isObjectLiteralExpression(obj)) return;
  for (const prop of obj.getProperties()) {
    if (Node.isMethodDeclaration(prop)) {
      makeFunctionSymbol(ctx, prop, prop, `${owner.name}.${prop.getName()}`, owner, { exported: false });
    } else if (Node.isPropertyAssignment(prop)) {
      const init = prop.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        makeFunctionSymbol(ctx, prop, init, `${owner.name}.${prop.getName()}`, owner, {
          signature: signatureUntilBody(prop, init.getBody()),
        });
      }
    }
  }
}

function visitChildren(ctx: Ctx, node: Node, parent: SymbolRow | null) {
  for (const c of node.getChildren()) visit(ctx, c, parent);
}

function visit(ctx: Ctx, node: Node, parent: SymbolRow | null): void {
  switch (node.getKind()) {
    case SyntaxKind.FunctionDeclaration: {
      const fd = node.asKindOrThrow(SyntaxKind.FunctionDeclaration);
      const name = fd.getName() ?? (fd.isDefaultExport() ? 'default' : null);
      if (name) {
        const sym = makeFunctionSymbol(ctx, fd, fd, name, parent, { exported: fd.isExported() });
        visitChildren(ctx, fd, sym);
        return;
      }
      break;
    }
    case SyntaxKind.ClassDeclaration:
    case SyntaxKind.ClassExpression: {
      const cd = node as Node & {
        getName(): string | undefined;
        isExported?: () => boolean;
        getMembers(): Node[];
      };
      const name = cd.getName() ?? 'default';
      const sym = addSymbol(ctx, node, name, 'class', parent, {
        exported: cd.isExported?.() ?? false,
        signature: squish(node.getText().split('{')[0] ?? name),
      });
      for (const m of cd.getMembers()) {
        if (Node.isMethodDeclaration(m)) {
          makeFunctionSymbol(ctx, m, m, m.getName(), sym);
          visitChildren(ctx, m, ctx.byDecl.get(m.compilerNode) ?? sym);
        } else if (Node.isConstructorDeclaration(m)) {
          const s = makeFunctionSymbol(ctx, m, m, 'constructor', sym);
          visitChildren(ctx, m, s);
        } else if (Node.isGetAccessorDeclaration(m) || Node.isSetAccessorDeclaration(m)) {
          const s = makeFunctionSymbol(ctx, m, m, m.getName(), sym);
          visitChildren(ctx, m, s);
        } else if (Node.isPropertyDeclaration(m)) {
          const init = m.getInitializer();
          if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
            const s = makeFunctionSymbol(ctx, m, init, m.getName(), sym, {
              signature: signatureUntilBody(m, init.getBody()),
            });
            visitChildren(ctx, init, s);
          } else if (init) visitChildren(ctx, init, sym);
        } else visitChildren(ctx, m, sym);
      }
      return;
    }
    case SyntaxKind.ImportDeclaration: {
      const imp = node.asKindOrThrow(SyntaxKind.ImportDeclaration);
      const spec = imp.getModuleSpecifierValue();
      const def = imp.getDefaultImport();
      if (def)
        addSymbol(ctx, def.getParent() ?? def, def.getText(), 'import', parent, {
          signature: squish(`import ${def.getText()} from '${spec}'`),
        });
      const ns = imp.getNamespaceImport();
      if (ns)
        addSymbol(ctx, ns, ns.getText(), 'import', parent, {
          signature: squish(`import * as ${ns.getText()} from '${spec}'`),
        });
      for (const n of imp.getNamedImports()) {
        addSymbol(ctx, n, (n.getAliasNode() ?? n.getNameNode()).getText(), 'import', parent, {
          signature: squish(`import { ${n.getText()} } from '${spec}'`),
        });
      }
      return;
    }
    case SyntaxKind.VariableDeclaration: {
      const vd = node.asKindOrThrow(SyntaxKind.VariableDeclaration);
      const stmt = vd.getVariableStatement();
      const exported = stmt?.isExported() ?? false;
      const init = vd.getInitializer();
      const nameNode = vd.getNameNode();
      const kw = vd.getVariableStatement()?.getDeclarationKind() ?? 'const';
      const reqSpec = requireSpecOf(init);
      if (reqSpec !== null) {
        for (const b of bindingNames(nameNode)) {
          addSymbol(ctx, b.node, b.name, 'import', parent, {
            tags: ['require'],
            signature: squish(`${kw} ${nameNode.getText()} = require('${reqSpec}')`),
          });
        }
        if (init) visitChildren(ctx, init, parent);
        return;
      }
      if (Node.isIdentifier(nameNode)) {
        const name = nameNode.getText();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          const sym = makeFunctionSymbol(ctx, vd, init, name, parent, {
            exported,
            signature: signatureUntilBody(vd, init.getBody(), `${kw} `),
          });
          visitChildren(ctx, init, sym);
          return;
        }
        if (init && Node.isClassExpression(init)) {
          visit(ctx, init, parent);
          return;
        }
        const sym = addSymbol(ctx, vd, name, 'variable', parent, {
          exported,
          signature: squish(`${kw} ${vd.getText().split('\n')[0] ?? name}`),
        });
        if (init) {
          extractObjectMethods(ctx, init, sym);
          visitChildren(ctx, init, sym);
        }
        return;
      }
      for (const b of bindingNames(nameNode))
        addSymbol(ctx, b.node, b.name, 'variable', parent, { exported });
      if (init) visitChildren(ctx, init, parent);
      return;
    }
    case SyntaxKind.ArrowFunction:
    case SyntaxKind.FunctionExpression: {
      // Anonymous callback passed to a call: give it a symbol so selections inside it have a home.
      const fn = node;
      const call = fn.getParent();
      if (
        call &&
        Node.isCallExpression(call) &&
        call.getArguments().some((a) => a === fn) &&
        !ctx.byDecl.has(fn.compilerNode)
      ) {
        const route = routeInfo(call);
        const lines = range(fn).endLine - range(fn).startLine + 1;
        if (route || lines >= 3) {
          const calleeText = call.getExpression().getText();
          const name = route
            ? `${route.verb} ${route.path}`
            : `${calleeText.length > 40 ? `${calleeText.slice(0, 39)}…` : calleeText} callback`;
          const sym = makeFunctionSymbol(ctx, fn, fn, name, parent, {
            tags: route ? ['callback', 'route-handler'] : ['callback'],
            signature: signatureUntilBody(fn, (fn as unknown as { getBody(): Node }).getBody()),
          });
          visitChildren(ctx, fn, sym);
          return;
        }
      }
      break;
    }
    case SyntaxKind.ExpressionStatement: {
      // CommonJS exports:  exports.x = function () {}  /  module.exports.x = () => {}
      const es = node.asKindOrThrow(SyntaxKind.ExpressionStatement);
      const e = es.getExpression();
      if (Node.isBinaryExpression(e) && e.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
        const left = e.getLeft();
        const right = e.getRight();
        if (
          Node.isPropertyAccessExpression(left) &&
          (Node.isArrowFunction(right) || Node.isFunctionExpression(right))
        ) {
          const base = left.getExpression().getText();
          if (base === 'exports' || base === 'module.exports') {
            const sym = makeFunctionSymbol(ctx, left, right, left.getName(), parent, {
              exported: true,
              rangeNode: es,
              signature: signatureUntilBody(es, right.getBody()),
            });
            visitChildren(ctx, right, sym);
            return;
          }
        }
      }
      break;
    }
    default:
      break;
  }
  visitChildren(ctx, node, parent);
}

/** Names exported via CommonJS object assignment: module.exports = { a, b: c } */
function cjsExportedNames(sf: SourceFile): Set<string> {
  const out = new Set<string>();
  for (const st of sf.getStatements()) {
    if (!Node.isExpressionStatement(st)) continue;
    const e = st.getExpression();
    if (!Node.isBinaryExpression(e) || e.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = e.getLeft().getText();
    const right = e.getRight();
    if (left !== 'module.exports') continue;
    if (Node.isObjectLiteralExpression(right)) {
      for (const p of right.getProperties()) {
        if (Node.isShorthandPropertyAssignment(p)) out.add(p.getName());
        else if (Node.isPropertyAssignment(p)) {
          const init = p.getInitializer();
          if (init && Node.isIdentifier(init)) out.add(init.getText());
        }
      }
    } else if (Node.isIdentifier(right)) out.add(right.getText());
  }
  return out;
}

// ---------------------------------------------------------------- resolution helpers

function declsOf(sym: ts.Symbol | undefined, checker: ts.TypeChecker, depth = 0): ts.Node[] {
  if (!sym || depth > 5) return [];
  if (sym.flags & ts.SymbolFlags.Alias) {
    try {
      const target = checker.getAliasedSymbol(sym);
      if (target && target !== sym) return declsOf(target, checker, depth + 1);
    } catch {
      return [];
    }
  }
  const out: ts.Node[] = [];
  for (const d of sym.declarations ?? []) {
    if (ts.isShorthandPropertyAssignment(d)) {
      out.push(...declsOf(checker.getShorthandAssignmentValueSymbol(d), checker, depth + 1));
    } else if (ts.isPropertyAssignment(d) && ts.isIdentifier(d.initializer)) {
      out.push(d, ...declsOf(checker.getSymbolAtLocation(d.initializer), checker, depth + 1));
    } else {
      out.push(d);
    }
  }
  return out;
}

export function packageName(spec: string): string {
  if (spec.startsWith('node:')) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

function tsRequireSpec(e: ts.Node): string | null {
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'require') {
    const a = e.arguments[0];
    if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text;
  }
  return null;
}

/** Module specifier (and importing file) that an expression's root value was imported/required from. */
function originSpec(ctx: Ctx, expr: ts.Node, depth = 0): { spec: string; containing: string } | null {
  if (depth > 4) return null;
  let e: ts.Node = expr;
  for (;;) {
    if (
      ts.isPropertyAccessExpression(e) ||
      ts.isElementAccessExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isAwaitExpression(e)
    ) {
      e = e.expression;
    } else if (ts.isCallExpression(e) || ts.isNewExpression(e)) {
      const spec = tsRequireSpec(e);
      if (spec) return { spec, containing: e.getSourceFile().fileName };
      e = e.expression;
    } else break;
  }
  if (!ts.isIdentifier(e)) return null;
  const containing = e.getSourceFile().fileName;
  const sym = ctx.checker.getSymbolAtLocation(e);
  for (const d of sym?.declarations ?? []) {
    if (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)) {
      let p: ts.Node = d;
      while (p && !ts.isImportDeclaration(p)) p = p.parent;
      if (p && ts.isImportDeclaration(p) && ts.isStringLiteral(p.moduleSpecifier))
        return { spec: p.moduleSpecifier.text, containing };
    } else if (ts.isVariableDeclaration(d) || ts.isBindingElement(d)) {
      let vd: ts.Node | undefined = d;
      while (vd && !ts.isVariableDeclaration(vd)) vd = vd.parent;
      if (vd && ts.isVariableDeclaration(vd) && vd.initializer) {
        const r = originSpec(ctx, vd.initializer, depth + 1);
        if (r) return r;
      }
    }
  }
  return null;
}

/** If an expression's root value comes from an external package (import or require), return the package name. */
function externalOrigin(ctx: Ctx, expr: ts.Node): string | null {
  const o = originSpec(ctx, expr);
  if (!o || o.spec.startsWith('.') || o.spec.startsWith('/')) return null;
  return resolvesInProject(ctx, o.spec, o.containing) ? null : packageName(o.spec);
}

/** If the value was imported from a file that failed to parse, return that file's path. */
function brokenOrigin(ctx: Ctx, expr: ts.Node): string | null {
  const o = originSpec(ctx, expr);
  if (!o) return null;
  const rel = resolveModule(ctx, o.spec, o.containing).rel;
  return rel && ctx.broken.has(rel) ? rel : null;
}

function resolveModule(
  ctx: Ctx,
  spec: string,
  containing: string,
): { rel: string | null; viaKnown: boolean } {
  const res = ts.resolveModuleName(
    spec,
    containing,
    ctx.project.getCompilerOptions(),
    ctx.project.getModuleResolutionHost(),
  );
  const fileName = res.resolvedModule?.resolvedFileName;
  if (fileName) {
    const rel = toRelPath(fileName);
    if (rel) return { rel, viaKnown: false };
  }
  if (spec.startsWith('.')) {
    const dir = path.posix.dirname(toRelPath(containing) ?? '');
    const joined = path.posix.normalize(path.posix.join(dir, spec));
    for (const cand of [joined, `${joined}.json`, `${joined}/index.json`]) {
      if (ctx.known.has(cand)) return { rel: cand, viaKnown: true };
    }
  }
  return { rel: null, viaKnown: false };
}

function resolvesInProject(ctx: Ctx, spec: string, containing: string): boolean {
  return resolveModule(ctx, spec, containing).rel !== null;
}

// ---------------------------------------------------------------- edge extraction

function pushEdge(ctx: Ctx, e: EdgeRow) {
  if (e.reason && e.sourceKey) {
    const n = (ctx.unresolvedCount.get(e.sourceKey) ?? 0) + 1;
    ctx.unresolvedCount.set(e.sourceKey, n);
    if (n > ctx.maxUnresolved) return;
  }
  ctx.edges.push(e);
}

function enclosingSymbol(ctx: Ctx, node: Node): SymbolRow | null {
  let p: Node | undefined = node.getParent();
  while (p) {
    const s = ctx.scopeNodes.get(p.compilerNode);
    if (s) return s;
    p = p.getParent();
  }
  return null;
}

function mappedSymbol(ctx: Ctx, decls: ts.Node[]): SymbolRow | null {
  for (const d of decls) {
    const s = ctx.byDecl.get(d);
    if (s) return s;
  }
  return null;
}

function declFilePaths(decls: ts.Node[]): string[] {
  return decls.map((d) => toRelPath(d.getSourceFile().fileName) ?? '(lib)');
}

function handleImports(ctx: Ctx, sf: SourceFile) {
  const p = relPath(sf);
  const abs = sf.getFilePath();
  const record = (node: Node, spec: string | null, dynamic: boolean) => {
    const src = enclosingSymbol(ctx, node);
    const line = lineOf(node);
    if (spec === null) {
      pushEdge(ctx, {
        type: 'imports',
        sourceKey: src?.key ?? null,
        sourcePath: p,
        targetKey: null,
        targetPath: null,
        targetExternal: null,
        line,
        provenance: 'verified',
        reason: dynamic ? 'dynamic_import' : 'no_declaration',
        meta: { calleeText: node.getText().slice(0, 80) },
      });
      return;
    }
    const r = resolveModule(ctx, spec, abs);
    if (r.rel) {
      const reason: UnresolvedReason | null = ctx.broken.has(r.rel) ? 'parse_error' : null;
      pushEdge(ctx, {
        type: 'imports',
        sourceKey: src?.key ?? null,
        sourcePath: p,
        targetKey: null,
        targetPath: r.rel,
        targetExternal: null,
        line,
        provenance: 'verified',
        reason,
        meta: { spec },
      });
    } else if (spec.startsWith('.') || spec.startsWith('/')) {
      pushEdge(ctx, {
        type: 'imports',
        sourceKey: src?.key ?? null,
        sourcePath: p,
        targetKey: null,
        targetPath: null,
        targetExternal: null,
        line,
        provenance: 'verified',
        reason: 'no_declaration',
        meta: { spec },
      });
    } else {
      pushEdge(ctx, {
        type: 'imports',
        sourceKey: src?.key ?? null,
        sourcePath: p,
        targetKey: null,
        targetPath: null,
        targetExternal: packageName(spec),
        line,
        provenance: 'verified',
        reason: 'external_package',
        meta: { spec },
      });
    }
  };

  sf.forEachDescendant((n) => {
    if (Node.isImportDeclaration(n)) record(n, n.getModuleSpecifierValue(), false);
    else if (Node.isExportDeclaration(n)) {
      const spec = n.getModuleSpecifierValue();
      if (spec) record(n, spec, false);
    } else if (Node.isCallExpression(n)) {
      const callee = n.getExpression();
      const first = n.getArguments()[0];
      const isReq = Node.isIdentifier(callee) && callee.getText() === 'require';
      const isDyn = callee.getKind() === SyntaxKind.ImportKeyword;
      if (!isReq && !isDyn) return;
      if (first && (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)))
        record(n, first.getLiteralText(), isDyn);
      else if (first) record(n, null, true);
    }
  });
}

function calleeNameNode(callee: Node): Node | null {
  if (Node.isIdentifier(callee)) return callee;
  if (Node.isPropertyAccessExpression(callee)) return callee.getNameNode();
  return null;
}

function handleCalls(ctx: Ctx, sf: SourceFile) {
  const p = relPath(sf);
  sf.forEachDescendant((n) => {
    if (!Node.isCallExpression(n) && !Node.isNewExpression(n)) return;
    const callee = n.getExpression();
    if (callee.getKind() === SyntaxKind.ImportKeyword || callee.getKind() === SyntaxKind.SuperKeyword) return;
    if (Node.isIdentifier(callee) && callee.getText() === 'require') return;
    const src = enclosingSymbol(ctx, n);
    const line = lineOf(n);
    const calleeText = callee.getText().length > 80 ? `${callee.getText().slice(0, 79)}…` : callee.getText();

    // Express-style route registration (pattern, not proof).
    const route = Node.isCallExpression(n) ? routeInfo(n) : null;
    if (route && Node.isCallExpression(n)) {
      const recv = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
      if (externalOrigin(ctx, recv.compilerNode) === 'express') {
        for (const arg of n.getArguments().slice(1)) {
          let target: SymbolRow | null = null;
          if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg))
            target = ctx.scopeNodes.get(arg.compilerNode) ?? null;
          else if (Node.isIdentifier(arg) || Node.isPropertyAccessExpression(arg)) {
            const nn = Node.isIdentifier(arg) ? arg : arg.getNameNode();
            target = mappedSymbol(
              ctx,
              declsOf(ctx.checker.getSymbolAtLocation(nn.compilerNode), ctx.checker),
            );
          }
          if (target && (target.kind === 'function' || target.kind === 'method')) {
            pushEdge(ctx, {
              type: 'route_handler',
              sourceKey: null,
              sourcePath: p,
              targetKey: target.key,
              targetPath: target.path,
              targetExternal: null,
              line,
              provenance: 'pattern',
              reason: null,
              meta: { method: route.verb, path: route.path },
            });
          }
        }
      }
    }

    // Callee resolution.
    if (Node.isElementAccessExpression(callee)) {
      const arg = callee.getArgumentExpression();
      if (!arg || !(Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) {
        pushEdge(ctx, {
          type: 'calls',
          sourceKey: src?.key ?? null,
          sourcePath: p,
          targetKey: null,
          targetPath: null,
          targetExternal: null,
          line,
          provenance: 'verified',
          reason: 'computed_member',
          meta: { calleeText },
        });
        return;
      }
    }
    const nameNode =
      calleeNameNode(callee) ??
      (Node.isElementAccessExpression(callee) ? (callee.getArgumentExpression() ?? null) : null);
    if (!nameNode) return; // IIFE, call-of-call, etc.: nothing resolvable to report
    const sym = ctx.checker.getSymbolAtLocation(nameNode.compilerNode);
    const decls = declsOf(sym, ctx.checker);
    const target = mappedSymbol(ctx, decls);
    if (target) {
      if (target.kind === 'parameter') {
        pushEdge(ctx, {
          type: 'calls',
          sourceKey: src?.key ?? null,
          sourcePath: p,
          targetKey: null,
          targetPath: null,
          targetExternal: null,
          line,
          provenance: 'verified',
          reason: 'callback_parameter',
          meta: { calleeText, parameter: target.name },
        });
        return;
      }
      if (target.kind === 'function' || target.kind === 'method' || target.kind === 'class') {
        pushEdge(ctx, {
          type: 'calls',
          sourceKey: src?.key ?? null,
          sourcePath: p,
          targetKey: target.key,
          targetPath: target.path,
          targetExternal: null,
          line,
          provenance: 'verified',
          reason: null,
          meta: { calleeText },
        });
        return;
      }
      // variable holding something unknown (e.g. const x = someCall())
    }
    const files = declFilePaths(decls);
    if (decls.length > 0 && files.every((f) => f === '(lib)')) return; // JS built-ins (console.log, arr.map...): not interesting
    const broken = files.find((f) => ctx.broken.has(f)) ?? brokenOrigin(ctx, callee.compilerNode);
    if (broken) {
      pushEdge(ctx, {
        type: 'calls',
        sourceKey: src?.key ?? null,
        sourcePath: p,
        targetKey: null,
        targetPath: broken,
        targetExternal: null,
        line,
        provenance: 'verified',
        reason: 'parse_error',
        meta: { calleeText },
      });
      return;
    }
    const pkg = externalOrigin(ctx, callee.compilerNode);
    if (pkg) {
      pushEdge(ctx, {
        type: 'calls',
        sourceKey: src?.key ?? null,
        sourcePath: p,
        targetKey: null,
        targetPath: null,
        targetExternal: pkg,
        line,
        provenance: 'verified',
        reason: 'external_package',
        meta: { calleeText, package: pkg },
      });
      return;
    }
    // Calls on values of unknown type (req.body.x(), res.json(...)): record why we can't follow them.
    pushEdge(ctx, {
      type: 'calls',
      sourceKey: src?.key ?? null,
      sourcePath: p,
      targetKey: null,
      targetPath: null,
      targetExternal: null,
      line,
      provenance: 'verified',
      reason: 'no_declaration',
      meta: { calleeText },
    });
  });
}

function handleReferences(ctx: Ctx, sf: SourceFile, fnNames: Set<string>) {
  const p = relPath(sf);
  sf.forEachDescendant((n) => {
    if (!Node.isIdentifier(n)) return;
    if (!fnNames.has(n.getText())) return;
    const parent = n.getParent();
    if (!parent) return;
    // Calls are recorded by handleCalls.
    if ((Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getExpression() === n)
      return;
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === n) {
      const gp = parent.getParent();
      if (gp && (Node.isCallExpression(gp) || Node.isNewExpression(gp)) && gp.getExpression() === parent)
        return;
    }
    if (
      parent.getKind() === SyntaxKind.ImportSpecifier ||
      parent.getKind() === SyntaxKind.ImportClause ||
      parent.getKind() === SyntaxKind.NamespaceImport ||
      parent.getKind() === SyntaxKind.ExportSpecifier
    )
      return;
    // Skip the declaration's own name.
    if (
      (Node.isFunctionDeclaration(parent) ||
        Node.isClassDeclaration(parent) ||
        Node.isVariableDeclaration(parent) ||
        Node.isMethodDeclaration(parent) ||
        Node.isParameterDeclaration(parent) ||
        Node.isBindingElement(parent) ||
        Node.isPropertyAssignment(parent) ||
        Node.isPropertyDeclaration(parent)) &&
      (parent as Node & { getNameNode(): Node }).getNameNode() === n
    )
      return;
    const sym = ctx.checker.getSymbolAtLocation(n.compilerNode);
    const target = mappedSymbol(ctx, declsOf(sym, ctx.checker));
    if (!target || !(target.kind === 'function' || target.kind === 'method' || target.kind === 'class'))
      return;
    const src = enclosingSymbol(ctx, n);
    if (src && src.key === target.key) return; // recursion on itself as a value is not interesting
    const jsx =
      parent.getKind() === SyntaxKind.JsxOpeningElement ||
      parent.getKind() === SyntaxKind.JsxSelfClosingElement ||
      parent.getKind() === SyntaxKind.JsxClosingElement;
    if (parent.getKind() === SyntaxKind.JsxClosingElement) return;
    pushEdge(ctx, {
      type: 'references',
      sourceKey: src?.key ?? null,
      sourcePath: p,
      targetKey: target.key,
      targetPath: target.path,
      targetExternal: null,
      line: lineOf(n),
      provenance: 'verified',
      reason: null,
      meta: jsx ? { jsx: true } : {},
    });
  });
}

// ---------------------------------------------------------------- entry point

export async function analyse(files: AnalysisInput[], opts: AnalyseOptions = {}): Promise<AnalysisResult> {
  const t0 = performance.now();
  const aliases = opts.aliases ?? {};
  const project = buildProject(files, aliases);
  const ctx: Ctx = {
    project,
    checker: project.getTypeChecker().compilerObject,
    symbols: [],
    byDecl: new Map(),
    scopeNodes: new Map(),
    edges: [],
    diagnostics: [],
    broken: new Set(),
    known: new Set(opts.knownPaths ?? files.map((f) => f.path)),
    unresolvedCount: new Map(),
    maxUnresolved: opts.maxUnresolvedPerSymbol ?? 40,
  };
  const failedFiles: AnalysisResult['failedFiles'] = [];
  const t1 = performance.now();

  const analysed: SourceFile[] = [];
  for (const sf of project.getSourceFiles()) {
    const p = relPath(sf);
    const syntactic = project.getProgram().getSyntacticDiagnostics(sf);
    if (syntactic.length > 0) {
      ctx.broken.add(p);
      const first = syntactic[0]!;
      const line = first.getLineNumber();
      ctx.diagnostics.push({
        path: p,
        kind: 'syntax_error',
        message: String(
          first.getMessageText() && typeof first.getMessageText() === 'string'
            ? first.getMessageText()
            : (first.getMessageText() as { getMessageText(): string }).getMessageText(),
        ),
        ...(line ? { line } : {}),
      });
      failedFiles.push({ path: p, reason: 'parse_error' });
      continue;
    }
    analysed.push(sf);
  }

  const total = analysed.length * 2;
  let done = 0;
  const tick = async () => {
    done++;
    opts.checkAbort?.();
    if (done % 8 === 0) {
      opts.onProgress?.(done, total);
      await yieldLoop();
    }
  };

  for (const sf of analysed) {
    await tick();
    try {
      const before = ctx.symbols.length;
      visitChildren(ctx, sf, null);
      const exportedCjs = cjsExportedNames(sf);
      for (const s of ctx.symbols.slice(before)) {
        if (s.parentKey === null && exportedCjs.has(s.name)) s.exported = true;
      }
    } catch (e) {
      ctx.diagnostics.push({ path: relPath(sf), kind: 'analysis_failed', message: (e as Error).message });
      failedFiles.push({ path: relPath(sf), reason: 'analysis_failed' });
    }
  }
  const t2 = performance.now();

  const fnNames = new Set(
    ctx.symbols
      .filter((s) => s.kind === 'function' || s.kind === 'method' || s.kind === 'class')
      .map((s) => s.name.split('.').pop() ?? s.name),
  );
  for (const sf of analysed) {
    await tick();
    if (failedFiles.some((f) => f.path === relPath(sf))) continue;
    try {
      handleImports(ctx, sf);
      handleCalls(ctx, sf);
      handleReferences(ctx, sf, fnNames);
    } catch (e) {
      ctx.diagnostics.push({ path: relPath(sf), kind: 'analysis_failed', message: (e as Error).message });
    }
  }
  opts.onProgress?.(total, total);
  const t3 = performance.now();
  return {
    symbols: ctx.symbols,
    edges: ctx.edges,
    diagnostics: ctx.diagnostics,
    failedFiles,
    timings: { projectMs: Math.round(t1 - t0), symbolsMs: Math.round(t2 - t1), edgesMs: Math.round(t3 - t2) },
  };
}

export { readPathAliases };
