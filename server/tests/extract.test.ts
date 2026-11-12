import { describe, expect, it } from 'vitest';
import { extractTarball, safeRelativePath, type ExtractLimits } from '../src/ingestion/extract';
import { buildTarGz, streamOf } from './tar-helper';

const LIMITS: ExtractLimits = {
  maxAnalysableFiles: 50,
  maxAnalysableFileBytes: 10_000,
  maxViewableFileBytes: 50_000,
  maxTotalTextBytes: 1_000_000,
  maxTotalEntries: 1000,
  maxUncompressedBytes: 5_000_000,
};

const run = async (entries: Parameters<typeof buildTarGz>[0], limits: Partial<ExtractLimits> = {}) =>
  extractTarball(streamOf(await buildTarGz(entries)), { ...LIMITS, ...limits });

describe('safeRelativePath', () => {
  it('strips the root directory', () => expect(safeRelativePath('repo-HEAD/src/a.js')).toBe('src/a.js'));
  it.each(['../evil.js', 'repo/../../evil.js', '/abs/path.js', 'repo/a\\b.js', 'repo-HEAD/', 'repo/./x'])(
    'rejects %s',
    (n) => expect(safeRelativePath(n)).toBeNull(),
  );
});

describe('extractTarball', () => {
  it('keeps source and docs, classifies analysable files and languages', async () => {
    const r = await run([
      { name: 'src/a.ts', content: 'export const a = 1;\n' },
      { name: 'src/b.jsx', content: 'export const B = () => <div/>;\n' },
      { name: 'README.md', content: '# hi\n' },
      { name: 'package.json', content: '{}' },
    ]);
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(byPath['src/a.ts']).toMatchObject({ language: 'ts', analysable: true });
    expect(byPath['src/b.jsx']).toMatchObject({ language: 'jsx', analysable: true });
    expect(byPath['README.md']).toMatchObject({ language: null, analysable: false });
    expect(byPath['src/a.ts']!.lineCount).toBe(2);
  });

  it('drops dependency dirs, lockfiles, minified files, maps and type declarations with reasons', async () => {
    const r = await run([
      { name: 'node_modules/x/index.js', content: 'x' },
      { name: 'dist/out.js', content: 'x' },
      { name: 'package-lock.json', content: '{}' },
      { name: 'public/app.min.js', content: 'x' },
      { name: 'src/a.js.map', content: '{}' },
      { name: 'src/types.d.ts', content: 'declare const x: number;' },
      { name: 'src/ok.js', content: 'ok' },
    ]);
    expect(r.files.map((f) => f.path)).toEqual(['src/ok.js']);
    expect(Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]))).toMatchObject({
      'node_modules/x/index.js': 'excluded_directory',
      'dist/out.js': 'excluded_directory',
      'package-lock.json': 'excluded_file',
      'public/app.min.js': 'excluded_file',
    });
  });

  it('never stores secret files and redacts secrets inside kept files', async () => {
    const r = await run([
      { name: '.env', content: 'DB_PASSWORD=supersecretvalue123' },
      { name: 'keys/server.pem', content: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----' },
      { name: '.env.example', content: 'DB_PASSWORD=\n' },
      { name: 'src/cfg.js', content: "const apiKey = 'sk-ant-" + 'z'.repeat(30) + "';\n" },
    ]);
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain('.env.example');
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('keys/server.pem');
    expect(
      r.skipped
        .filter((s) => s.reason === 'secret_file')
        .map((s) => s.path)
        .sort(),
    ).toEqual(['.env', 'keys/server.pem']);
    const cfg = r.files.find((f) => f.path === 'src/cfg.js')!;
    expect(cfg.content).not.toContain('sk-ant');
    expect(cfg.redactions).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain('supersecretvalue123');
  });

  it('ignores zip-slip paths, absolute paths and symlinks', async () => {
    const r = await run([
      { name: 'RAW:../../evil.js', content: 'evil' },
      { name: 'RAW:/etc/passwd', content: 'root' },
      { name: 'link', type: 'symlink', linkname: '/etc/passwd' },
      { name: 'good.js', content: 'ok' },
    ]);
    expect(r.files.map((f) => f.path)).toEqual(['good.js']);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['symlink', 'unsafe_path', 'unsafe_path']);
  });

  it('skips binary and non-UTF-8 files', async () => {
    const r = await run([
      { name: 'logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { name: 'blob.dat', content: Buffer.from([0x41, 0x00, 0x42]) },
      { name: 'latin1.txt', content: Buffer.from([0xe9, 0xff, 0xfe]) },
    ]);
    expect(r.files).toHaveLength(0);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['binary', 'binary', 'not_utf8']);
  });

  it('keeps oversized source viewable but not analysable; skips files over the viewing limit', async () => {
    const r = await run([
      { name: 'big.js', content: 'x'.repeat(20_000) },
      { name: 'huge.js', content: 'x'.repeat(60_000) },
    ]);
    expect(r.files.find((f) => f.path === 'big.js')).toMatchObject({ analysable: false });
    expect(r.skipped).toContainEqual({ path: 'huge.js', reason: 'file_too_large' });
  });

  it('marks generated files and does not analyse them', async () => {
    const r = await run([
      { name: 'gen.js', content: '// @generated by tool\nmodule.exports = {};' },
      { name: '__generated__/schema.ts', content: 'export {}' },
    ]);
    expect(r.files.every((f) => f.generated && !f.analysable)).toBe(true);
  });

  it('rejects a repository with too many analysable files', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.js`, content: 'x' }));
    await expect(run(entries, { maxAnalysableFiles: 5 })).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('rejects too many archive entries', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ name: `d/f${i}.md`, content: 'x' }));
    await expect(run(entries, { maxTotalEntries: 5 })).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('stops on a decompression bomb', async () => {
    const r = run([{ name: 'a.md', content: 'a'.repeat(40_000) }], {
      maxUncompressedBytes: 20_000,
      maxViewableFileBytes: 1_000_000,
    });
    await expect(r).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('respects the total stored text budget', async () => {
    const r = await run(
      [
        { name: 'a.md', content: 'a'.repeat(600) },
        { name: 'b.md', content: 'b'.repeat(600) },
      ],
      { maxTotalTextBytes: 1000 },
    );
    expect(r.files.map((f) => f.path)).toEqual(['a.md']);
    expect(r.skipped).toContainEqual({ path: 'b.md', reason: 'total_size_limit' });
  });

  it('turns a corrupt archive into a user-safe INDEX_FAILED', async () => {
    const err = await extractTarball(streamOf(Buffer.from('not a gzip at all')), LIMITS).catch((e) => e);
    expect(err).toMatchObject({ code: 'INDEX_FAILED' });
    expect(err.message).not.toMatch(/zlib|incorrect header/i);
  });
});
