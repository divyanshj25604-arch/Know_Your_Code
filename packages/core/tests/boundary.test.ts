import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from 'ts-morph';
import { describe, expect, it } from 'vitest';

/**
 * The @kyc/core dependency boundary (Engineering Decision Document §6): no Fastify, no `pg`, no `process.env`, no
 * HTTP errors, no runtime modules. Checked on the parsed source, so comments that merely mention these never trip it.
 */
const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(pkgDir, 'src');

const ALLOWED_PACKAGES = new Set(['@kyc/contracts', 'ts-morph']);
/** Host globals that would tie core to one runtime. `setTimeout` and `performance` are the declared contract. */
const FORBIDDEN_GLOBALS = new Set([
  'process',
  'Buffer',
  'require',
  'module',
  '__dirname',
  '__filename',
  'global',
  'setImmediate',
  'window',
  'document',
  'fetch',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(e) && !e.endsWith('.d.ts') ? [full] : [];
  });
}

interface Finding {
  file: string;
  line: number;
  what: string;
}

function scan(file: string, text = readFileSync(file, 'utf8')): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const rel = path.relative(pkgDir, file);
  const out: Finding[] = [];
  const at = (n: ts.Node, what: string) =>
    out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, what });

  const checkSpecifier = (n: ts.Node, spec: string) => {
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      if (!target.startsWith(srcDir)) at(n, `relative import leaves core: ${spec}`);
      return;
    }
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
    if (!ALLOWED_PACKAGES.has(pkg)) at(n, `import of ${spec}`);
  };

  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
      if (ts.isStringLiteral(n.moduleSpecifier)) checkSpecifier(n, n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      at(n, 'dynamic import()');
    } else if (ts.isIdentifier(n) && FORBIDDEN_GLOBALS.has(n.text)) {
      // A property name (`x.process`) or a declaration of our own is fine; a free reference to the global is not.
      const p = n.parent;
      const isPropertyName = p && ts.isPropertyAccessExpression(p) && p.name === n;
      const isDeclName =
        p &&
        (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) &&
        p.name === n;
      if (!isPropertyName && !isDeclName) at(n, `host global ${n.text}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('@kyc/core runtime boundary', () => {
  const files = sourceFiles(srcDir);

  it('scans the whole package', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('imports only @kyc/contracts, ts-morph and its own modules (no Fastify, pg, node:* or server code)', () => {
    const findings = files.flatMap((f) => scan(f)).filter((f) => !f.what.startsWith('host global'));
    expect(findings).toEqual([]);
  });

  it('never touches process.env or other runtime-specific globals', () => {
    const findings = files.flatMap((f) => scan(f)).filter((f) => f.what.startsWith('host global'));
    expect(findings).toEqual([]);
  });

  it('declares only @kyc/contracts and ts-morph as runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@kyc/contracts', 'ts-morph']);
  });

  it('the scanner itself catches violations (guards against a silently passing check)', () => {
    const probe = [
      "import Fastify from 'fastify';",
      "import pg from 'pg';",
      "import fs from 'node:fs';",
      "import { x } from '../../../server/src/app';",
      'export const a = process.env.X;',
      'export const b = Buffer.from("x");',
      '// process.env in a comment is fine',
      'export const ok = { process: 1 }.process;',
    ].join('\n');
    const whats = scan(path.join(srcDir, 'probe.ts'), probe).map((f) => f.what);
    expect(whats).toEqual([
      'import of fastify',
      'import of pg',
      'import of node:fs',
      'relative import leaves core: ../../../server/src/app',
      'host global process',
      'host global Buffer',
    ]);
  });
});
