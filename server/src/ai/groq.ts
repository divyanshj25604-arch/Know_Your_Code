import { AppError } from '../http/errors';
import type { LlmCall, LlmClient, LlmOutput } from './llm';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GroqLlm implements LlmClient {
  readonly kind = 'groq' as const;
  private readonly baseURL: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly apiKey: string,
    baseURL: string = 'https://api.groq.com/openai/v1',
    private readonly log: { warn: (o: object, m: string) => void } = { warn: () => undefined },
    opts: { fetch?: typeof fetch } = {},
  ) {
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  /** Map Groq HTTP / network failure to user-safe AppError and indicate retryability. */
  private mapError(status?: number): { err: AppError; retry: boolean } {
    if (status === 401 || status === 403) {
      this.log.warn({ status }, 'AI provider rejected our credentials');
      return {
        err: new AppError('AI_NOT_CONFIGURED', 'The AI provider rejected this server’s credentials.'),
        retry: false,
      };
    }
    if (status === 429) {
      return { err: new AppError('AI_BUSY'), retry: true };
    }
    if (status === 408 || status === 504) {
      return { err: new AppError('AI_TIMEOUT'), retry: true };
    }
    if (status !== undefined && status >= 500) {
      this.log.warn({ status }, 'AI provider error');
      return { err: new AppError('AI_ERROR'), retry: true };
    }
    return { err: new AppError('AI_ERROR'), retry: false };
  }

  async complete(call: LlmCall): Promise<LlmOutput> {
    const started = performance.now();
    let attempt = 0;
    const url = `${this.baseURL}/chat/completions`;

    // Instruct model to strictly adhere to the provided JSON schema
    const systemContent = `${call.system}\n\nIMPORTANT: Output ONLY a valid JSON object strictly matching this schema. No markdown fences, no explanatory text outside the JSON:\n${JSON.stringify(call.schema)}`;

    for (;;) {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      if (call.timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), call.timeoutMs);
      }
      const onCallerAbort = () => controller.abort();
      if (call.signal) {
        if (call.signal.aborted) {
          if (timer) clearTimeout(timer);
          throw new AppError('AI_TIMEOUT');
        }
        call.signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: call.model,
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: call.user },
            ],
            response_format: { type: 'json_object' },
            max_tokens: call.maxTokens,
            temperature: 0.1,
          }),
          signal: controller.signal,
        });

        if (timer) clearTimeout(timer);
        if (call.signal) call.signal.removeEventListener('abort', onCallerAbort);

        if (!res.ok) {
          const { err, retry } = this.mapError(res.status);
          attempt++;
          if (attempt > 1 || !retry || call.signal?.aborted) throw err;
          const retryAfter = Number(res.headers.get('retry-after') ?? 0);
          await sleep(Math.min(3000, retryAfter > 0 ? retryAfter * 1000 : 400 + Math.random() * 400));
          continue;
        }

        const data = (await res.json()) as {
          choices?: Array<{
            message?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const choice = data.choices?.[0];
        const text = choice?.message?.content ?? '';
        let json: unknown = null;
        if (text.trim()) {
          try {
            json = JSON.parse(text);
          } catch {
            // Strip potential markdown code fences if the model wrapped it
            const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            try {
              json = JSON.parse(cleaned);
            } catch {
              json = null;
            }
          }
        }

        return {
          json,
          text,
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          totalMs: Math.round(performance.now() - started),
          stopReason: choice?.finish_reason ?? null,
          refused: choice?.finish_reason === 'content_filter',
        };
      } catch (raw) {
        if (timer) clearTimeout(timer);
        if (call.signal) call.signal.removeEventListener('abort', onCallerAbort);

        if (raw instanceof AppError) throw raw;

        const isAbort = (raw as Error)?.name === 'AbortError' || controller.signal.aborted;
        if (isAbort) {
          throw new AppError('AI_TIMEOUT');
        }

        const { err, retry } = this.mapError(undefined);
        attempt++;
        if (attempt > 1 || !retry || call.signal?.aborted) throw err;
        await sleep(400 + Math.random() * 400);
      }
    }
  }
}
