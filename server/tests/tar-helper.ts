import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';

export interface TarEntry {
  name: string;
  content?: string | Buffer;
  type?: 'file' | 'directory' | 'symlink';
  linkname?: string;
}

/** Build an in-memory .tar.gz, like GitHub's, with root dir "repo-HEAD/". */
export async function buildTarGz(entries: TarEntry[], root = 'repo-HEAD'): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (c: unknown) => chunks.push(Buffer.from(c as Uint8Array)));
  const finished = new Promise<void>((r) => pack.on('end', r));
  pack.entry({ name: `${root}/`, type: 'directory' });
  for (const e of entries) {
    const name = e.name.startsWith('RAW:') ? e.name.slice(4) : `${root}/${e.name}`;
    if (e.type === 'symlink') pack.entry({ name, type: 'symlink', linkname: e.linkname ?? '/etc/passwd' });
    else if (e.type === 'directory') pack.entry({ name: name + '/', type: 'directory' });
    else pack.entry({ name }, e.content ?? '');
  }
  pack.finalize();
  await finished;
  return gzipSync(Buffer.concat(chunks));
}

export function streamOf(buf: Buffer): Readable {
  return Readable.from([buf]);
}
