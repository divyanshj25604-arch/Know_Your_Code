import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AppError } from '../http/errors';
import type { Config } from '../config/env';
import type { RepoRef } from './url';
import { isSafeRef } from './url';

export interface RepoMeta {
  private: boolean;
  defaultBranch: string;
  sizeKb: number;
}

export interface TarballHandle {
  stream: Readable;
  /** Commit SHA when known (API mode, or the user named a full SHA). */
  commitSha: string | null;
  /** Cancels the download (call on failure/timeout). */
  abort: () => void;
}

const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_REDIRECTS = 3;

/**
 * Minimal GitHub client. All outbound requests go to two fixed, configured hosts (GitHub API and codeload);
 * user input only ever becomes a validated path segment. Redirects are followed manually and only to the
 * configured hosts (docs/07 §10 SSRF).
 */
export class GitHubClient {
  private readonly allowedHosts: Set<string>;
  constructor(
    private readonly config: Pick<
      Config,
      | 'GITHUB_TOKEN'
      | 'GITHUB_API_BASE'
      | 'GITHUB_CODELOAD_BASE'
      | 'MAX_TARBALL_BYTES'
      | 'MAX_REPORTED_REPO_KB'
    >,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.allowedHosts = new Set([
      new URL(config.GITHUB_API_BASE).host,
      new URL(config.GITHUB_CODELOAD_BASE).host,
    ]);
  }

  get hasToken(): boolean {
    return Boolean(this.config.GITHUB_TOKEN);
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'know-your-code',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.config.GITHUB_TOKEN ? { Authorization: `Bearer ${this.config.GITHUB_TOKEN}` } : {}),
    };
  }

  private async request(
    url: URL,
    init: { signal: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!this.allowedHosts.has(current.host))
        throw new AppError('INDEX_FAILED', 'The download was redirected somewhere unexpected.');
      if (current.protocol !== 'https:' && current.protocol !== 'http:') throw new AppError('INDEX_FAILED');
      let res: Response;
      try {
        res = await this.fetchImpl(current, {
          redirect: 'manual',
          signal: init.signal,
          headers: init.headers ?? this.headers(),
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') {
          throw new AppError('SERVICE_UNAVAILABLE', 'GitHub took too long to respond.');
        }
        throw new AppError('SERVICE_UNAVAILABLE', "We couldn't reach GitHub.");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw new AppError('INDEX_FAILED');
        current = new URL(loc, current);
        // Never forward credentials across hosts.
        init = { ...init, headers: { Accept: '*/*', 'User-Agent': 'know-your-code' } };
        continue;
      }
      return res;
    }
    throw new AppError('INDEX_FAILED', 'Too many redirects while downloading.');
  }

  private mapStatus(res: Response): AppError {
    if (res.status === 404) return new AppError('REPO_NOT_FOUND_OR_PRIVATE');
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (res.status === 429 || remaining === '0' || res.headers.has('retry-after')) {
        return new AppError('GITHUB_RATE_LIMITED');
      }
      return new AppError('REPO_NOT_FOUND_OR_PRIVATE');
    }
    if (res.status === 401)
      return new AppError('SERVICE_UNAVAILABLE', 'GitHub authentication failed on our side.');
    return new AppError('SERVICE_UNAVAILABLE', "GitHub isn't responding as expected.");
  }

  /** Repo metadata. Only available with a token; anonymous API quota (60/h) is too small to rely on. */
  async getMeta(repo: RepoRef, signal: AbortSignal): Promise<RepoMeta | null> {
    if (!this.hasToken) return null;
    const url = new URL(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
      this.config.GITHUB_API_BASE,
    );
    const res = await this.request(url, { signal });
    if (!res.ok) throw this.mapStatus(res);
    const j = (await res.json()) as { private?: boolean; default_branch?: string; size?: number };
    if (j.private) throw new AppError('REPO_NOT_FOUND_OR_PRIVATE');
    const meta: RepoMeta = {
      private: false,
      defaultBranch: String(j.default_branch ?? 'HEAD'),
      sizeKb: Number(j.size ?? 0),
    };
    if (meta.sizeKb > this.config.MAX_REPORTED_REPO_KB) {
      throw new AppError(
        'REPO_TOO_LARGE',
        `This repository is about ${Math.round(meta.sizeKb / 1024)} MB; the limit is ${Math.round(this.config.MAX_REPORTED_REPO_KB / 1024)} MB.`,
        {
          sizeKb: meta.sizeKb,
          limitKb: this.config.MAX_REPORTED_REPO_KB,
        },
      );
    }
    return meta;
  }

  async resolveSha(repo: RepoRef, ref: string, signal: AbortSignal): Promise<string> {
    if (SHA_RE.test(ref)) return ref.toLowerCase();
    const url = new URL(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits/${ref.split('/').map(encodeURIComponent).join('/')}`,
      this.config.GITHUB_API_BASE,
    );
    const res = await this.request(url, {
      signal,
      headers: { ...this.headers(), Accept: 'application/vnd.github.sha' },
    });
    if (res.status === 404 || res.status === 422)
      throw new AppError(
        'REPO_NOT_FOUND_OR_PRIVATE',
        'That branch, tag, or commit does not exist in this repository.',
      );
    if (!res.ok) throw this.mapStatus(res);
    const sha = (await res.text()).trim();
    if (!SHA_RE.test(sha)) throw new AppError('SERVICE_UNAVAILABLE', "GitHub isn't responding as expected.");
    return sha.toLowerCase();
  }

  /**
   * Open the archive stream. API mode: resolve to a commit SHA first (stable snapshot). Anonymous mode:
   * download straight from codeload by ref (or HEAD), SHA unknown.
   */
  async openTarball(repo: RepoRef, signal: AbortSignal): Promise<TarballHandle> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    let sha: string | null = null;
    let url: URL;
    const owner = encodeURIComponent(repo.owner);
    const name = encodeURIComponent(repo.name);

    if (this.hasToken) {
      const meta = await this.getMeta(repo, controller.signal);
      const ref = repo.ref ?? meta?.defaultBranch ?? 'HEAD';
      if (!isSafeRef(ref) && ref !== 'HEAD') throw new AppError('INVALID_URL');
      sha = await this.resolveSha(repo, ref, controller.signal);
      url = new URL(`/repos/${owner}/${name}/tarball/${sha}`, this.config.GITHUB_API_BASE);
    } else {
      const ref = repo.ref ?? 'HEAD';
      if (ref !== 'HEAD' && !isSafeRef(ref)) throw new AppError('INVALID_URL');
      if (SHA_RE.test(ref)) sha = ref.toLowerCase();
      url = new URL(
        `/${owner}/${name}/tar.gz/${ref.split('/').map(encodeURIComponent).join('/')}`,
        this.config.GITHUB_CODELOAD_BASE,
      );
    }

    const res = await this.request(url, { signal: controller.signal });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw this.mapStatus(res);
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > this.config.MAX_TARBALL_BYTES) {
      await res.body.cancel().catch(() => undefined);
      throw new AppError(
        'REPO_TOO_LARGE',
        `The download is ${Math.round(declared / 1048576)} MB; the limit is ${Math.round(this.config.MAX_TARBALL_BYTES / 1048576)} MB.`,
      );
    }
    const max = this.config.MAX_TARBALL_BYTES;
    let seen = 0;
    const raw = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    const limited = raw.pipe(
      new Transform({
        transform(chunk: Buffer, _e, cb) {
          seen += chunk.length;
          if (seen > max) return cb(new AppError('REPO_TOO_LARGE', 'The download exceeded the size limit.'));
          cb(null, chunk);
        },
      }),
    );
    raw.on('error', (e) => limited.destroy(e));
    return {
      stream: limited,
      commitSha: sha,
      abort: () => {
        controller.abort();
        raw.destroy();
      },
    };
  }
}
