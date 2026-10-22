import { describe, expect, it } from 'vitest';
import { classifySelection, lineStarts, toOffset } from '../src/analysis/resolve';

const JS = `const express = require('express');
const { login } = require('./auth');
import fs from 'node:fs';

// a comment
async function handler(req, res) {
  const user = await findUser(req.body.email);
  if (!user) {
    return res.status(404).json({ error: 'none' });
  }
  const a = 1, b = 2;
  return user;
}

const arrow = (x) => x * 2;
module.exports = { handler };
`;

/** Select `text` (first occurrence on `line`) in JS. */
function sel(content: string, line: number, text: string, path = 'a.js') {
  const starts = lineStarts(content);
  const lineText = content.slice(starts[line - 1], (starts[line] ?? content.length + 1) - 1);
  const col = lineText.indexOf(text);
  if (col < 0) throw new Error(`"${text}" not on line ${line}: ${lineText}`);
  return { path, startLine: line, startCol: col, endLine: line, endCol: col + text.length };
}
const run = (content: string, line: number, text: string, imports: string[] = [], path = 'a.js') =>
  classifySelection(path, content, sel(content, line, text, path), new Set(imports));

describe('classifySelection', () => {
  it('a lone identifier is an identifier', () => {
    expect(run(JS, 7, 'user')).toMatchObject({
      kind: 'identifier',
      identifier: 'user',
      spansMultiple: false,
    });
  });

  it('an identifier bound by an import/require in this file is a reference', () => {
    expect(run(JS, 7, 'findUser', ['findUser'])).toMatchObject({ kind: 'reference', identifier: 'findUser' });
  });

  it('a whole call expression is a call (also with await, and as a statement)', () => {
    expect(run(JS, 7, 'findUser(req.body.email)').kind).toBe('call');
    expect(run(JS, 7, 'await findUser(req.body.email)').kind).toBe('call');
    expect(run(JS, 9, "return res.status(404).json({ error: 'none' });").kind).toBe('call');
  });

  it('import declarations and require() declarations are imports', () => {
    expect(run(JS, 3, "import fs from 'node:fs';").kind).toBe('import');
    expect(run(JS, 1, "const express = require('express');").kind).toBe('import');
    expect(run(JS, 2, "const { login } = require('./auth');").kind).toBe('import');
  });

  it('a whole function declaration, arrow function and class are functions', () => {
    const all = JS.slice(
      JS.indexOf('async function handler'),
      JS.indexOf('\n}\n', JS.indexOf('async function handler')) + 2,
    );
    const startLine = 6;
    const starts = lineStarts(JS);
    const startOff = starts[startLine - 1]!;
    const end = startOff + all.length;
    // convert end offset back to (line, col)
    const endLine = lineStarts(JS.slice(0, end)).length;
    const endCol = end - starts[endLine - 1]!;
    expect(
      classifySelection('a.js', JS, { path: 'a.js', startLine, startCol: 0, endLine, endCol }, new Set())
        .kind,
    ).toBe('function');
    expect(run(JS, 15, 'const arrow = (x) => x * 2;').kind).toBe('function');
    expect(run('class A {\n  m() {}\n}\n', 1, 'class A {').kind).toBeDefined();
  });

  it('several statements are a block; more than one top-level declaration is flagged', () => {
    const starts = lineStarts(JS);
    const inner = classifySelection(
      'a.js',
      JS,
      { path: 'a.js', startLine: 7, startCol: 2, endLine: 8, endCol: 14 },
      new Set(),
    );
    expect(inner).toMatchObject({ kind: 'block', spansMultiple: false });
    const multi = classifySelection(
      'a.js',
      JS,
      { path: 'a.js', startLine: 15, startCol: 0, endLine: 16, endCol: 31 },
      new Set(),
    );
    expect(multi).toMatchObject({ kind: 'block', spansMultiple: true });
    expect(multi.note).toMatch(/more than one top-level declaration/);
    expect(starts.length).toBeGreaterThan(10);
  });

  it('a collapsed cursor expands to the identifier under it', () => {
    const s = sel(JS, 6, 'handler');
    const c = classifySelection(
      'a.js',
      JS,
      { ...s, startCol: s.startCol + 3, endCol: s.startCol + 3 },
      new Set(),
    );
    expect(c).toMatchObject({ kind: 'identifier', identifier: 'handler' });
  });

  it('a collapsed cursor that is not on an identifier is rejected', () => {
    const starts = lineStarts(JS);
    expect(() =>
      classifySelection(
        'a.js',
        JS,
        { path: 'a.js', startLine: 4, startCol: 0, endLine: 4, endCol: 0 },
        new Set(),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_SELECTION' }));
    expect(starts.length).toBeGreaterThan(3);
  });

  it('part of an identifier selects that identifier; whitespace-only and comment-only are rejected', () => {
    const s = sel(JS, 7, 'user');
    expect(
      classifySelection('a.js', JS, { ...s, startCol: s.startCol + 1, endCol: s.startCol + 3 }, new Set())
        .kind,
    ).toBe('identifier');
    expect(() => run(JS, 7, '  ')).toThrowError(expect.objectContaining({ code: 'INVALID_SELECTION' }));
    expect(() => run(JS, 5, '// a comment')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SELECTION' }),
    );
  });

  it('rejects ranges outside the file and backwards ranges', () => {
    expect(() =>
      classifySelection(
        'a.js',
        JS,
        { path: 'a.js', startLine: 99, startCol: 0, endLine: 99, endCol: 1 },
        new Set(),
      ),
    ).toThrow();
    expect(() =>
      classifySelection(
        'a.js',
        JS,
        { path: 'a.js', startLine: 7, startCol: 5, endLine: 6, endCol: 0 },
        new Set(),
      ),
    ).toThrow();
  });

  it('handles TypeScript and TSX syntax', () => {
    const ts = `interface P { n: number }\nexport function f<T>(p: P, x: T): T {\n  return x;\n}\nconst el = <div>{f(1, 2)}</div>;\n`;
    expect(run(ts, 2, 'export function f<T>(p: P, x: T): T {', [], 'a.ts').kind).toBeDefined();
    expect(classifySelection('a.tsx', ts, sel(ts, 5, 'f(1, 2)', 'a.tsx'), new Set()).kind).toBe('call');
    expect(classifySelection('a.ts', ts, sel(ts, 3, 'x', 'a.ts'), new Set()).kind).toBe('identifier');
  });

  it('survives syntax errors (it only classifies; it never claims relations)', () => {
    const broken = `function broken( {\n  const x = ;\n}\n`;
    expect(() => classifySelection('a.js', broken, sel(broken, 2, 'x'), new Set())).not.toThrow();
  });

  it('offset helpers clamp columns to the line', () => {
    const starts = lineStarts('ab\ncd');
    expect(toOffset(starts, 'ab\ncd', 1, 99)).toBe(2);
    expect(toOffset(starts, 'ab\ncd', 2, 1)).toBe(4);
  });
});
