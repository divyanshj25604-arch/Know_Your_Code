import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';

/**
 * One client device for tests: a browser with its own cookie jar, or a bearer-token client (desktop). Honours every
 * Set-Cookie on a response, including deletions, so session and anonymous cookies behave as in a real browser.
 */
export class Device {
  readonly jar = new Map<string, string>();
  token: string | null = null;

  constructor(
    private readonly app: () => FastifyInstance,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  /** A desktop-style client: bearer token only, never cookies, optionally from a foreign Origin. */
  static bearer(app: () => FastifyInstance, origin?: string) {
    const d = new Device(app, origin ? { origin } : {});
    d.cookies = false;
    return d;
  }

  cookies = true;

  get cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...this.extraHeaders,
      ...(this.cookies && this.jar.size ? { cookie: this.cookieHeader } : {}),
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  private absorb(res: LightMyRequestResponse) {
    if (!this.cookies) return;
    const raw = res.headers['set-cookie'];
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
    for (const c of list) {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim());
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const expired =
        value === '' ||
        attrs.some((a) => /^max-age=0$/i.test(a)) ||
        attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)).getTime() < Date.now());
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request(method: string, url: string, payload?: unknown, extra: Record<string, string> = {}) {
    const res = await this.app().inject({
      method: method as 'GET',
      url,
      headers: this.headers(extra),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    this.absorb(res);
    return res;
  }

  get(url: string, extra?: Record<string, string>) {
    return this.request('GET', url, undefined, extra);
  }
  post(url: string, payload: unknown = {}, extra?: Record<string, string>) {
    return this.request('POST', url, payload, extra);
  }
  delete(url: string, extra?: Record<string, string>) {
    return this.request('DELETE', url, undefined, extra);
  }

  async register(
    email: string,
    password = 'correct horse battery',
    transport: 'cookie' | 'bearer' = 'cookie',
  ) {
    const res = await this.post('/api/v1/auth/register', { email, password, transport });
    if (transport === 'bearer' && res.statusCode === 201) this.token = res.json().token as string;
    return res;
  }

  async login(email: string, password = 'correct horse battery', transport: 'cookie' | 'bearer' = 'cookie') {
    const res = await this.post('/api/v1/auth/login', { email, password, transport });
    if (transport === 'bearer' && res.statusCode === 200) this.token = res.json().token as string;
    return res;
  }

  async importRepo(name: string, ref?: string) {
    const res = await this.post('/api/v1/repositories', {
      url: `https://github.com/${name}`,
      ...(ref ? { ref } : {}),
    });
    if (res.statusCode !== 202) throw new Error(`import failed: ${res.statusCode} ${res.body}`);
    await this.app().services.runner.idle();
    return res.json() as { snapshotId: string; repositoryId: string };
  }

  async mySnapshots(): Promise<{ snapshotId: string; repository: { owner: string; name: string } }[]> {
    const res = await this.get('/api/v1/my/snapshots');
    if (res.statusCode !== 200) throw new Error(`my/snapshots: ${res.statusCode} ${res.body}`);
    return res.json().snapshots;
  }
}
