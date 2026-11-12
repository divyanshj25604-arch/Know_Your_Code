import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, createApiClient, useApiClient, type ApiClient } from '../api/client';
import { ApiConfigError, resolveBaseUrl } from '../api/config';
import { queries } from '../state/queryCache';
import type { DesktopBridge, DesktopInfo } from './bridge';

/**
 * The desktop shell's start-up and account flow (P4.1). Before the app renders, it needs a cloud API address and a
 * signed-in account (cross-origin clients authenticate with bearer tokens only; there is no anonymous mode).
 *
 *  1. Server: the saved address, or the build's default. It must be reachable (`/api/v1/health`).
 *  2. Session: the token saved in the OS credential store for that server, checked with `/auth/me`. An expired or
 *     revoked token is deleted and the user signs in again.
 *  3. Ready: the app runs against the cloud API. Sign out revokes the session on the server and deletes the stored
 *     token. The token is held in memory and in the credential store only: never in web storage or a file.
 */
type Phase =
  | { kind: 'loading'; message: string }
  | { kind: 'connect'; initial: string; error: string | null }
  | { kind: 'signin'; apiUrl: string; notice: string | null }
  | { kind: 'ready'; apiUrl: string; email: string | null };

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const unreachable = (url: string) =>
  `Couldn't reach the Know Your Code server at ${host(url)}. Check your internet connection and the server address, then try again.`;

export function DesktopGate({ bridge, children }: { bridge: DesktopBridge; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', message: 'Starting…' });
  const info = useRef<DesktopInfo | null>(null);
  const token = useRef<string | null>(null);
  const client = useRef<ApiClient | null>(null);

  /** A bearer client for this server. Any 401 means the session ended: forget it and ask to sign in. */
  const clientFor = useCallback(
    (apiUrl: string) =>
      createApiClient(
        {
          baseUrl: apiUrl,
          auth: {
            kind: 'bearer',
            getToken: () => token.current,
            onUnauthorized: () => {
              if (!token.current) return;
              token.current = null;
              queries.invalidate('');
              void bridge.clearToken(apiUrl).catch(() => undefined);
              setPhase({ kind: 'signin', apiUrl, notice: 'Your session has ended. Please sign in again.' });
            },
          },
        },
        { pageOrigin: null, production: !info.current?.development },
      ),
    [bridge],
  );

  /** Check the server answers, then restore the saved session if there is one. */
  const open = useCallback(
    async (apiUrl: string) => {
      setPhase({ kind: 'loading', message: `Connecting to ${host(apiUrl)}…` });
      let c: ApiClient;
      try {
        c = clientFor(apiUrl);
      } catch (e) {
        setPhase({ kind: 'connect', initial: apiUrl, error: (e as Error).message });
        return;
      }
      client.current = c;
      try {
        await c.health();
      } catch (e) {
        // A 503 still proves the server exists; anything without a status is a network failure.
        if (!(e instanceof ApiError) || e.status === 0) {
          setPhase({ kind: 'connect', initial: apiUrl, error: unreachable(apiUrl) });
          return;
        }
      }
      let saved: string | null;
      try {
        saved = await bridge.getToken(apiUrl);
      } catch (e) {
        setPhase({ kind: 'signin', apiUrl, notice: (e as Error).message });
        return;
      }
      if (!saved) {
        setPhase({ kind: 'signin', apiUrl, notice: null });
        return;
      }
      token.current = saved;
      try {
        const me = await c.me();
        if (me.user?.kind === 'registered') {
          useApiClient(c);
          setPhase({ kind: 'ready', apiUrl, email: me.user.email });
          return;
        }
        throw new ApiError('AUTH_REQUIRED', '', false, 401);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'AUTH_REQUIRED') {
          token.current = null;
          await bridge.clearToken(apiUrl).catch(() => undefined);
          setPhase({ kind: 'signin', apiUrl, notice: 'Your session has ended. Please sign in again.' });
        } else {
          token.current = null;
          setPhase({ kind: 'connect', initial: apiUrl, error: unreachable(apiUrl) });
        }
      }
    },
    [bridge, clientFor],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        info.current = await bridge.info();
        const saved = await bridge.getApiUrl();
        if (cancelled) return;
        if (saved) await open(saved);
        else setPhase({ kind: 'connect', initial: info.current.defaultApiUrl ?? '', error: null });
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'connect', initial: '', error: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, open]);

  const connect = async (raw: string) => {
    const dev = info.current?.development ?? false;
    let url: string;
    try {
      url = resolveBaseUrl(raw, { production: !dev });
      if (url === '') throw new ApiConfigError('enter the server address');
    } catch (e) {
      setPhase({ kind: 'connect', initial: raw, error: (e as Error).message });
      return;
    }
    const allowed = info.current?.allowedOrigins ?? [];
    if (!dev && !allowed.includes(new URL(url).origin)) {
      setPhase({
        kind: 'connect',
        initial: raw,
        error: `This app can only connect to: ${allowed.join(', ') || '(no servers configured in this build)'}.`,
      });
      return;
    }
    try {
      // Probe first: never save an address that does not answer.
      await clientFor(url).health();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0) {
        setPhase({ kind: 'connect', initial: raw, error: unreachable(url) });
        return;
      }
    }
    try {
      url = await bridge.setApiUrl(url);
    } catch (e) {
      setPhase({ kind: 'connect', initial: raw, error: (e as Error).message });
      return;
    }
    await open(url);
  };

  const signedIn = async (apiUrl: string, newToken: string | undefined, email: string | null) => {
    if (!newToken) throw new Error('The server did not return a session.');
    // Persist first: if the credential store refuses, the user is told now, not after a restart.
    await bridge.setToken(apiUrl, newToken);
    token.current = newToken;
    useApiClient(client.current!);
    setPhase({ kind: 'ready', apiUrl, email });
  };

  const signOut = async (apiUrl: string) => {
    try {
      await client.current?.logout();
    } catch {
      // Offline or already expired: the local session is removed regardless.
    }
    token.current = null;
    queries.invalidate('');
    let notice: string | null = 'You have signed out.';
    try {
      await bridge.clearToken(apiUrl);
    } catch (e) {
      notice = `Signed out, but the saved session could not be removed: ${(e as Error).message}`;
    }
    setPhase({ kind: 'signin', apiUrl, notice });
  };

  if (phase.kind === 'loading')
    return (
      <main className="narrow desktop-gate" aria-busy="true">
        <p className="muted" role="status">
          {phase.message}
        </p>
      </main>
    );
  if (phase.kind === 'connect')
    return <ConnectForm initial={phase.initial} error={phase.error} onSubmit={connect} />;
  if (phase.kind === 'signin')
    return (
      <SignInForm
        apiUrl={phase.apiUrl}
        notice={phase.notice}
        client={client.current!}
        onSignedIn={(t, email) => signedIn(phase.apiUrl, t, email)}
        onChangeServer={() => setPhase({ kind: 'connect', initial: phase.apiUrl, error: null })}
      />
    );
  return (
    <>
      <div className="desktop-bar" role="region" aria-label="Account">
        <span className="muted small">
          Signed in{phase.email ? ` as ${phase.email}` : ''} · {host(phase.apiUrl)}
        </span>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => void signOut(phase.apiUrl)}>
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}

function ConnectForm({
  initial,
  error,
  onSubmit,
}: {
  initial: string;
  error: string | null;
  onSubmit: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onSubmit(url.trim());
    setBusy(false);
  };
  return (
    <main className="narrow desktop-gate">
      <h1 className="page-title">Connect to Know Your Code</h1>
      <form onSubmit={(e) => void submit(e)} className="card" noValidate>
        <label htmlFor="kyc-server" className="label">
          Server address
        </label>
        <input
          id="kyc-server"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://api.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-describedby={error ? 'kyc-server-error' : undefined}
        />
        {error && (
          <p id="kyc-server-error" role="alert" className="error-title">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || url.trim() === ''}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </main>
  );
}

function SignInForm({
  apiUrl,
  notice,
  client,
  onSignedIn,
  onChangeServer,
}: {
  apiUrl: string;
  notice: string | null;
  client: ApiClient;
  onSignedIn: (token: string | undefined, email: string | null) => Promise<void>;
  onChangeServer: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === 'login'
          ? await client.login(email.trim(), password)
          : await client.register(email.trim(), password);
      setPassword('');
      await onSignedIn(r.token, r.user.email);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? unreachable(apiUrl)
          : (err as Error).message || 'Something went wrong.',
      );
      setBusy(false);
    }
  };
  const title = mode === 'login' ? 'Sign in' : 'Create an account';
  return (
    <main className="narrow desktop-gate">
      <h1 className="page-title">{title}</h1>
      <p className="muted">Server: {host(apiUrl)}</p>
      {notice && (
        <p role="status" className="note">
          {notice}
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} className="card" noValidate>
        <label htmlFor="kyc-email" className="label">
          Email
        </label>
        <input
          id="kyc-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="kyc-password" className="label">
          Password
        </label>
        <input
          id="kyc-password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="error-title">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim() || !password}>
          {busy ? 'Please wait…' : title}
        </button>
      </form>
      <p>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>{' '}
        ·{' '}
        <button type="button" className="link" onClick={onChangeServer}>
          Change server
        </button>
      </p>
    </main>
  );
}
