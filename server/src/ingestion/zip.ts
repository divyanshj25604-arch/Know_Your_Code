import { inflateRawSync } from 'node:zlib';
import { KycError } from '@kyc/core';
import { EntryCollector, safePathParts, type ExtractLimits, type ExtractResult } from './extract';

/**
 * A small, strict ZIP reader for uploaded projects (no dependency beyond node:zlib). It only reads what a project
 * folder zipped by an operating system or `zip` produces: one disk, no ZIP64, no encryption, entries stored or
 * deflated. Every size is checked against the caller's limits before anything is decompressed, and inflation is
 * capped at the declared size, so a lying header cannot expand past it (decompression-bomb guard).
 */

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export interface ZipEntry {
  /** The raw entry name as stored (decoded as UTF-8; invalid UTF-8 names are marked unsafe). */
  name: string;
  /** False when the stored name is not valid UTF-8 (it can never be a safe path). */
  nameOk: boolean;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttr: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  /** Offset of the central directory: every entry's data must end before it. */
  centralOffset: number;
}

export interface ZipInspectLimits {
  maxTotalEntries: number;
  maxUncompressedBytes: number;
}

const invalid = (message = "We couldn't read this ZIP file.") => new KycError('INVALID_ARCHIVE', message);

/** True when the buffer begins with a ZIP local-file header ("PK\x03\x04"). */
export function hasZipSignature(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === SIG_LOCAL;
}

function findEocd(buf: Buffer): number {
  if (buf.length < EOCD_SIZE) throw invalid();
  const lowest = Math.max(0, buf.length - EOCD_SIZE - MAX_COMMENT);
  for (let i = buf.length - EOCD_SIZE; i >= lowest; i--) {
    if (buf.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLength = buf.readUInt16LE(i + 20);
    // The comment must end exactly at the end of the file; otherwise this is a stray signature inside data.
    if (i + EOCD_SIZE + commentLength === buf.length) return i;
  }
  throw invalid();
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Parse and validate the central directory without decompressing anything. Rejects (INVALID_ARCHIVE) corrupt,
 * empty, multi-disk, ZIP64 and encrypted archives and unsupported compression methods; rejects (REPO_TOO_LARGE)
 * archives over the entry cap or whose declared uncompressed total exceeds the cap.
 */
export function readZipDirectory(buf: Buffer, limits: ZipInspectLimits): ZipDirectory {
  const eocd = findEocd(buf);
  const diskNumber = buf.readUInt16LE(eocd + 4);
  const centralDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);

  if (
    totalEntries === 0xffff ||
    entriesOnDisk === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR)
  )
    throw invalid("This ZIP file uses the ZIP64 format, which isn't supported. Zip a smaller folder.");
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries)
    throw invalid('Split (multi-part) ZIP files are not supported.');
  if (totalEntries === 0) throw invalid('This ZIP file is empty.');
  if (totalEntries > limits.maxTotalEntries)
    throw new KycError('REPO_TOO_LARGE', 'The project has too many files.');
  if (centralOffset + centralSize > eocd) throw invalid();

  const entries: ZipEntry[] = [];
  let declaredTotal = 0;
  let p = centralOffset;
  const end = centralOffset + centralSize;
  for (let n = 0; n < totalEntries; n++) {
    if (p + CENTRAL_SIZE > end || buf.readUInt32LE(p) !== SIG_CENTRAL) throw invalid();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc32 = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const startDisk = buf.readUInt16LE(p + 34);
    const externalAttr = buf.readUInt32LE(p + 38);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const next = p + CENTRAL_SIZE + nameLength + extraLength + commentLength;
    if (next > end) throw invalid();
    const rawName = buf.subarray(p + CENTRAL_SIZE, p + CENTRAL_SIZE + nameLength);
    p = next;

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      startDisk === 0xffff
    )
      throw invalid("This ZIP file uses the ZIP64 format, which isn't supported. Zip a smaller folder.");
    if (flags & FLAG_ENCRYPTED)
      throw invalid('This ZIP file is password-protected. Upload a .zip without a password.');

    let name: string;
    let nameOk = true;
    try {
      // Names without the UTF-8 flag are CP437 in theory, but ASCII decodes the same and macOS writes UTF-8
      // without setting the flag. A name that is not valid UTF-8 is kept only for the skip report.
      name = utf8.decode(rawName);
    } catch {
      name = rawName.toString('latin1');
      nameOk = false;
    }
    const isDirectory = name.endsWith('/');
    const isSymlink = ((externalAttr >>> 16) & S_IFMT) === S_IFLNK;
    if (!isDirectory && !isSymlink && method !== METHOD_STORED && method !== METHOD_DEFLATE)
      throw invalid(
        'This ZIP file uses an unsupported compression method. Use standard (deflate) compression.',
      );
    if (localHeaderOffset + LOCAL_SIZE > centralOffset) throw invalid();
    if (method === METHOD_STORED && compressedSize !== uncompressedSize && !isDirectory) throw invalid();

    declaredTotal += uncompressedSize;
    if (declaredTotal > limits.maxUncompressedBytes)
      throw new KycError('REPO_TOO_LARGE', 'The project is larger than the size limit.');
    entries.push({
      name,
      nameOk,
      method,
      flags,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttr,
      isDirectory,
      isSymlink,
    });
  }
  return { entries, centralOffset };
}

/**
 * Decompress one entry. Inflation stops at the declared size; output of any other length, or a CRC mismatch, means
 * the archive is corrupt or lying about its sizes.
 */
export function readZipEntry(buf: Buffer, dir: ZipDirectory, entry: ZipEntry): Buffer {
  const h = entry.localHeaderOffset;
  if (h + LOCAL_SIZE > dir.centralOffset || buf.readUInt32LE(h) !== SIG_LOCAL) throw invalid();
  if (buf.readUInt16LE(h + 6) & FLAG_ENCRYPTED)
    throw invalid('This ZIP file is password-protected. Upload a .zip without a password.');
  const dataStart = h + LOCAL_SIZE + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > dir.centralOffset) throw invalid();
  const data = buf.subarray(dataStart, dataEnd);
  let out: Buffer;
  if (entry.method === METHOD_STORED) {
    out = Buffer.from(data);
  } else {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
        throw invalid('This ZIP file is damaged: a file is larger than the archive says.');
      throw invalid();
    }
  }
  if (out.length !== entry.uncompressedSize) throw invalid();
  if (crc32(out) !== entry.crc32) throw invalid('This ZIP file is damaged (checksum mismatch).');
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE), as stored in ZIP headers. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** macOS resource forks and Finder metadata: never part of a project. */
function isOsJunk(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const base = name.slice(name.lastIndexOf('/') + 1);
  return base === '.DS_Store';
}

/**
 * The single top-level folder every file shares ("project-main/"), if there is one. Zipping a folder produces one;
 * zipping a folder's contents does not, and then paths are used as they are.
 */
function commonRoot(entries: ZipEntry[]): string | null {
  let root: string | null = null;
  let files = 0;
  for (const e of entries) {
    if (e.isDirectory || !e.nameOk || isOsJunk(e.name)) continue;
    const parts = safePathParts(e.name);
    if (parts === null) continue;
    files++;
    if (parts.length < 2) return null;
    if (root === null) root = parts[0]!;
    else if (parts[0] !== root) return null;
  }
  return files > 0 ? root : null;
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * Extract an uploaded ZIP with the same per-file rules as the GitHub tarball path (EntryCollector). Only files that
 * survive path classification and the size checks are decompressed.
 */
export async function extractZip(buf: Buffer, limits: ExtractLimits): Promise<ExtractResult> {
  const dir = readZipDirectory(buf, limits);
  const collector = new EntryCollector(limits);
  const root = commonRoot(dir.entries);
  let inflated = 0;
  let sinceYield = 0;
  for (const entry of dir.entries) {
    collector.countEntry();
    if (isOsJunk(entry.name)) continue;
    if (entry.isSymlink) {
      // Never followed or stored, exactly like tar symlinks.
      collector.skip(entry.name, 'symlink');
      continue;
    }
    if (entry.isDirectory) continue;
    const parts = entry.nameOk ? safePathParts(entry.name) : null;
    const relParts = parts && root !== null ? parts.slice(1) : parts;
    if (relParts === null || relParts.length === 0) {
      collector.skip(entry.name, 'unsafe_path');
      continue;
    }
    const rel = relParts.join('/');
    if (!collector.admit(rel, entry.uncompressedSize)) continue;
    const data = readZipEntry(buf, dir, entry);
    inflated += data.length;
    if (inflated > limits.maxUncompressedBytes)
      throw new KycError('REPO_TOO_LARGE', 'The project is larger than the size limit.');
    collector.add(rel, data);
    // Keep the event loop responsive: inflation is synchronous.
    sinceYield += data.length;
    if (sinceYield > 4 * 1024 * 1024) {
      sinceYield = 0;
      await yieldToLoop();
    }
  }
  return collector.result();
}
