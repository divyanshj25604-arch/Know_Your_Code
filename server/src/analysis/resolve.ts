import { ts } from 'ts-morph';
import type { Selection, SelectionKind } from '@kyc/contracts';
import { AppError } from '../http/errors';

export interface Classified {
  kind: SelectionKind;
  /** True when the selection covers more than one top-level declaration. */
  spansMultiple: boolean;
  /** The identifier text when the selection is (within) a single identifier. */
  identifier?: string;
  /** Selected text, trimmed, for context packs. */
  text: string;
  note?: string;
}

export function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function toOffset(starts: number[], content: string, line: number, col: number): number {
  const s = starts[line - 1];
  if (s === undefined) throw new AppError('INVALID_SELECTION');
  const end = line < starts.length ? starts[line]! - 1 : content.length;
  return Math.min(s + col, end);
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.ts')) return ts.ScriptKind.TS;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function isRequireCall(n: ts.Node): boolean {
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require';
}

function isFunctionish(n: ts.Node): boolean {
  if (
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isClassDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  )
    return true;
  if (ts.isVariableStatement(n)) {
    return n.declarationList.declarations.some(
      (d) =>
        d.initializer &&
        (ts.isArrowFunction(d.initializer) ||
          ts.isFunctionExpression(d.initializer) ||
          ts.isClassExpression(d.initializer)),
    );
  }
  if (ts.isVariableDeclaration(n))
    return !!n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer));
  return false;
}

function unwrapStatement(n: ts.Node): ts.Node {
  let cur = n;
  for (;;) {
    if (ts.isExpressionStatement(cur) || ts.isParenthesizedExpression(cur) || ts.isAwaitExpression(cur))
      cur = cur.expression;
    else if (ts.isReturnStatement(cur) && cur.expression) cur = cur.expression;
    else return cur;
  }
}

/**
 * Classify a selection syntactically (no semantic resolution needed). `importedNames` lets the caller mark a
 * lone identifier as a `reference` when it is bound by an import/require in this file.
 */
export function classifySelection(
  path: string,
  content: string,
  sel: Selection,
  importedNames: Set<string>,
): Classified {
  const starts = lineStarts(content);
  if (sel.startLine > starts.length || sel.endLine > starts.length) throw new AppError('INVALID_SELECTION');
  let s = toOffset(starts, content, sel.startLine, sel.startCol);
  let e = toOffset(starts, content, sel.endLine, sel.endCol);
  if (e < s) throw new AppError('INVALID_SELECTION');
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.ES2022, true, scriptKind(path));

  // Trim whitespace from both ends of the selection.
  while (s < e && /\s/.test(content[s]!)) s++;
  while (e > s && /\s/.test(content[e - 1]!)) e--;

  const collapsed = s === e;
  const probeStart = collapsed ? s : s;
  const text = content.slice(s, e);

  // Collapsed cursor: expand to the identifier under it.
  const findToken = (pos: number): ts.Node | undefined => {
    let found: ts.Node | undefined;
    const visit = (n: ts.Node) => {
      if (pos >= n.getStart(sf) && pos <= n.getEnd()) {
        found = n;
        ts.forEachChild(n, visit);
      }
    };
    visit(sf);
    return found;
  };

  if (collapsed) {
    const tok = findToken(probeStart);
    if (!tok || !ts.isIdentifier(tok)) throw new AppError('INVALID_SELECTION');
    s = tok.getStart(sf);
    e = tok.getEnd();
  }

  // Maximal nodes fully inside [s, e].
  const covered: ts.Node[] = [];
  const collect = (n: ts.Node) => {
    const ns = n.getStart(sf);
    const ne = n.getEnd();
    if (ne <= s || ns >= e) return;
    if (ns >= s && ne <= e) {
      if (n.kind !== ts.SyntaxKind.SyntaxList && n.kind !== ts.SyntaxKind.EndOfFileToken) covered.push(n);
      else ts.forEachChild(n, collect);
      return;
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  // Selection lies inside one token/expression (e.g. part of an identifier): use the smallest covering node.
  if (covered.length === 0) {
    const tok = findToken(s);
    if (tok && ts.isIdentifier(tok)) {
      return identifierResult(tok.text, importedNames, text);
    }
    if (/^\s*(\/\/|\/\*|\*)/.test(text) || text.length === 0) throw new AppError('INVALID_SELECTION');
    // Inside a string/template/etc.: treat the enclosing statement as a block.
    return { kind: 'block', spansMultiple: false, text, note: 'Explaining the surrounding code.' };
  }

  if (covered.every((n) => ts.isJSDoc(n))) throw new AppError('INVALID_SELECTION');
  const code = covered.filter((n) => !ts.isJSDoc(n));
  if (code.length === 0) throw new AppError('INVALID_SELECTION');

  if (code.length === 1) {
    const n = code[0]!;
    if (ts.isIdentifier(n)) return identifierResult(n.text, importedNames, text);
    if (ts.isImportDeclaration(n) || ts.isImportClause(n) || ts.isImportSpecifier(n))
      return { kind: 'import', spansMultiple: false, text };
    if (
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.some(
        (d) => d.initializer && isRequireCall(unwrapStatement(d.initializer)),
      )
    ) {
      return { kind: 'import', spansMultiple: false, text };
    }
    if (isFunctionish(n)) return { kind: 'function', spansMultiple: false, text };
    const inner = unwrapStatement(n);
    if (ts.isCallExpression(inner) || ts.isNewExpression(inner)) {
      if (isRequireCall(inner)) return { kind: 'import', spansMultiple: false, text };
      return { kind: 'call', spansMultiple: false, text };
    }
    if (ts.isVariableStatement(n) && n.declarationList.declarations.length === 1) {
      const init = n.declarationList.declarations[0]!.initializer;
      if (init && ts.isCallExpression(unwrapStatement(init)) && !isRequireCall(unwrapStatement(init))) {
        return { kind: 'block', spansMultiple: false, text };
      }
    }
    return { kind: 'block', spansMultiple: false, text };
  }

  // Several nodes: a function name + its body could appear here (name, params, body are separate children).
  const first = code[0]!;
  if (code.length > 1 && code.every((n) => n.parent === first.parent)) {
    const parent = first.parent;
    if (parent && isFunctionish(parent) && code.some((n) => ts.isBlock(n)))
      return { kind: 'function', spansMultiple: false, text };
  }
  const topLevel = code.filter((n) => n.parent === sf);
  const spansMultiple = topLevel.length > 1;
  return {
    kind: 'block',
    spansMultiple,
    text,
    ...(spansMultiple
      ? { note: 'This selection covers more than one top-level declaration, so it is explained as a block.' }
      : {}),
  };
}

function identifierResult(name: string, importedNames: Set<string>, text: string): Classified {
  return importedNames.has(name)
    ? { kind: 'reference', spansMultiple: false, identifier: name, text }
    : { kind: 'identifier', spansMultiple: false, identifier: name, text };
}
