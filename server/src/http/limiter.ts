import { AppError } from './errors';

/** Small in-memory sliding-window limiter. Single-instance by design (docs/07 ADR-06). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly enabled: boolean) {}

  check(bucket: string, key: string, max: number, windowMs: number) {
    if (!this.enabled) return;
    const k = `${bucket}:${key}`;
    const now = Date.now();
    const recent = (this.hits.get(k) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      this.hits.set(k, recent);
      const retryAfterSec = Math.ceil((windowMs - (now - recent[0]!)) / 1000);
      throw new AppError(
        'RATE_LIMITED',
        `You're going fast! Try again in about ${Math.max(1, Math.ceil(retryAfterSec / 60))} min.`,
        { retryAfterSec },
      );
    }
    recent.push(now);
    this.hits.set(k, recent);
    if (this.hits.size > 10_000) {
      for (const [kk, v] of this.hits) if (v.every((t) => now - t >= windowMs)) this.hits.delete(kk);
    }
  }
}
