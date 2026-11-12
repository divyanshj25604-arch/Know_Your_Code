import { Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import {
  KycError,
  redact,
  ANALYSABLE_EXT,
  classifyPath,
  extOf,
  isGeneratedContent,
  isGeneratedPath,
  languageOf,
  looksBinary,
  type SkipReason,
} from '@kyc/core';

export interface ExtractLimits {
  maxAnalysableFiles: number;
  maxAnalysableFileBytes: number;
  maxViewableFileBytes: number;
  maxTotalTextBytes: number;
  maxTotalEntries: number;
  /** Hard cap on decompressed bytes read from the archive (decompression-bomb guard). */
  maxUncompressedBytes: number;
}

export interface ExtractedFile {
  path: string;
  language: string | null;
  analysable: boolean;
  generated: boolean;
  sizeBytes: number;
  lineCount: number;
  content: string;
  redactions: number;
}

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface ExtractResult {
  files: ExtractedFile[];
  skipped: SkippedFile[];
  totalEntries: number;
}

/**
 * The path rules shared by every archive format: no NUL, no backslash, not absolute, no '.' or '..' segment. Returns
 * the non-empty segments, or null when the name is unsafe.
 */
export function safePathParts(name: string): string[] | null {
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/')) return null;
  const parts = name.split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '..' || p === '.')) return null;
  return parts;
}

/** Normalise an archive path: strip the single top-level directory, reject traversal and absolute paths. */
export function safeRelativePath(name: string): string | null {
  const parts = safePathParts(name);
  if (parts === null) return null;
  const rest = parts.slice(1); // drop "<repo>-<ref>/" root
  if (rest.length === 0) return null;
  return rest.join('/');
}

class CapStream extends Transform {
  private seen = 0;
  constructor(private readonly cap: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null, d?: Buffer) => void) {
    this.seen += chunk.length;
    if (this.seen > this.cap)
      return cb(new KycError('REPO_TOO_LARGE', 'The repository is larger than the size limit.'));
    cb(null, chunk);
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The per-entry rules every archive format shares (tar from GitHub, ZIP uploads): the entry cap, path
 * classification, per-file size limits, binary and UTF-8 detection, generated-code detection, the analysable-file
 * cap, the total text cap and secret redaction. Archive readers only decode entries and decide path safety.
 */
export class EntryCollector {
  readonly files: ExtractedFile[] = [];
  readonly skipped: SkippedFile[] = [];
  private entries = 0;
  private totalText = 0;
  private analysable = 0;

  constructor(private readonly limits: ExtractLimits) {}

  get totalEntries(): number {
    return this.entries;
  }

  /** Count one archive entry of any type. Throws REPO_TOO_LARGE past the entry cap. */
  countEntry(): void {
    this.entries++;
    if (this.entries > this.limits.maxTotalEntries)
      throw new KycError('REPO_TOO_LARGE', 'The repository has too many files.');
  }

  skip(path: string, reason: SkipReason): void {
    this.skipped.push({ path, reason });
  }

  /**
   * Decide, before reading its content, whether a file at this (already safe, relative) path should be read.
   * Records the skip reason and returns false when not.
   */
  admit(rel: string, declaredSize: number): boolean {
    const verdict = classifyPath(rel);
    if (!verdict.keep) {
      this.skip(rel, verdict.reason);
      return false;
    }
    if (declaredSize > this.limits.maxViewableFileBytes) {
      this.skip(rel, 'file_too_large');
      return false;
    }
    return true;
  }

  /**
   * Add an admitted file's content (at most maxViewableFileBytes of it). Skips binary, non-UTF-8 and over-budget
   * files; throws REPO_TOO_LARGE past the analysable-file cap.
   */
  add(rel: string, buf: Buffer): void {
    const { limits } = this;
    if (looksBinary(buf)) return this.skip(rel, 'binary');
    let text: string;
    try {
      text = utf8.decode(buf);
    } catch {
      return this.skip(rel, 'not_utf8');
    }
    if (this.totalText + buf.length > limits.maxTotalTextBytes) return this.skip(rel, 'total_size_limit');
    const lang = languageOf(rel);
    const generated = isGeneratedPath(rel) || isGeneratedContent(text);
    const isAnalysable =
      lang !== null &&
      ANALYSABLE_EXT.has(extOf(rel)) &&
      !generated &&
      buf.length <= limits.maxAnalysableFileBytes;
    if (!lang && buf.length > 300 * 1024) return this.skip(rel, 'file_too_large');
    if (isAnalysable) {
      this.analysable++;
      if (this.analysable > limits.maxAnalysableFiles) {
        throw new KycError(
          'REPO_TOO_LARGE',
          `This repository has more than ${limits.maxAnalysableFiles.toLocaleString()} analysable files.`,
          {
            limit: limits.maxAnalysableFiles,
          },
        );
      }
    }
    const red = redact(text);
    this.totalText += buf.length;
    this.files.push({
      path: rel,
      language: lang,
      analysable: isAnalysable,
      generated,
      sizeBytes: buf.length,
      lineCount: red.text.length === 0 ? 0 : red.text.split('\n').length,
      content: red.text,
      redactions: red.count,
    });
  }

  result(): ExtractResult {
    return { files: this.files, skipped: this.skipped, totalEntries: this.entries };
  }
}

export async function extractTarball(source: Readable, limits: ExtractLimits): Promise<ExtractResult> {
  const collector = new EntryCollector(limits);

  const extract = tar.extract();
  const gunzip = createGunzip();
  const cap = new CapStream(limits.maxUncompressedBytes);

  const done = new Promise<void>((resolve, reject) => {
    const fail = (e: unknown) =>
      reject(e instanceof KycError ? e : new KycError('INDEX_FAILED', 'The archive could not be read.'));
    source.on('error', fail);
    gunzip.on('error', fail);
    cap.on('error', fail);
    extract.on('error', fail);
    extract.on('finish', resolve);

    extract.on('entry', (header, stream, next) => {
      try {
        collector.countEntry();
      } catch (e) {
        stream.resume();
        return fail(e);
      }
      const skip = (path: string, reason: SkipReason) => {
        collector.skip(path, reason);
        stream.resume();
        stream.on('end', next);
      };
      if (header.type !== 'file') {
        // Directories are implicit. Symlinks/hardlinks/devices are never followed or stored.
        if (header.type === 'symlink' || header.type === 'link') collector.skip(header.name, 'symlink');
        stream.resume();
        return stream.on('end', next);
      }
      const rel = safeRelativePath(header.name);
      if (rel === null) return skip(header.name, 'unsafe_path');
      if (!collector.admit(rel, header.size ?? 0)) {
        stream.resume();
        return stream.on('end', next);
      }

      const chunks: Buffer[] = [];
      let got = 0;
      stream.on('data', (c: unknown) => {
        const b = Buffer.from(c as Uint8Array);
        got += b.length;
        if (got <= limits.maxViewableFileBytes) chunks.push(b);
      });
      stream.on('error', fail);
      stream.on('end', () => {
        try {
          collector.add(rel, Buffer.concat(chunks));
        } catch (e) {
          return fail(e);
        }
        next();
      });
    });
  });

  source.pipe(gunzip).pipe(cap).pipe(extract);
  try {
    await done;
  } finally {
    source.unpipe();
    source.destroy();
  }
  return collector.result();
}
