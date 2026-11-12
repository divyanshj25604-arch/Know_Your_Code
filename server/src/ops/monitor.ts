import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Production error tracking and alerting (P4.2), without a vendor SDK.
 *
 * - Every unhandled server error and every failed import becomes one structured `error_report` log line with a stable
 *   fingerprint (error name + first stack frame + route), so a log service can group, count and search them. Messages
 *   are scrubbed and truncated: no credentials, tokens, email addresses, request bodies or source code.
 * - A sliding window counts 5xx responses and job failures. When either crosses its threshold, one `alert` log line is
 *   written at error level and, if ALERT_WEBHOOK_URL is set, a JSON message is POSTed to it (Slack-compatible `text`).
 *   Each alert kind then stays quiet for one window (no alert storms).
 */
export interface MonitorConfig {
  windowMs: number;
  serverErrorThreshold: number;
  jobFailureThreshold: number;
  webhookUrl?: string;
  environment: string;
  version: string;
}

export type AlertKind = 'sustained_5xx' | 'job_failures';

const SECRETS: [RegExp, string][] = [
  [/kyc_st_[A-Za-z0-9_-]{20,}/g, 'kyc_st_[redacted]'],
  [/\b(sk-ant-|gsk_|ghp_|github_pat_|sk-)[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
  [/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]'],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, '[redacted-credentials]@'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Postgres puts row values in "Key (col)=(value)" details.
  [/=\([^)]*\)/g, '=([redacted])'],
];

/** Make an error message safe to log or send: secrets, emails and row values removed, length capped. */
export function scrub(message: string, max = 300): string {
  let s = message;
  for (const [re, to] of SECRETS) s = s.replace(re, to);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Stack frames inside this application only (no node_modules), with absolute paths reduced to repo paths. */
function appFrames(stack: string | undefined, n = 5): string[] {
  return (stack ?? '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('node:'))
    .map((l) => l.replace(/\(?\/[^\s()]*?\/((server|packages)\/)/, '($1'))
    .slice(0, n);
}

export function fingerprint(name: string, frames: string[], where: string): string {
  return createHash('sha256')
    .update(`${name}|${frames[0] ?? ''}|${where}`)
    .digest('hex')
    .slice(0, 16);
}

export class Monitor {
  private readonly events: Record<AlertKind, number[]> = { sustained_5xx: [], job_failures: [] };
  private readonly quietUntil: Record<AlertKind, number> = { sustained_5xx: 0, job_failures: 0 };
  /** Alerts sent (for tests and the health of the alerting itself). */
  readonly sent: { kind: AlertKind; count: number }[] = [];

  constructor(
    private readonly cfg: MonitorConfig,
    private readonly log: FastifyBaseLogger,
    private readonly post: (url: string, body: unknown) => Promise<void> = defaultPost,
    private readonly now: () => number = Date.now,
  ) {}

  /** An unhandled error behind a 5xx response. */
  reportServerError(err: unknown, ctx: { method: string; route: string; requestId: string }) {
    this.report(err, `${ctx.method} ${ctx.route}`, { requestId: ctx.requestId, route: ctx.route });
  }

  /** A failed background import (the snapshot id is an opaque identifier, not user content). */
  reportJobFailure(err: unknown, ctx: { snapshotId: string }) {
    this.report(err, 'job:import', { snapshotId: ctx.snapshotId });
    this.count('job_failures');
  }

  /** Called for every response; counts 5xx. */
  recordResponse(statusCode: number) {
    if (statusCode >= 500) this.count('sustained_5xx');
  }

  private report(err: unknown, where: string, extra: Record<string, string>) {
    const e = err instanceof Error ? err : new Error(String(err));
    const frames = appFrames(e.stack);
    this.log.error(
      {
        event: 'error_report',
        fingerprint: fingerprint(e.name, frames, where),
        where,
        error: { name: e.name, message: scrub(e.message), frames },
        environment: this.cfg.environment,
        version: this.cfg.version,
        ...extra,
      },
      'error report',
    );
  }

  private count(kind: AlertKind) {
    const t = this.now();
    const list = this.events[kind];
    list.push(t);
    while (list.length && list[0]! <= t - this.cfg.windowMs) list.shift();
    const threshold = kind === 'sustained_5xx' ? this.cfg.serverErrorThreshold : this.cfg.jobFailureThreshold;
    if (list.length >= threshold && t >= this.quietUntil[kind]) {
      this.quietUntil[kind] = t + this.cfg.windowMs;
      void this.alert(kind, list.length);
    }
  }

  private async alert(kind: AlertKind, count: number) {
    const minutes = Math.round(this.cfg.windowMs / 60_000);
    const what = kind === 'sustained_5xx' ? 'server errors (5xx responses)' : 'failed imports';
    const text = `[Know Your Code ${this.cfg.environment}] ${count} ${what} in the last ${minutes} min (version ${this.cfg.version}). Check the error_report log lines.`;
    this.sent.push({ kind, count });
    this.log.error({ event: 'alert', alert: kind, count, windowMinutes: minutes }, text);
    if (!this.cfg.webhookUrl) return;
    try {
      await this.post(this.cfg.webhookUrl, { text, alert: kind, count, windowMinutes: minutes });
    } catch (e) {
      this.log.warn(
        { event: 'alert_delivery_failed', err: scrub((e as Error).message) },
        'alert webhook failed',
      );
    }
  }
}

async function defaultPost(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}
