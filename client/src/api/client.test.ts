import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, createApiClient } from './client';
import { ApiConfigError, resolveBaseUrl, validateApiConfig } from './config';

const PAGE = 'http://localhost:3000';

interface Captured {
  url: string;
  init: RequestInit;
}

function mockFetch(status = 200, body: unknown = { ok: true }) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('resolveBaseUrl', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://example.com/kyc/', 'https://example.com/kyc'],
    ['http://localhost:8080', 'http://localhost:8080'],
  ])('normalises %j to %j', (raw, want) => expect(resolveBaseUrl(raw, { production: true })).toBe(want));

  it.each([
    ['api.example.com', /not an absolute URL/],
    ['ftp://example.com', /must use https/],
    ['https://u:p@example.com', /must not contain credentials/],
    ['https://example.com/?x=1', /query string or fragment/],
    ['https://example.com/#a', /query string or fragment/],
  ])('rejects %j with an understandable message', (raw, msg) => {
    expect(() => resolveBaseUrl(raw, { production: false })).toThrow(ApiConfigError);
    expect(() => resolveBaseUrl(raw, { production: false })).toThrow(msg);
  });

  it('requires https in production builds except for local addresses', () => {
    expect(() => resolveBaseUrl('http://api.example.com', { production: true })).toThrow(
      /https in a production build/,
    );
    expect(resolveBaseUrl('http://api.example.com', { production: false })).toBe('http://api.example.com');
    expect(resolveBaseUrl('http://127.0.0.1:8080', { production: true })).toBe('http://127.0.0.1:8080');
  });
});

describe('validateApiConfig', () => {
  it('refuses cookie authentication against another origin (the server never allows credentialed CORS)', () => {
    expect(() =>
      validateApiConfig({ baseUrl: 'https://api.example.com', auth: { kind: 'cookie' } }, PAGE, true),
    ).toThrow(/use bearer authentication/);
    expect(validateApiConfig({ baseUrl: `${PAGE}/`, auth: { kind: 'cookie' } }, PAGE, false).baseUrl).toBe(
      PAGE,
    );
  });

  it('accepts a cross-origin bearer configuration', () => {
    const c = validateApiConfig(
      { baseUrl: 'https://api.example.com', auth: { kind: 'bearer', getToken: () => null } },
      'tauri://localhost',
      true,
    );
    expect(c.baseUrl).toBe('https://api.example.com');
  });
});

describe('createApiClient', () => {
  it('web default: same-origin relative URLs, cookies, no Authorization header (unchanged behaviour)', async () => {
    const calls = mockFetch(200, { snapshots: [] });
    await api.mySnapshots();
    expect(calls[0]!.url).toBe('/api/v1/my/snapshots');
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect(calls[0]!.init.headers).not.toHaveProperty('authorization');
  });

  it('bearer: absolute URLs, no cookies, the current token on every request', async () => {
    let token: string | null = 'kyc_st_first';
    const client = createApiClient(
      { baseUrl: 'https://api.example.com/', auth: { kind: 'bearer', getToken: () => token } },
      { pageOrigin: 'tauri://localhost', production: true },
    );
    const calls = mockFetch(200, { snapshots: [] });
    await client.mySnapshots();
    token = 'kyc_st_second';
    await client.mySnapshots();
    token = null;
    await client.mySnapshots();
    expect(calls.map((c) => c.url)).toEqual(Array(3).fill('https://api.example.com/api/v1/my/snapshots'));
    expect(calls.every((c) => c.init.credentials === 'omit')).toBe(true);
    expect(calls.map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual([
      'Bearer kyc_st_first',
      'Bearer kyc_st_second',
      undefined,
    ]);
  });

  it('bearer: tells the shell when the server rejects the token', async () => {
    const onUnauthorized = vi.fn();
    const client = createApiClient(
      {
        baseUrl: 'https://api.example.com',
        auth: { kind: 'bearer', getToken: () => 'kyc_st_x', onUnauthorized },
      },
      { pageOrigin: 'tauri://localhost' },
    );
    mockFetch(401, {
      error: { code: 'AUTH_REQUIRED', message: 'Please sign in again to continue.', retryable: false },
    });
    const err = await client.mySnapshots().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('AUTH_REQUIRED');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('sign-in asks for the transport matching the strategy', async () => {
    const calls = mockFetch(200, {
      user: { id: 'u', kind: 'registered', email: 'a@b.co' },
      expiresAt: '',
      claimable: null,
    });
    await api.login('a@b.co', 'secret secret');
    const desktop = createApiClient(
      { baseUrl: 'https://api.example.com', auth: { kind: 'bearer', getToken: () => null } },
      { pageOrigin: 'tauri://localhost' },
    );
    await desktop.login('a@b.co', 'secret secret');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ transport: 'cookie' });
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({ transport: 'bearer' });
  });

  it('sends a share token with reads once set, and streams from the configured base URL', async () => {
    const client = createApiClient(
      { baseUrl: 'https://api.example.com', auth: { kind: 'bearer', getToken: () => null } },
      { pageOrigin: 'tauri://localhost' },
    );
    const calls = mockFetch(200, { root: { name: '/', type: 'dir' } });
    client.setShareToken('kss1.a.b.c');
    await client.tree('s1');
    expect((calls[0]!.init.headers as Record<string, string>)['x-kyc-share']).toBe('kss1.a.b.c');
    client.setShareToken(null);
    await client.tree('s1');
    expect(calls[1]!.init.headers).not.toHaveProperty('x-kyc-share');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push({ url, init: {} });
        return new Response('event: done\ndata: {"ok":true}\n\n', { status: 200 });
      }),
    );
    const events: string[] = [];
    await client.explain(
      {
        snapshotId: 's1',
        selection: { path: 'a.js', startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
        depth: 'default',
      },
      (m) => events.push(m.event),
    );
    expect(calls[2]!.url).toBe('https://api.example.com/api/v1/explanations');
    expect(events).toEqual(['done']);
  });

  it('fails fast and clearly on an invalid configuration', () => {
    expect(() =>
      createApiClient({ baseUrl: 'not a url', auth: { kind: 'cookie' } }, { pageOrigin: PAGE }),
    ).toThrow(/Invalid API configuration/);
  });
});
