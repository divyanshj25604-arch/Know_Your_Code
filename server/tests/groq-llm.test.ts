import { describe, expect, it } from 'vitest';
import { GroqLlm } from '../src/ai/groq';
import type { LlmCall } from '../src/ai/llm';

const call = (over: Partial<LlmCall> = {}): LlmCall => ({
  task: 'explain',
  model: 'llama-3.3-70b-versatile',
  system: 'SYS',
  user: 'USER',
  schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
  maxTokens: 500,
  effort: 'medium',
  timeoutMs: 5000,
  ...over,
});

const ok = (content: string) =>
  Response.json({
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'llama-3.3-70b-versatile',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 15, completion_tokens: 25 },
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
    const aborted = new Promise<never>((_, reject) => {
      const sig = init?.signal;
      const fire = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (sig?.aborted) fire();
      else sig?.addEventListener('abort', fire, { once: true });
    });
    return Promise.race([Promise.resolve(handler(req)), aborted]);
  }) as typeof fetch;

  return {
    llm: new GroqLlm('gsk-test-key-123', 'https://api.test', undefined, { fetch: f }),
    seen,
  };
}

describe('GroqLlm request shape (wire-level test)', () => {
  it('sends Authorization Bearer header, system prompt with schema, and json_object response format', async () => {
    const { llm, seen } = client(() => ok('{"summary":"All good"}'));
    const out = await llm.complete(call());

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.test/chat/completions');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer gsk-test-key-123');
    expect(seen[0]!.headers.get('content-type')).toBe('application/json');

    const body = seen[0]!.body as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: { type: string };
      max_tokens: number;
    };
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[0]!.content).toContain('SYS');
    expect(body.messages[0]!.content).toContain('summary');
    expect(body.messages[1]!.role).toBe('user');
    expect(body.messages[1]!.content).toBe('USER');
    expect(body.max_tokens).toBe(500);

    expect(out.json).toEqual({ summary: 'All good' });
    expect(out.inputTokens).toBe(15);
    expect(out.outputTokens).toBe(25);
    expect(out.stopReason).toBe('stop');
    expect(out.refused).toBe(false);
  });

  it('handles markdown json fences gracefully', async () => {
    const { llm } = client(() => ok('```json\n{"summary":"Cleaned"}\n```'));
    const out = await llm.complete(call());
    expect(out.json).toEqual({ summary: 'Cleaned' });
  });

  it('treats invalid json string as json: null', async () => {
    const { llm } = client(() => ok('Plain non-json text response'));
    const out = await llm.complete(call());
    expect(out.json).toBeNull();
    expect(out.text).toBe('Plain non-json text response');
  });

  it('retries once on 429 rate limit, then maps to AI_BUSY', async () => {
    let calls = 0;
    const { llm } = client(() => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(llm.complete(call())).rejects.toMatchObject({ code: 'AI_BUSY' });
    expect(calls).toBe(2);
  });

  it('does not retry 401 auth failures and maps to AI_NOT_CONFIGURED', async () => {
    let calls = 0;
    const { llm } = client(() => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(llm.complete(call())).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(calls).toBe(1);
  });

  it('maps a timed out request to AI_TIMEOUT', async () => {
    const { llm } = client(() => new Promise(() => {})); // hung request
    await expect(llm.complete(call({ timeoutMs: 30 }))).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});
