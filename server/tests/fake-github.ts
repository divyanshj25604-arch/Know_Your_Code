import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildTarGz, type TarEntry } from './tar-helper';
import { loadFixture } from './fixture-loader';

export interface FakeGitHub {
  base: string;
  /** Register a repo so GET /{owner}/{repo}/tar.gz/{ref} serves it (any ref). */
  add(owner: string, repo: string, tgz: Buffer | (() => Promise<Buffer>)): void;
  /** Make a repo answer with a fixed status (e.g. 403 + rate-limit header, 503). */
  fail(owner: string, repo: string, status: number, headers?: Record<string, string>): void;
  requests: string[];
  close(): Promise<void>;
}

/** Stands in for codeload.github.com so the real HTTP + extraction + analysis path runs in tests. */
export async function startFakeGitHub(): Promise<FakeGitHub> {
  const repos = new Map<string, Buffer | (() => Promise<Buffer>)>();
  const requests: string[] = [];
  const failures = new Map<string, { status: number; headers: Record<string, string> }>();
  const server = http.createServer(async (req, res) => {
    requests.push(req.url ?? '');
    const m = /^\/([^/]+)\/([^/]+)\/tar\.gz\/(.+)$/.exec(req.url ?? '');
    const fail = m ? failures.get(`${m[1]}/${m[2]}`) : undefined;
    if (fail) {
      res.writeHead(fail.status, fail.headers).end('x');
      return;
    }
    const entry = m ? repos.get(`${m[1]}/${m[2]}`) : undefined;
    if (!entry) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = typeof entry === 'function' ? await entry() : entry;
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': body.length });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    add: (o, r, t) => repos.set(`${o}/${r}`, t),
    fail: (o, r, status, headers = {}) => failures.set(`${o}/${r}`, { status, headers }),
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export async function fixtureTarball(name: string, extra: TarEntry[] = []): Promise<Buffer> {
  const files = loadFixture(name).map((f) => ({ name: f.path, content: f.content }));
  return buildTarGz([...files, ...extra]);
}
