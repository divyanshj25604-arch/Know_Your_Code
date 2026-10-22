import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@kyc/contracts';
import { AppError } from './errors';

export interface SseStream {
  emit(event: string, data: unknown): void;
  emitError(e: unknown): void;
  end(): void;
  /** Aborts when the client disconnects, so we stop paying for a reply nobody will read. */
  signal: AbortSignal;
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseStream {
  reply.hijack();
  const raw = reply.raw;
  const carried = Object.fromEntries(
    Object.entries(reply.getHeaders()).filter(([, v]) => v !== undefined),
  ) as Record<string, string | string[]>;
  raw.writeHead(200, {
    ...carried,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const controller = new AbortController();
  let ended = false;
  req.raw.on('close', () => {
    if (!ended) controller.abort();
    clearInterval(beat);
  });
  const beat = setInterval(() => {
    if (!ended) raw.write(': ping\n\n');
  }, 15_000);
  const write = (event: string, data: unknown) => {
    if (ended || raw.destroyed) return;
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return {
    signal: controller.signal,
    emit: write,
    emitError(e: unknown) {
      const app = e instanceof AppError ? e : null;
      const code = app?.code ?? 'SERVICE_UNAVAILABLE';
      write('error', {
        code,
        message: app?.message ?? 'Something went wrong on our side.',
        retryable: ERROR_CODES[code].retryable,
      });
    },
    end() {
      if (ended) return;
      ended = true;
      clearInterval(beat);
      raw.end();
    },
  };
}
