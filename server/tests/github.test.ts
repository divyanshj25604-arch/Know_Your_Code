import { describe, expect, it } from 'vitest';
import { GitHubClient } from '../src/ingestion/github';
import { buildTarGz } from './tar-helper';

const base = {
  GITHUB_API_BASE: 'https://api.github.com',
  GITHUB_CODELOAD_BASE: 'https://codeload.github.com',
  MAX_TARBALL_BYTES: 1_000_000,
  MAX_REPORTED_REPO_KB: 1000,
};

const sig = () => new AbortController().signal;
type F = typeof fetch;
const mk = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): F =>
  (async (input: URL | string, init?: RequestInit) => handler(String(input), init)) as F;

describe('GitHubClient', () => {
  it('anonymous mode downloads from codeload by ref and never calls the API', async () => {
    const tgz = await buildTarGz([{ name: 'a.js', content: 'x' }]);
    const calls: string[] = [];
    const gh = new GitHubClient(
      { ...base },
      mk((u) => {
        calls.push(u);
        return new Response(new Uint8Array(tgz), { status: 200 });
      }),
    );
    const h = await gh.openTarball({ owner: 'a', name: 'b', ref: 'feature/x' }, sig());
    expect(calls).toEqual(['https://codeload.github.com/a/b/tar.gz/feature/x']);
    expect(h.commitSha).toBeNull();
    h.abort();
  });

  it('uses HEAD when no ref is given', async () => {
    const calls: string[] = [];
    const gh = new GitHubClient(
      { ...base },
      mk((u) => {
        calls.push(u);
        return new Response('x', { status: 200 });
      }),
    );
    const h = await gh.openTarball({ owner: 'a', name: 'b' }, sig());
    expect(calls[0]).toBe('https://codeload.github.com/a/b/tar.gz/HEAD');
    h.abort();
  });

  it('token mode checks metadata, resolves the SHA, and sends the token only to the API host', async () => {
    const sha = 'a'.repeat(40);
    const seen: { url: string; auth?: string | null }[] = [];
    const gh = new GitHubClient(
      { ...base, GITHUB_TOKEN: 'ghp_secrettokenvalue' },
      mk((u, init) => {
        const h = new Headers(init?.headers);
        seen.push({ url: u, auth: h.get('authorization') });
        if (u.endsWith('/repos/o/r'))
          return Response.json({ private: false, default_branch: 'main', size: 10 });
        if (u.includes('/commits/main')) return new Response(sha);
        if (u.includes('/tarball/'))
          return new Response(null, {
            status: 302,
            headers: { location: `https://codeload.github.com/o/r/legacy.tar.gz/${sha}` },
          });
        return new Response('tar', { status: 200 });
      }),
    );
    const h = await gh.openTarball({ owner: 'o', name: 'r' }, sig());
    expect(h.commitSha).toBe(sha);
    const codeload = seen.find((s) => s.url.startsWith('https://codeload'))!;
    expect(codeload.auth).toBeNull();
    expect(seen.find((s) => s.url.endsWith('/repos/o/r'))!.auth).toBe('Bearer ghp_secrettokenvalue');
    h.abort();
  });

  it('refuses redirects to unexpected hosts (SSRF)', async () => {
    const gh = new GitHubClient(
      { ...base },
      mk(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data' },
          }),
      ),
    );
    await expect(gh.openTarball({ owner: 'a', name: 'b' }, sig())).rejects.toMatchObject({
      code: 'INDEX_FAILED',
    });
  });

  it('maps 404 to a public-only message and rate limits to GITHUB_RATE_LIMITED', async () => {
    const g404 = new GitHubClient(
      { ...base },
      mk(() => new Response('', { status: 404 })),
    );
    await expect(g404.openTarball({ owner: 'a', name: 'b' }, sig())).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND_OR_PRIVATE',
    });
    const g429 = new GitHubClient(
      { ...base },
      mk(() => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })),
    );
    await expect(g429.openTarball({ owner: 'a', name: 'b' }, sig())).rejects.toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
    });
  });

  it('rejects private repos and oversized repos from metadata before downloading', async () => {
    const mkMeta = (body: object) =>
      new GitHubClient(
        { ...base, GITHUB_TOKEN: 't' },
        mk(() => Response.json(body)),
      );
    await expect(
      mkMeta({ private: true }).openTarball({ owner: 'a', name: 'b' }, sig()),
    ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND_OR_PRIVATE' });
    await expect(
      mkMeta({ private: false, default_branch: 'main', size: 5000 }).openTarball(
        { owner: 'a', name: 'b' },
        sig(),
      ),
    ).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('rejects a download whose declared or actual size exceeds the cap', async () => {
    const declared = new GitHubClient(
      { ...base, MAX_TARBALL_BYTES: 10 },
      mk(() => new Response('x', { status: 200, headers: { 'content-length': '999' } })),
    );
    await expect(declared.openTarball({ owner: 'a', name: 'b' }, sig())).rejects.toMatchObject({
      code: 'REPO_TOO_LARGE',
    });

    const actual = new GitHubClient(
      { ...base, MAX_TARBALL_BYTES: 10 },
      mk(() => new Response('x'.repeat(100), { status: 200 })),
    );
    const h = await actual.openTarball({ owner: 'a', name: 'b' }, sig());
    await expect(
      (async () => {
        for await (const _ of h.stream) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('reports network failure without leaking internals', async () => {
    const gh = new GitHubClient(
      { ...base },
      mk(() => {
        throw new Error('ECONNRESET 10.0.0.5:443');
      }),
    );
    const err = await gh.openTarball({ owner: 'a', name: 'b' }, sig()).catch((e) => e);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.message).not.toContain('10.0.0.5');
  });
});
