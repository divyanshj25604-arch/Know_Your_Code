import {
  ERROR_MESSAGES,
  type ErrorCode,
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

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw networkError();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SseMessage {
  event: string;
  data: Record<string, unknown>;
}

/** POST + Server-Sent Events (EventSource cannot POST). Resolves when the stream ends. */
export async function streamSse(
  url: string,
  body: unknown,
  onEvent: (m: SseMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw networkError();
  }
  if (!res.ok) throw await toApiError(res);
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

export const api = {
  health: (signal?: AbortSignal) => request<HealthView>('GET', '/api/v1/health', undefined, signal),
  importRepo: (url: string) => request<ImportResponse>('POST', '/api/v1/repositories', { url }),
  snapshot: (id: string, signal?: AbortSignal) =>
    request<SnapshotView>('GET', `/api/v1/snapshots/${id}`, undefined, signal),
  overview: (id: string) => request<Overview>('GET', `/api/v1/snapshots/${id}/overview`),
  tree: (id: string) => request<{ root: TreeNode }>('GET', `/api/v1/snapshots/${id}/tree`),
  file: (id: string, path: string) =>
    request<FileView>('GET', `/api/v1/snapshots/${id}/file?path=${encodeURIComponent(path)}`),
  resolve: (id: string, selection: Selection) =>
    request<ResolveResponse>('POST', `/api/v1/snapshots/${id}/resolve`, { selection }),
  relations: (symbolId: string) => request<Relations>('GET', `/api/v1/symbols/${symbolId}/relations`),
  deleteRepo: (repositoryId: string) =>
    request<{ deletedSnapshots: number }>('DELETE', `/api/v1/repositories/${repositoryId}`),
  mySnapshots: () => request<{ snapshots: MySnapshot[] }>('GET', '/api/v1/my/snapshots'),
  feedback: (b: {
    targetType: 'explanation' | 'message' | 'check';
    targetId: string;
    rating: 'up' | 'down';
    reason?: string;
  }) => request<void>('POST', '/api/v1/feedback', b),
  event: (name: string, props: Record<string, string | number | boolean> = {}) =>
    request<void>('POST', '/api/v1/events', { events: [{ name, props }] }).catch(() => undefined),
  explanation: (id: string) =>
    request<{ id: string; body: Record<string, unknown>; messages: ThreadMessage[] }>(
      'GET',
      `/api/v1/explanations/${id}`,
    ),
  createCheck: (explanationId: string) =>
    request<CheckQuestion>('POST', `/api/v1/explanations/${explanationId}/checks`, {}),
  answerCheck: (checkId: string, answerIndex: number) =>
    request<CheckResult>('POST', `/api/v1/checks/${checkId}/answer`, { answerIndex }),
  explain: (
    b: { snapshotId: string; selection: Selection; depth: Depth },
    onEvent: (m: SseMessage) => void,
    signal?: AbortSignal,
  ) => streamSse('/api/v1/explanations', b, onEvent, signal),
  message: (
    explanationId: string,
    b: { intent: 'followup' | 'simpler' | 'deeper' | 'concept'; text?: string; conceptId?: string },
    onEvent: (m: SseMessage) => void,
    signal?: AbortSignal,
  ) => streamSse(`/api/v1/explanations/${explanationId}/messages`, b, onEvent, signal),
};
