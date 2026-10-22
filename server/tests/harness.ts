import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { LlmClient } from '../src/ai/llm';
import type { Db } from '../src/db/pool';
import { fixtureTarball, startFakeGitHub, type FakeGitHub } from './fake-github';
import { testConfig, testDb } from './helpers';
import type { TarEntry } from './tar-helper';

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith(':'))
    .map((b) => {
      const event = /^event: (.+)$/m.exec(b)?.[1] ?? '';
      const data = JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? '{}');
      return { event, data };
    });
}

export class Harness {
  gh!: FakeGitHub;
  db!: Db;
  app!: FastifyInstance;
  cookie = '';

  async start() {
    this.gh = await startFakeGitHub();
    this.db = testDb();
  }

  async stop() {
    await this.gh.close();
    await this.db.end();
  }

  async reset(
    opts: {
      llm?: LlmClient | null;
      env?: Record<string, string>;
      repos?: Record<string, { fixture: string; extra?: TarEntry[] }>;
    } = {},
  ) {
    await this.db.query('TRUNCATE owners, deletion_log, events, llm_calls CASCADE');
    this.cookie = '';
    for (const [name, r] of Object.entries(opts.repos ?? {})) {
      const [o, n] = name.split('/') as [string, string];
      this.gh.add(o, n, await fixtureTarball(r.fixture, r.extra ?? []));
    }
    const config = testConfig({ GITHUB_CODELOAD_BASE: this.gh.base, ...(opts.env ?? {}) });
    this.app = await buildApp({
      config,
      db: this.db,
      ...(opts.llm !== undefined ? { overrides: { llm: opts.llm } } : {}),
    });
  }

  async close() {
    await this.app.close();
  }

  headers(extra: Record<string, string> = {}) {
    return { ...(this.cookie ? { cookie: this.cookie } : {}), ...extra };
  }

  async post(url: string, payload: unknown, asCookie?: string) {
    const res = await this.app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: asCookie ? { cookie: asCookie } : this.headers(),
    });
    const sc = res.headers['set-cookie'];
    if (sc && !asCookie) this.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
    return res;
  }

  get(url: string, asCookie?: string) {
    return this.app.inject({ url, headers: asCookie ? { cookie: asCookie } : this.headers() });
  }

  async importRepo(url: string) {
    const res = await this.post('/api/v1/repositories', { url });
    if (res.statusCode !== 202) throw new Error(`import failed: ${res.body}`);
    const { snapshotId, repositoryId } = res.json();
    await this.app.services.runner.idle();
    const snap = (await this.get(`/api/v1/snapshots/${snapshotId}`)).json();
    return { snapshotId: snapshotId as string, repositoryId: repositoryId as string, snap };
  }

  async sse(url: string, payload: unknown, asCookie?: string) {
    const res = await this.post(url, payload, asCookie);
    if (!res.headers['content-type']?.toString().startsWith('text/event-stream')) {
      return { status: res.statusCode, json: res.json(), events: [] as SseEvent[] };
    }
    return { status: res.statusCode, json: null, events: parseSse(res.body) };
  }
}
