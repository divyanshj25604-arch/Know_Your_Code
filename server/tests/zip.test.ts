import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import type { ExtractLimits } from '../src/ingestion/extract';
import { crc32, extractZip, hasZipSignature, readZipDirectory } from '../src/ingestion/zip';
import { buildZip, zipFiles, type ZipTestEntry } from './zip-helper';

const LIMITS: ExtractLimits = {
  maxAnalysableFiles: 50,
  maxAnalysableFileBytes: 10_000,
  maxViewableFileBytes: 50_000,
  maxTotalTextBytes: 1_000_000,
  maxTotalEntries: 1000,
  maxUncompressedBytes: 5_000_000,
};

const run = (entries: ZipTestEntry[], limits: Partial<ExtractLimits> = {}) =>
  extractZip(buildZip(entries), { ...LIMITS, ...limits });
const paths = (r: { files: { path: string }[] }) => r.files.map((f) => f.path).sort();
const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? 'unknown',
  );

describe('crc32', () => {
  it('matches the IEEE reference value', () => expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926));
});

describe('extractZip', () => {
  it('strips one common root folder (GitHub-style "project-main/")', async () => {
    const r = await extractZip(
      zipFiles({ 'src/a.ts': 'export const a = 1;\n', 'README.md': '# hi\n' }, 'project-main'),
      LIMITS,
    );
    expect(paths(r)).toEqual(['README.md', 'src/a.ts']);
    expect(r.files.find((f) => f.path === 'src/a.ts')).toMatchObject({ language: 'ts', analysable: true });
  });

  it('keeps paths as they are when files do not share one root folder', async () => {
    const r = await extractZip(
      zipFiles({ 'src/a.ts': 'export const a = 1;\n', 'lib/b.js': 'module.exports = 1;\n' }),
      LIMITS,
    );
    expect(paths(r)).toEqual(['lib/b.js', 'src/a.ts']);
    const flat = await extractZip(zipFiles({ 'index.js': 'x();\n' }), LIMITS);
    expect(paths(flat)).toEqual(['index.js']);
  });

  it('ignores directories, __MACOSX and .DS_Store, so a macOS zip still has a common root', async () => {
    const r = await run([
      { name: 'app/', content: '' },
      { name: 'app/src/', content: '' },
      { name: 'app/src/a.js', content: 'module.exports = 1;\n' },
      { name: 'app/.DS_Store', content: Buffer.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31]) },
      { name: '__MACOSX/app/src/._a.js', content: Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]) },
    ]);
    expect(paths(r)).toEqual(['src/a.js']);
    expect(r.skipped).toEqual([]);
  });

  it('accepts stored and deflated entries', async () => {
    const r = await run([
      { name: 'p/a.js', content: 'const a = 1;\n', method: 'stored' },
      { name: 'p/b.js', content: 'const b = 2;\n', method: 'deflate' },
    ]);
    expect(r.files.map((f) => f.content).sort()).toEqual(['const a = 1;\n', 'const b = 2;\n']);
  });

  it('rejects traversal, absolute and backslash paths as unsafe and never writes them', async () => {
    const r = await run([
      { name: '../evil.js', content: 'x' },
      { name: '/etc/evil.js', content: 'x' },
      { name: 'a\\evil.js', content: 'x' },
      { name: 'src/./x.js', content: 'x' },
      { name: 'src/ok.js', content: 'ok();\n' },
      { name: 'README.md', content: '# hi\n' },
    ]);
    expect(paths(r)).toEqual(['README.md', 'src/ok.js']);
    expect(
      r.skipped
        .filter((s) => s.reason === 'unsafe_path')
        .map((s) => s.path)
        .sort(),
    ).toEqual(['../evil.js', '/etc/evil.js', 'a\\evil.js', 'src/./x.js'].sort());
  });

  it('skips symlinks (by Unix mode) without reading them', async () => {
    const r = await run([
      { name: 'p/link.js', content: '/etc/passwd', symlink: true },
      { name: 'p/a.js', content: 'a();\n' },
    ]);
    expect(paths(r)).toEqual(['a.js']);
    expect(r.skipped).toEqual([{ path: 'p/link.js', reason: 'symlink' }]);
  });

  it('applies the shared filters: dependency folders, binaries, redaction', async () => {
    const r = await run([
      { name: 'p/node_modules/x/index.js', content: 'x' },
      { name: 'p/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
      { name: 'p/src/config.js', content: "module.exports = { token: 'ghp_" + 'a'.repeat(36) + "' };\n" },
    ]);
    expect(paths(r)).toEqual(['src/config.js']);
    expect(r.files[0]!.redactions).toBeGreaterThan(0);
    expect(r.files[0]!.content).not.toContain('ghp_aaaa');
  });

  it('skips files declared over the viewable size without inflating them', async () => {
    const r = await run(
      [
        { name: 'p/big.js', content: 'x'.repeat(2000) },
        { name: 'p/a.js', content: 'a();\n' },
      ],
      { maxViewableFileBytes: 1000 },
    );
    expect(paths(r)).toEqual(['a.js']);
    expect(r.skipped).toEqual([{ path: 'big.js', reason: 'file_too_large' }]);
  });

  it('rejects encrypted entries', async () => {
    expect(await codeOf(run([{ name: 'a.js', content: 'x', encrypted: true }]))).toBe('INVALID_ARCHIVE');
  });

  it('rejects ZIP64 markers and unsupported compression methods', async () => {
    expect(
      await codeOf(extractZip(buildZip([{ name: 'a.js', content: 'x' }], { zip64Count: true }), LIMITS)),
    ).toBe('INVALID_ARCHIVE');
    expect(await codeOf(run([{ name: 'a.js', content: 'x', declaredSize: 0xffffffff }]))).toBe(
      'INVALID_ARCHIVE',
    );
    expect(await codeOf(run([{ name: 'a.js', content: 'x', rawMethod: 12 }]))).toBe('INVALID_ARCHIVE');
  });

  it('rejects a decompression bomb: content larger than its declared size', async () => {
    // Declares 100 bytes, inflates to 1 MB: inflation stops at the declared size and the archive is rejected.
    const bomb = Buffer.alloc(1024 * 1024, 0x61);
    expect(await codeOf(run([{ name: 'a.js', content: bomb, declaredSize: 100 }]))).toBe('INVALID_ARCHIVE');
  });

  it('rejects archives whose declared total exceeds the uncompressed cap, before inflating', async () => {
    expect(
      await codeOf(
        run([{ name: 'a.js', content: 'x', declaredSize: 10_000_000 }], { maxViewableFileBytes: 1 }),
      ),
    ).toBe('REPO_TOO_LARGE');
  });

  it('rejects archives over the entry cap', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.js`, content: 'x' }));
    expect(await codeOf(run(entries, { maxTotalEntries: 5 }))).toBe('REPO_TOO_LARGE');
  });

  it('enforces the analysable-file cap like the tarball path', async () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.js`, content: `f${i}();\n` }));
    expect(await codeOf(run(entries, { maxAnalysableFiles: 3 }))).toBe('REPO_TOO_LARGE');
  });

  it('rejects a CRC mismatch', async () => {
    const zip = buildZip([{ name: 'a.js', content: 'hello();\n', method: 'stored' }]);
    zip[30 + 'a.js'.length] = 0x48; // flip the first content byte
    expect(await codeOf(extractZip(zip, LIMITS))).toBe('INVALID_ARCHIVE');
  });
});

describe('readZipDirectory', () => {
  it('rejects garbage, truncated and empty archives', () => {
    const bad = (b: Buffer) => {
      try {
        readZipDirectory(b, LIMITS);
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(bad(Buffer.from('not a zip at all'))).toBe('INVALID_ARCHIVE');
    const good = zipFiles({ 'a.js': 'a();\n' });
    expect(bad(good)).toBe('ok');
    expect(bad(good.subarray(0, good.length - 5))).toBe('INVALID_ARCHIVE');
    expect(bad(buildZip([]))).toBe('INVALID_ARCHIVE');
    expect(hasZipSignature(buildZip([]))).toBe(false);
    expect(hasZipSignature(good)).toBe(true);
  });

  it('never reads data from inside the central directory (overlapping offsets)', () => {
    const data = deflateRawSync(Buffer.from('x'));
    expect(data.length).toBeGreaterThan(0);
    const zip = buildZip([{ name: 'a.js', content: 'x' }]);
    // Point the entry's local header offset at the central directory itself.
    const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt32LE(cdOffset, cdOffset + 42);
    expect(() => readZipDirectory(zip, LIMITS)).toThrow();
  });
});
