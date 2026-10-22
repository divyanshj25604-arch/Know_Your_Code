import { Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { AppError } from '../http/errors';
import { redact } from '../privacy/redact';
import {
  ANALYSABLE_EXT,
  classifyPath,
  extOf,
  isGeneratedContent,
  isGeneratedPath,
  languageOf,
  looksBinary,
  type SkipReason,
} from './filter';

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

/** Normalise an archive path: strip the single top-level directory, reject traversal and absolute paths. */
export function safeRelativePath(name: string): string | null {
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/')) return null;
  const parts = name.split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '..' || p === '.')) return null;
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
      return cb(new AppError('REPO_TOO_LARGE', 'The repository is larger than the size limit.'));
    cb(null, chunk);
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

export async function extractTarball(source: Readable, limits: ExtractLimits): Promise<ExtractResult> {
  const files: ExtractedFile[] = [];
  const skipped: SkippedFile[] = [];
  let totalEntries = 0;
  let totalText = 0;
  let analysable = 0;

  const extract = tar.extract();
  const gunzip = createGunzip();
  const cap = new CapStream(limits.maxUncompressedBytes);

  const done = new Promise<void>((resolve, reject) => {
    const fail = (e: unknown) =>
      reject(e instanceof AppError ? e : new AppError('INDEX_FAILED', 'The archive could not be read.'));
    source.on('error', fail);
    gunzip.on('error', fail);
    cap.on('error', fail);
    extract.on('error', fail);
    extract.on('finish', resolve);

    extract.on('entry', (header, stream, next) => {
      totalEntries++;
      if (totalEntries > limits.maxTotalEntries) {
        stream.resume();
        return fail(new AppError('REPO_TOO_LARGE', 'The repository has too many files.'));
      }
      const skip = (path: string, reason: SkipReason) => {
        skipped.push({ path, reason });
        stream.resume();
        stream.on('end', next);
      };
      if (header.type !== 'file') {
        // Directories are implicit. Symlinks/hardlinks/devices are never followed or stored.
        if (header.type === 'symlink' || header.type === 'link')
          skipped.push({ path: header.name, reason: 'symlink' });
        stream.resume();
        return stream.on('end', next);
      }
      const rel = safeRelativePath(header.name);
      if (rel === null) return skip(header.name, 'unsafe_path');
      const verdict = classifyPath(rel);
      if (!verdict.keep) return skip(rel, verdict.reason);
      const size = header.size ?? 0;
      if (size > limits.maxViewableFileBytes) return skip(rel, 'file_too_large');

      const chunks: Buffer[] = [];
      let got = 0;
      stream.on('data', (c: unknown) => {
        const b = Buffer.from(c as Uint8Array);
        got += b.length;
        if (got <= limits.maxViewableFileBytes) chunks.push(b);
      });
      stream.on('error', fail);
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (looksBinary(buf)) {
          skipped.push({ path: rel, reason: 'binary' });
          return next();
        }
        let text: string;
        try {
          text = utf8.decode(buf);
        } catch {
          skipped.push({ path: rel, reason: 'not_utf8' });
          return next();
        }
        if (totalText + buf.length > limits.maxTotalTextBytes) {
          skipped.push({ path: rel, reason: 'total_size_limit' });
          return next();
        }
        const lang = languageOf(rel);
        const generated = isGeneratedPath(rel) || isGeneratedContent(text);
        const isAnalysable =
          lang !== null &&
          ANALYSABLE_EXT.has(extOf(rel)) &&
          !generated &&
          buf.length <= limits.maxAnalysableFileBytes;
        if (!lang && buf.length > 300 * 1024) {
          skipped.push({ path: rel, reason: 'file_too_large' });
          return next();
        }
        if (isAnalysable) {
          analysable++;
          if (analysable > limits.maxAnalysableFiles) {
            return fail(
              new AppError(
                'REPO_TOO_LARGE',
                `This repository has more than ${limits.maxAnalysableFiles.toLocaleString()} analysable files.`,
                {
                  limit: limits.maxAnalysableFiles,
                },
              ),
            );
          }
        }
        const red = redact(text);
        totalText += buf.length;
        files.push({
          path: rel,
          language: lang,
          analysable: isAnalysable,
          generated,
          sizeBytes: buf.length,
          lineCount: red.text.length === 0 ? 0 : red.text.split('\n').length,
          content: red.text,
          redactions: red.count,
        });
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
  return { files, skipped, totalEntries };
}
