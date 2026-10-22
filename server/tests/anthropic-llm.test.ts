import { describe, expect, it } from 'vitest';
import { AnthropicLlm } from '../src/ai/llm';
import type { LlmCall } from '../src/ai/llm';

const call = (over: Partial<LlmCall> = {}): LlmCall => ({
  task: 'explain',
  model: 'claude-haiku-5-5',
  system: 'SYS',
  user: 'USER',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  maxTokens: 500,
  effort: 'medium',
  timeoutMs: 5000,
  ...over,
});

const ok = (text: string) =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 11, output_tokens: 7 },
  });

function client(
  handler: (req: {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }) => Response | Promise<Response>,
) {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')),
    };
    seen.push(req);
    // Like real fetch, honour the abort signal so SDK timeouts work.
    const aborted = new Promise<never>((_, reject) => {
      const sig = init?.signal;
      const fire = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (sig?.aborted) fire();
      else sig?.addEventListener('abort', fire, { once: true });
    });
    return Promise.race([Promise.resolve(handler(req)), aborted]);
  }) as typeof fetch;
  return {
    llm: new AnthropicLlm('sk-ant-test-key', undefined, { fetch: f, baseURL: 'https://api.test' }),
    seen,
  };
}

describe('AnthropicLlm request shape (wire-level; NOT a live API test)', () => {
  it('sends the key as an Authorization header, structured-output schema, bounded tokens, and no sampling params', async () => {
    const { llm, seen } = client(() => ok('{"a":1}'));
    const out = await llm.complete(call());
    expect(out).toMatchObject({
      json: { a: 1 },
      inputTokens: 11,
      outputTokens: 7,
      refused: false,
      stopReason: 'end_turn',
    });
    const r = seen[0]!;
    expect(r.url).toBe('https://api.test/v1/messages');
    expect(r.headers.get('authorization')).toBe('Bearer sk-ant-test-key');
    expect(r.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 500,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice'])
      expect(r.body).not.toHaveProperty(banned);
    expect(r.body.messages as unknown[]).toHaveLength(1); // no assistant prefill
  });

  it('disables thinking only for the Haiku tier (other models reject it)', async () => {
    const a = client(() => ok('{}'));
    await a.llm.complete(call({ model: 'claude-haiku-5-5' }));
    expect(a.seen[0]!.body.thinking).toEqual({ type: 'disabled' });
    const b = client(() => ok('{}'));
    await b.llm.complete(call({ model: 'claude-sonnet-5-5' }));
    expect(b.seen[0]!.body).not.toHaveProperty('thinking');
  });

  it('treats non-JSON text as json:null and reports refusals', async () => {
    expect((await client(() => ok('hello')).llm.complete(call())).json).toBeNull();
    const refusal = Response.json({
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'm',
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: null },
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect(await client(() => refusal).llm.complete(call())).toMatchObject({ refused: true, json: null });
  });

  it('retries once on 429/5xx, then maps to AI_BUSY / AI_ERROR', async () => {
    let n = 0;
    const flaky = client(() =>
      ++n === 1
        ? new Response('{"type":"error","error":{"type":"overloaded_error","message":"x"}}', { status: 529 })
        : ok('{"ok":true}'),
    );
    expect((await flaky.llm.complete(call())).json).toEqual({ ok: true });
    expect(flaky.seen).toHaveLength(2);

    const busy = client(
      () =>
        new Response('{"type":"error","error":{"type":"rate_limit_error","message":"slow"}}', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
    );
    await expect(busy.llm.complete(call())).rejects.toMatchObject({ code: 'AI_BUSY' });
    expect(busy.seen).toHaveLength(2); // bounded: one retry only

    const down = client(
      () =>
        new Response('{"type":"error","error":{"type":"api_error","message":"boom internal"}}', {
          status: 500,
        }),
    );
    const err = await down.llm.complete(call()).catch((e) => e);
    expect(err).toMatchObject({ code: 'AI_ERROR' });
    expect(err.message).not.toContain('boom');
  });

  it('does not retry auth or validation failures and never echoes the provider message', async () => {
    const auth = client(
      () =>
        new Response(
          '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key sk-ant-test-key"}}',
          { status: 401 },
        ),
    );
    const e1 = await auth.llm.complete(call()).catch((e) => e);
    expect(e1).toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(e1.message).not.toContain('sk-ant');
    expect(auth.seen).toHaveLength(1);

    const bad = client(
      () =>
        new Response(
          '{"type":"error","error":{"type":"invalid_request_error","message":"thinking disabled not allowed"}}',
          { status: 400 },
        ),
    );
    await expect(bad.llm.complete(call())).rejects.toMatchObject({ code: 'AI_ERROR' });
    expect(bad.seen).toHaveLength(1);
  });

  it('maps a hung request to AI_TIMEOUT within the configured timeout', async () => {
    const slow = client(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    await expect(slow.llm.complete(call({ timeoutMs: 150 }))).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
