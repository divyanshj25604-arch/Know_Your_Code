import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config/env';
import { AppError } from '../http/errors';
import { FakeLlm } from './fake';

export type LlmTask = 'explain' | 'followup' | 'concept' | 'check' | 'overview';

export interface LlmCall {
  task: LlmTask;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LlmOutput {
  /** Parsed JSON from the model, or null when the output was not valid JSON / was empty. */
  json: unknown;
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalMs: number;
  stopReason: string | null;
  refused: boolean;
}

/** Provider boundary (docs/10 §7). Nothing outside src/ai/llm.ts knows about a specific provider. */
export interface LlmClient {
  readonly kind: 'anthropic' | 'fake';
  complete(call: LlmCall): Promise<LlmOutput>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Which models accept `thinking: {type: "disabled"}`. Sonnet 5.5 / Opus 5.5 / Fable reject it (400). */
function thinkingFor(model: string): { type: 'disabled' } | undefined {
  return /haiku-5/.test(model) ? { type: 'disabled' } : undefined;
}

export class AnthropicLlm implements LlmClient {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    private readonly log: { warn: (o: object, m: string) => void } = { warn: () => undefined },
    opts: { fetch?: typeof fetch; baseURL?: string } = {},
  ) {
    // Retries are handled here, with explicit bounds, so SDK-level retries are disabled.
    this.client = new Anthropic({
      apiKey,
      maxRetries: 0,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  /** Map a provider/SDK failure to a user-safe error and say whether one more attempt could help. */
  private mapError(e: unknown): { err: AppError; retry: boolean } {
    if (e instanceof AppError) return { err: e, retry: false };
    if (e instanceof Anthropic.APIConnectionTimeoutError)
      return { err: new AppError('AI_TIMEOUT'), retry: true };
    if (e instanceof Anthropic.RateLimitError) return { err: new AppError('AI_BUSY'), retry: true };
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      this.log.warn({ status: (e as { status?: number }).status }, 'AI provider rejected our credentials');
      return {
        err: new AppError('AI_NOT_CONFIGURED', 'The AI provider rejected this server’s credentials.'),
        retry: false,
      };
    }
    if (e instanceof Anthropic.APIConnectionError) return { err: new AppError('AI_ERROR'), retry: true };
    if (e instanceof Anthropic.APIError) {
      this.log.warn({ status: e.status, type: (e as { type?: string }).type }, 'AI provider error');
      // 5xx (including 529 overloaded) may clear up; other 4xx are our bug or a policy decision and will not.
      return { err: new AppError('AI_ERROR'), retry: e.status !== undefined && e.status >= 500 };
    }
    if ((e as Error)?.name === 'AbortError') return { err: new AppError('AI_TIMEOUT'), retry: false };
    return { err: new AppError('AI_ERROR'), retry: false };
  }

  async complete(call: LlmCall): Promise<LlmOutput> {
    const started = performance.now();
    let attempt = 0;
    for (;;) {
      try {
        const thinking = thinkingFor(call.model);
        const res = await this.client.messages.create(
          {
            model: call.model,
            max_tokens: call.maxTokens,
            system: call.system,
            messages: [{ role: 'user', content: call.user }],
            ...(thinking ? { thinking } : {}),
            output_config: { effort: call.effort, format: { type: 'json_schema', schema: call.schema } },
          } as Anthropic.MessageCreateParamsNonStreaming,
          { timeout: call.timeoutMs, ...(call.signal ? { signal: call.signal } : {}) },
        );
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        let json: unknown = null;
        if (text.trim()) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        return {
          json,
          text,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          totalMs: Math.round(performance.now() - started),
          stopReason: res.stop_reason,
          refused: res.stop_reason === 'refusal',
        };
      } catch (raw) {
        const { err, retry } = this.mapError(raw);
        attempt++;
        if (attempt > 1 || !retry || call.signal?.aborted) throw err;
        const retryAfter = Number((raw as { headers?: Headers })?.headers?.get?.('retry-after') ?? 0);
        await sleep(Math.min(3000, retryAfter > 0 ? retryAfter * 1000 : 400 + Math.random() * 400));
      }
    }
  }
}

export function createLlm(config: Config, log?: { warn: (o: object, m: string) => void }): LlmClient | null {
  if (config.LLM_PROVIDER === 'fake') return new FakeLlm();
  if (!config.ANTHROPIC_API_KEY) return null;
  return new AnthropicLlm(config.ANTHROPIC_API_KEY, log);
}
