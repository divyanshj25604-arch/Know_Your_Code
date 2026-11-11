import {
  ERROR_MESSAGES,
  type AccountView,
  type AuthSessionResponse,
  type ClaimResponse,
  type ErrorCode,
  type MeResponse,
  type ShareTokenResponse,
  type TokenTransport,
  type FileView,
  type HealthView,
  type ImportResponse,
  type Overview,
  type Relations,
  type ResolveResponse,
  type Selection,
  type SnapshotView,
  type TreeNode,
  type Depth,
} from '@kyc/contracts';
import { ApiConfigError, validateApiConfig, type ApiConfig, type AuthStrategy } from './config';

export { ApiConfigError, type ApiConfig, type AuthStrategy };

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** What the user can do next (docs/05 §17). */
  get action(): string | undefined {
    return ERROR_MESSAGES[this.code]?.action;
  }
}

const networkError = () =>
  new ApiError('SERVICE_UNAVAILABLE', ERROR_MESSAGES.SERVICE_UNAVAILABLE.message, true, 0);

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const j = (await res.json()) as { error?: { code?: ErrorCode; message?: string; retryable?: boolean } };
    const code = j.error?.code && j.error.code in ERROR_MESSAGES ? j.error.code : 'SERVICE_UNAVAILABLE';
    return new ApiError(
      code,
      j.error?.message || ERROR_MESSAGES[code].message,
      j.error?.retryable ?? false,
      res.status,
    );
  } catch {
    return new ApiError('SERVICE_UNAVAILABLE', ERROR_MESSAGES.SERVICE_UNAVAILABLE.message, true, res.status);
  }
}

/** How one configured client talks to the server: URL prefix, credentials mode and per-request headers. */
interface Transport {
  url(path: string): string;
  credentials: RequestCredentials;
  headers(extra?: Record<string, string>): Record<string, string>;
  /** Called with every failed response, before the error is thrown (bearer clients detect expired tokens). */
  onError(err: ApiError): void;
}

function makeTransport(config: ApiConfig, shareToken: () => string | null): Transport {
  const auth = config.auth;
  return {
    url: (path) => `${config.baseUrl}${path}`,
    // Cookies are only ever sent to the page's own origin; bearer clients never send cookies at all.
    credentials: auth.kind === 'cookie' ? 'same-origin' : 'omit',
    headers(extra = {}) {
      const h: Record<string, string> = { ...extra };
      if (auth.kind === 'bearer') {
        const token = auth.getToken();
        if (token) h.authorization = `Bearer ${token}`;
      }
      const share = shareToken();
      if (share) h['x-kyc-share'] = share;
      return h;
    },
    onError(err) {
      if (auth.kind === 'bearer' && err.code === 'AUTH_REQUIRED') auth.onUnauthorized?.();
    },
  };
}

async function request<T>(
  t: Transport,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(t.url(path), {
      method,
      credentials: t.credentials,
      headers: t.headers(body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw networkError();
  }
  if (!res.ok) {
    const err = await toApiError(res);
    t.onError(err);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SseMessage {
  event: string;
  data: Record<string, unknown>;
}

/** POST + Server-Sent Events (EventSource cannot POST). Resolves when the stream ends. */
async function streamSse(
  t: Transport,
  path: string,
  body: unknown,
  onEvent: (m: SseMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(t.url(path), {
      method: 'POST',
      credentials: t.credentials,
      headers: t.headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw networkError();
  }
  if (!res.ok) {
    const err = await toApiError(res);
    t.onError(err);
    throw err;
  }
  if (!res.body) throw networkError();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!block.trim() || block.startsWith(':')) continue;
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || data === undefined) continue;
        try {
          onEvent({ event, data: JSON.parse(data) as Record<string, unknown> });
        } catch {
          // A malformed event is ignored rather than breaking the whole stream.
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw networkError();
  }
}

export interface MySnapshot {
  snapshotId: string;
  repositoryId: string;
  repository: { owner: string; name: string };
  status: string;
  expiresAt: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  intent: 'followup' | 'concept';
  body: Record<string, unknown>;
}

export interface CheckQuestion {
  checkId: string;
  type: 'predict' | 'trace' | 'why';
  question: string;
  options: string[];
}

export interface CheckResult {
  correct: boolean;
  feedback: string;
  refs: { path: string; line: number }[];
  correctIndex: number | null;
}

/** Sign-in result as the client sees it: the bearer token, if any, is handed to the caller to store securely. */
export interface SignedIn {
  user: AccountView;
  expiresAt: string;
  token?: string;
  claimable: AuthSessionResponse['claimable'];
}

/**
 * One API client for one configuration. The web app uses the default `api` below; a desktop shell creates its own
 * with an absolute base URL and bearer authentication.
 */
export function createApiClient(
  config: ApiConfig,
  opts: { pageOrigin?: string | null; production?: boolean } = {},
) {
  const pageOrigin = opts.pageOrigin ?? (typeof window !== 'undefined' ? window.location.origin : null);
  const valid = validateApiConfig(config, pageOrigin, opts.production ?? false);
  let shareToken: string | null = null;
  const t = makeTransport(valid, () => shareToken);
  const transport: TokenTransport = valid.auth.kind === 'cookie' ? 'cookie' : 'bearer';
  const call = <T>(method: string, path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(t, method, path, body, signal);

  return {
    config: valid,
    /** Read-only share link token to send with snapshot reads (null to stop). */
    setShareToken(token: string | null) {
      shareToken = token;
    },

    health: (signal?: AbortSignal) => call<HealthView>('GET', '/api/v1/health', undefined, signal),
    importRepo: (url: string) => call<ImportResponse>('POST', '/api/v1/repositories', { url }),
    snapshot: (id: string, signal?: AbortSignal) =>
      call<SnapshotView>('GET', `/api/v1/snapshots/${id}`, undefined, signal),
    overview: (id: string) => call<Overview>('GET', `/api/v1/snapshots/${id}/overview`),
    tree: (id: string) => call<{ root: TreeNode }>('GET', `/api/v1/snapshots/${id}/tree`),
    file: (id: string, path: string) =>
      call<FileView>('GET', `/api/v1/snapshots/${id}/file?path=${encodeURIComponent(path)}`),
    resolve: (id: string, selection: Selection) =>
      call<ResolveResponse>('POST', `/api/v1/snapshots/${id}/resolve`, { selection }),
    relations: (symbolId: string) => call<Relations>('GET', `/api/v1/symbols/${symbolId}/relations`),
    deleteRepo: (repositoryId: string) =>
      call<{ deletedSnapshots: number }>('DELETE', `/api/v1/repositories/${repositoryId}`),
    mySnapshots: () => call<{ snapshots: MySnapshot[] }>('GET', '/api/v1/my/snapshots'),
    shareSnapshot: (id: string, ttlHours?: number) =>
      call<ShareTokenResponse>('POST', `/api/v1/snapshots/${id}/share-tokens`, ttlHours ? { ttlHours } : {}),
    revokeSnapshotShares: (id: string) => call<void>('DELETE', `/api/v1/snapshots/${id}/share-tokens`),
    feedback: (b: {
      targetType: 'explanation' | 'message' | 'check';
      targetId: string;
      rating: 'up' | 'down';
      reason?: string;
    }) => call<void>('POST', '/api/v1/feedback', b),
    event: (name: string, props: Record<string, string | number | boolean> = {}) =>
      call<void>('POST', '/api/v1/events', { events: [{ name, props }] }).catch(() => undefined),
    explanation: (id: string) =>
      call<{ id: string; body: Record<string, unknown>; messages: ThreadMessage[] }>(
        'GET',
        `/api/v1/explanations/${id}`,
      ),
    createCheck: (explanationId: string) =>
      call<CheckQuestion>('POST', `/api/v1/explanations/${explanationId}/checks`, {}),
    answerCheck: (checkId: string, answerIndex: number) =>
      call<CheckResult>('POST', `/api/v1/checks/${checkId}/answer`, { answerIndex }),
    explain: (
      b: { snapshotId: string; selection: Selection; depth: Depth },
      onEvent: (m: SseMessage) => void,
      signal?: AbortSignal,
    ) => streamSse(t, '/api/v1/explanations', b, onEvent, signal),
    message: (
      explanationId: string,
      b: { intent: 'followup' | 'simpler' | 'deeper' | 'concept'; text?: string; conceptId?: string },
      onEvent: (m: SseMessage) => void,
      signal?: AbortSignal,
    ) => streamSse(t, `/api/v1/explanations/${explanationId}/messages`, b, onEvent, signal),

    // Accounts (P1.2). With cookie auth the session lives in an httpOnly cookie; with bearer auth the token is
    // returned once in `SignedIn.token` and the caller must keep it in secure storage (never localStorage).
    me: () => call<MeResponse>('GET', '/api/v1/auth/me'),
    register: (email: string, password: string) =>
      call<SignedIn>('POST', '/api/v1/auth/register', { email, password, transport }),
    login: (email: string, password: string) =>
      call<SignedIn>('POST', '/api/v1/auth/login', { email, password, transport }),
    logout: (opts: { all?: boolean } = {}) => call<void>('POST', '/api/v1/auth/logout', { all: !!opts.all }),
    claimAnonymousWork: () => call<ClaimResponse>('POST', '/api/v1/auth/claim', {}),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * The web app's client: same-origin by default, or VITE_API_BASE_URL when the API is served elsewhere on the same
 * site. Cookie authentication, exactly as before P1.6.
 */
export const api: ApiClient = createApiClient(
  { baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', auth: { kind: 'cookie' } },
  { production: import.meta.env.PROD },
);
