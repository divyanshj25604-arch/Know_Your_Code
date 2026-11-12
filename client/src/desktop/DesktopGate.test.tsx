import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import type { DesktopBridge } from './bridge';
import { DesktopGate } from './DesktopGate';

const API = 'https://api.example.com';
const TOKEN = `kyc_st_${'a'.repeat(43)}`;
const TOKEN2 = `kyc_st_${'b'.repeat(43)}`;

/** An in-memory stand-in for the native side: the "keychain" and settings survive "restarts" (new renders). */
function memoryBridge(over: Partial<{ apiUrl: string | null; tokens: Map<string, string> }> = {}) {
  const state = { apiUrl: over.apiUrl ?? null, tokens: over.tokens ?? new Map<string, string>() };
  const bridge: DesktopBridge = {
    info: async () => ({ allowedOrigins: [API], defaultApiUrl: API, development: false, version: '1.0.0' }),
    getApiUrl: async () => state.apiUrl,
    setApiUrl: async (u) => {
      state.apiUrl = u;
      return u;
    },
    getToken: async (u) => state.tokens.get(u) ?? null,
    setToken: async (u, t) => void state.tokens.set(u, t),
    clearToken: async (u) => void state.tokens.delete(u),
  };
  return { bridge, state };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const calls: { url: string; auth: string | null; credentials: RequestCredentials | undefined }[] = [];
function serve(h: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), auth: headers.authorization ?? null, credentials: init.credentials });
      return h(String(url), init);
    }),
  );
}
const health = () =>
  Response.json({ status: 'ok', db: 'ok', ai: 'configured', github: 'token', queueDepth: 0, version: 't' });
const user = { id: 'u1', kind: 'registered', email: 'ada@example.com', createdAt: '2026-01-01T00:00:00Z' };
const authRequired = () =>
  Response.json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in', retryable: false } }, { status: 401 });

/** A tiny cloud API: one account, sessions as a set of valid tokens. */
function cloud(valid = new Set<string>([TOKEN])): Handler {
  return (url, init) => {
    const auth = ((init.headers ?? {}) as Record<string, string>).authorization;
    const path = new URL(url).pathname;
    if (path === '/api/v1/health') return health();
    if (path === '/api/v1/auth/login') {
      const b = JSON.parse(String(init.body)) as { password: string; transport: string };
      expect(b.transport).toBe('bearer');
      if (b.password !== 'correct horse')
        return Response.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'That email and password do not match.',
              retryable: false,
            },
          },
          { status: 401 },
        );
      valid.add(TOKEN2);
      return Response.json({ user, expiresAt: '2027-01-01T00:00:00Z', token: TOKEN2, claimable: null });
    }
    if (path === '/api/v1/auth/me') {
      if (!auth || !valid.has(auth.slice(7))) return authRequired();
      return Response.json({ user });
    }
    if (path === '/api/v1/auth/logout') {
      if (auth) valid.delete(auth.slice(7));
      return new Response(null, { status: 204 });
    }
    return Response.json({ snapshots: [] });
  };
}

const App = () => <p>The app</p>;

describe('desktop gate (P4.1)', () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('first launch: offers the default server, then signs in and stores the token in the credential store', async () => {
    serve(cloud());
    const { bridge, state } = memoryBridge();
    render(
      <DesktopGate bridge={bridge}>
        <App />
      </DesktopGate>,
    );
    const server = await screen.findByLabelText('Server address');
    expect(server).toHaveValue(API);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(state.apiUrl).toBe(API);

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(state.tokens.size).toBe(0);

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The app')).toBeInTheDocument();
    expect(state.tokens.get(API)).toBe(TOKEN2);
    // The app's client now calls the cloud API with the bearer token and never sends cookies.
    await api.mySnapshots();
    const last = calls.at(-1)!;
    expect(last.url).toBe(`${API}/api/v1/my/snapshots`);
    expect(last.auth).toBe(`Bearer ${TOKEN2}`);
    expect(last.credentials).toBe('omit');
    // Nothing went to web storage.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('kyc_st_');
  });

  it('restart: restores the saved session without asking again', async () => {
    serve(cloud());
    const { bridge } = memoryBridge({ apiUrl: API, tokens: new Map([[API, TOKEN]]) });
    render(
      <DesktopGate bridge={bridge}>
        <App />
      </DesktopGate>,
    );
    expect(await screen.findByText('The app')).toBeInTheDocument();
    expect(screen.getByText(/Signed in as ada@example.com · api.example.com/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/auth/me'))!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('an expired saved session is deleted and the user is asked to sign in', async () => {
    serve(cloud(new Set()));
    const { bridge, state } = memoryBridge({ apiUrl: API, tokens: new Map([[API, TOKEN]]) });
    render(
      <DesktopGate bridge={bridge}>
        <App />
      </DesktopGate>,
    );
    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
    await waitFor(() => expect(state.tokens.size).toBe(0));
  });

  it('a session that expires while the app is open returns to sign-in and forgets the token', async () => {
    const valid = new Set([TOKEN]);
    serve(cloud(valid));
    const { bridge, state } = memoryBridge({ apiUrl: API, tokens: new Map([[API, TOKEN]]) });
    render(
      <DesktopGate bridge={bridge}>
        <App />
      </DesktopGate>,
    );
    await screen.findByText('The app');
    valid.clear(); // revoked or expired on the server
    serve((url, init) =>
      new URL(url).pathname === '/api/v1/my/snapshots' ? authRequired() : cloud(valid)(url, init),
    );
    await expect(api.mySnapshots()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    await waitFor(() => expect(state.tokens.size).toBe(0));
  });

  it('sign out revokes the session on the server and removes the stored token', async () => {
    const valid = new Set([TOKEN]);
    serve(cloud(valid));
    const { bridge, state } = memoryBridge({ apiUrl: API, tokens: new Map([[API, TOKEN]]) });
    render(
      <DesktopGate bridge={bridge}>
        <App />
      </DesktopGate>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
    expect(state.tokens.size).toBe(0);
    expect(valid.has(TOKEN)).toBe(false);
    expect(calls.find((c) => c.url.endsWith('/auth/logout'))!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('shows a clear error when the server cannot be reached, and refuses servers outside the build allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { bridge, state } = memoryBridge();
    render(
      <DesktopGate bridge={bridge}>
        <App />
      </DesktopGate>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't reach the Know Your Code server at api.example.com",
    );
    expect(state.apiUrl).toBeNull();

    const input = screen.getByLabelText('Server address');
    await userEvent.clear(input);
    await userEvent.type(input, 'http://api.example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/must use https/);

    // A release build never talks to a local server, even one typed in by hand.
    await userEvent.clear(screen.getByLabelText('Server address'));
    await userEvent.type(screen.getByLabelText('Server address'), 'http://localhost:8080');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This app can only connect to');

    await userEvent.clear(screen.getByLabelText('Server address'));
    await userEvent.type(screen.getByLabelText('Server address'), 'https://other.example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This app can only connect to: https://api.example.com',
    );
    expect(state.apiUrl).toBeNull();
  });
});
