import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../src/ingestion/zip';

export interface ZipTestEntry {
  /** Stored exactly as given (no root folder is added). */
  name: string;
  content?: string | Buffer;
  /** 'deflate' (default) or 'stored'. */
  method?: 'deflate' | 'stored';
  symlink?: boolean;
  /** Set the "encrypted" flag bit (content is not actually encrypted). */
  encrypted?: boolean;
  /** Lie about the uncompressed size in the headers. */
  declaredSize?: number;
  /** Raw compression method number (overrides `method`). */
  rawMethod?: number;
}

/** A small ZIP writer for tests: one disk, no ZIP64 unless asked, optional lies for hostile-archive cases. */
export function buildZip(entries: ZipTestEntry[], opts: { zip64Count?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content ?? '', 'utf8');
    const isDir = e.name.endsWith('/');
    const stored = e.method === 'stored' || isDir;
    const body = stored ? data : deflateRawSync(data);
    const method = e.rawMethod ?? (stored ? 0 : 8);
    const crc = crc32(data);
    const usize = e.declaredSize ?? data.length;
    const name = Buffer.from(e.name, 'utf8');
    const flags = 0x0800 | (e.encrypted ? 1 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const mode = e.symlink ? 0o120777 : isDir ? 0o040755 : 0o100644;
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = opts.zip64Count ? 0xffff : entries.length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Files under an optional root folder, deflated. */
export function zipFiles(files: Record<string, string>, root?: string): Buffer {
  return buildZip(
    Object.entries(files).map(([name, content]) => ({ name: root ? `${root}/${name}` : name, content })),
  );
}
