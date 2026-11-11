/**
 * Shared query cache (P2.1): one fetch per key, shared by every mode and workspace track. Concurrent requests for the
 * same key share one in-flight promise; failures are not cached, so a retry fetches again.
 */
export class QueryCache {
  private readonly values = new Map<string, unknown>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  get<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    if (this.values.has(key)) return Promise.resolve(this.values.get(key) as T);
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = fetch().then(
      (v) => {
        this.values.set(key, v);
        this.inflight.delete(key);
        return v;
      },
      (e: unknown) => {
        this.inflight.delete(key);
        throw e;
      },
    );
    this.inflight.set(key, p);
    return p;
  }

  peek<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T) {
    this.values.set(key, value);
  }

  /** Drop every entry whose key starts with `prefix` (e.g. one snapshot's data). */
  invalidate(prefix: string) {
    for (const k of [...this.values.keys()]) if (k.startsWith(prefix)) this.values.delete(k);
  }
}

/** The app-wide cache. Snapshot data is immutable per snapshot id, so it never goes stale within a session. */
export const queries = new QueryCache();
