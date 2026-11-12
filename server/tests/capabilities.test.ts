import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAPABILITY_IDS, type Claim } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import type { LlmCall, LlmClient, LlmOutput } from '../src/ai/llm';
import { CAPABILITIES } from '../src/ai/registry';
import { SYSTEM_RULES_VERSION } from '../src/ai/prompts';
import { Device } from './device';
import { Harness, parseSse } from './harness';

const h = new Harness();
const app = () => h.app;
const LOGIN_SEL = {
  path: 'src/controllers/authController.js',
  startLine: 4,
  startCol: 15,
  endLine: 4,
  endCol: 52,
};
const REPOS = {
  'acme/notes-api': {
    fixture: 'express-cjs',
    extra: [
      {
        name: 'src/bad.js',
        content: '// KYC_FAKE_BAD_REF\nfunction ref() {\n  return 2;\n}\nmodule.exports = { ref };\n',
      },
      {
        name: 'src/flowbad.js',
        content:
          '// KYC_FAKE_BAD_EDGE\nfunction helper() {\n  return 1;\n}\nfunction entry() {\n  return helper();\n}\nmodule.exports = { entry };\n',
      },
    ],
  },
};

/** FakeLlm that streams its answer in chunks, as a streaming provider would. */
class StreamingFake extends FakeLlm {
  async stream(call: LlmCall, onText: (d: string) => void): Promise<LlmOutput> {
    const out = await this.complete(call);
    for (let i = 0; i < out.text.length; i += 64) onText(out.text.slice(i, i + 64));
    return { ...out, firstTokenMs: 1 };
  }
}

/** Wraps FakeLlm to script one behaviour; records every call. */
class ScriptedLlm implements LlmClient {
  readonly calls: LlmCall[] = [];
  private readonly fake = new FakeLlm();
  constructor(
    readonly kind: LlmClient['kind'],
    private readonly script: (call: LlmCall, n: number, real: LlmOutput) => LlmOutput,
  ) {}
  async complete(call: LlmCall): Promise<LlmOutput> {
    this.calls.push(call);
    return this.script(call, this.calls.length, await this.fake.complete(call));
  }
}

let llm: LlmClient = new FakeLlm();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm, repos: REPOS }));
afterEach(async () => {
  await h.close();
  llm = new FakeLlm();
});

async function useLlm(next: LlmClient, env: Record<string, string> = {}) {
  llm = next;
  await h.close();
  await h.reset({ llm, repos: REPOS, env });
}

async function signedInWithRepo() {
  const d = new Device(app);
  const { snapshotId } = await d.importRepo('acme/notes-api');
  return { d, snapshotId };
}

const doneOf = (body: string) => parseSse(body).find((e) => e.event === 'done')!.data;
const verifiedClaimsCiteEdges = (claims: Claim[]) =>
  claims.filter((c) => c.provenance === 'verified').every((c) => c.evidence.some((e) => e.kind === 'edge'));

describe('capability registry (P2.3)', () => {
  it('registers every documented capability with its own versioned prompt and schema', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...CAPABILITY_IDS].sort());
    for (const id of CAPABILITY_IDS) {
      const c = CAPABILITIES[id];
      expect(c.id).toBe(id);
      expect(c.version).toMatch(new RegExp(`^${id}@\\d+\\+${SYSTEM_RULES_VERSION.replace('.', '\\.')}$`));
      expect(c.schema).toMatchObject({ type: 'object', additionalProperties: false });
      if (c.intent) expect(c.budget).toBeGreaterThan(0);
    }
  });

  it('runs the existing flows through the registry and records capability, version and claims', async () => {
    const { d, snapshotId } = await signedInWithRepo();
    const ex = await d.post('/api/v1/explanations', { snapshotId, selection: LOGIN_SEL });
    const done = doneOf(ex.body) as {
      explanationId: string;
      evidence: { capability: string; claims: Claim[] };
    };
    expect(done.evidence.capability).toBe('explain_selection');
    expect(done.evidence.claims.some((c) => c.provenance === 'verified')).toBe(true);
    expect(verifiedClaimsCiteEdges(done.evidence.claims)).toBe(true);

    const fu = await d.post(`/api/v1/explanations/${done.explanationId}/messages`, {
      intent: 'followup',
      text: 'why?',
    });
    expect((doneOf(fu.body) as { evidence: { capability: string } }).evidence.capability).toBe('follow_up');
    const concept = await d.post(`/api/v1/explanations/${done.explanationId}/messages`, {
      intent: 'concept',
      conceptId: 'async-await',
    });
    expect((doneOf(concept.body) as { evidence: { capability: string } }).evidence.capability).toBe(
      'teach_concept',
    );
    const check = (await d.post(`/api/v1/explanations/${done.explanationId}/checks`)).json();
    expect(check.checkId).toBeTruthy();
    const graded = (
      await d.post(`/api/v1/checks/${check.checkId}/answer`, { text: `It is Line 4 because…` })
    ).json();
    expect(graded.evidence.capability).toBe('grade');

    const rows = (
      await h.db.query(
        'SELECT capability, capability_version, claims FROM explanations UNION ALL SELECT capability, capability_version, claims FROM messages WHERE role=$1',
        ['assistant'],
      )
    ).rows;
    expect(rows.map((r) => r.capability).sort()).toEqual(['explain_selection', 'follow_up', 'teach_concept']);
    for (const r of rows) {
      expect(r.capability_version).toBe(CAPABILITIES[r.capability as keyof typeof CAPABILITIES].version);
      expect(verifiedClaimsCiteEdges(r.claims)).toBe(true);
    }
  });
});

describe('explain_flow', () => {
  it('streams the verified flow first, then a step-by-step explanation whose verified steps cite edges', async () => {
    const { d, snapshotId } = await signedInWithRepo();
    const login = (await d.post(`/api/v1/snapshots/${snapshotId}/resolve`, { selection: LOGIN_SEL })).json()
      .symbol;
    const res = await d.post('/api/v1/flows/explain', { snapshotId, symbolId: login.id, hops: 3 });
    const ev = parseSse(res.body);
    expect(ev.map((e) => e.event)).toEqual(['flow', 'section', 'section', 'done']);
    const flow = ev[0]!.data as { steps: { to: { name: string }; edgeId: string }[] };
    expect(flow.steps.map((s) => s.to.name)).toEqual(['findUserByEmail', 'normalise']);
    const steps = (ev[2]!.data as { steps: { edgeId: string | null; provenance: string }[] }).steps;
    expect(steps.map((s) => s.edgeId)).toEqual(flow.steps.map((s) => s.edgeId));
    expect(steps.every((s) => s.provenance === 'verified')).toBe(true);
    const done = ev[3]!.data as { evidence: { claims: Claim[]; claimsDowngraded: number } };
    expect(done.evidence.claimsDowngraded).toBe(0);
    expect(verifiedClaimsCiteEdges(done.evidence.claims)).toBe(true);
    expect((await h.db.query(`SELECT kind, capability FROM explanations`)).rows).toEqual([
      { kind: 'flow', capability: 'explain_flow' },
    ]);
  });

  it('downgrades a step the model marks verified with an edge it was never shown', async () => {
    const { d, snapshotId } = await signedInWithRepo();
    const entry = (
      await d.post(`/api/v1/snapshots/${snapshotId}/resolve`, {
        selection: { path: 'src/flowbad.js', startLine: 5, startCol: 9, endLine: 5, endCol: 14 },
      })
    ).json().symbol;
    const ev = parseSse((await d.post('/api/v1/flows/explain', { snapshotId, symbolId: entry.id })).body);
    const steps = (
      ev.find((e) => e.data.name === 'flowSteps')!.data as {
        steps: { text: string; edgeId: string | null; provenance: string }[];
      }
    ).steps;
    const forged = steps.find((s) => s.text.includes('hidden helper'))!;
    expect(forged).toMatchObject({ edgeId: null, provenance: 'explained' });
    expect(steps.find((s) => s.text.includes('calls helper'))).toMatchObject({ provenance: 'verified' });
    const done = ev.find((e) => e.event === 'done')!.data as {
      evidence: { claims: Claim[]; claimsDowngraded: number };
    };
    expect(done.evidence.claimsDowngraded).toBe(1);
    expect(verifiedClaimsCiteEdges(done.evidence.claims)).toBe(true);
  });

  it('is owner-only and validates its input', async () => {
    const { d, snapshotId } = await signedInWithRepo();
    const login = (await d.post(`/api/v1/snapshots/${snapshotId}/resolve`, { selection: LOGIN_SEL })).json()
      .symbol;
    expect(
      (await new Device(app).post('/api/v1/flows/explain', { snapshotId, symbolId: login.id })).statusCode,
    ).toBe(403);
    expect((await d.post('/api/v1/flows/explain', { snapshotId, symbolId: 'x' })).statusCode).toBe(400);
    expect(
      (await d.post('/api/v1/flows/explain', { snapshotId, symbolId: login.id, hops: 9 })).statusCode,
    ).toBe(400);
  });
});

describe('executor', () => {
  it('streams progress when the provider streams, and records first-token latency', async () => {
    await useLlm(new StreamingFake());
    const { d, snapshotId } = await signedInWithRepo();
    const ev = parseSse((await d.post('/api/v1/explanations', { snapshotId, selection: LOGIN_SEL })).body);
    const names = ev.map((e) => e.event);
    expect(names.filter((n) => n === 'progress').length).toBeGreaterThan(0);
    expect(names.indexOf('progress')).toBeLessThan(names.indexOf('meta'));
    expect(names.at(-1)).toBe('done');
    // (The import's project summary is a separate, non-streamed call.)
    const ledger = (
      await h.db.query(`SELECT first_token_ms FROM llm_calls WHERE task='explain' AND NOT cache_hit`)
    ).rows;
    expect(ledger[0]?.first_token_ms).toBe(1);
  });

  it('retries a refusal once on the strong model', async () => {
    const scripted = new ScriptedLlm('fake', (call, _n, real) =>
      call.model === 'claude-haiku-5-5'
        ? { ...real, json: null, text: '', refused: true, stopReason: 'refusal' }
        : real,
    );
    await useLlm(scripted);
    const { d, snapshotId } = await signedInWithRepo();
    const ev = parseSse((await d.post('/api/v1/explanations', { snapshotId, selection: LOGIN_SEL })).body);
    expect(ev.at(-1)?.event).toBe('done');
    const explainCalls = scripted.calls.filter((c) => c.task === 'explain');
    expect(explainCalls.map((c) => c.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    const statuses = await h.db.query(`SELECT status FROM llm_calls WHERE task='explain' ORDER BY id`);
    expect(statuses.rows.map((r) => r.status)).toEqual(['refusal', 'ok']);
  });

  it('gives a truncated (max_tokens) answer twice the room on the retry', async () => {
    let explains = 0;
    const scripted = new ScriptedLlm('fake', (c, _n, real) =>
      c.task === 'explain' && ++explains === 1
        ? { ...real, json: null, text: '{"what":', stopReason: 'max_tokens' }
        : real,
    );
    await useLlm(scripted);
    const { d, snapshotId } = await signedInWithRepo();
    await d.post('/api/v1/explanations', { snapshotId, selection: LOGIN_SEL });
    expect(scripted.calls.filter((c) => c.task === 'explain').map((c) => c.maxTokens)).toEqual([1400, 2800]);
  });

  it('sizes max_tokens for adaptive-thinking models (risk T5)', async () => {
    const scripted = new ScriptedLlm('anthropic', (_c, _n, real) => real);
    await useLlm(scripted, { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key-not-used' });
    const { d, snapshotId } = await signedInWithRepo();
    await d.post('/api/v1/explanations', { snapshotId, selection: LOGIN_SEL });
    // Fast tier (haiku-5) has thinking disabled: base allowance. Strong (sonnet-5-5) would get max(3x, 4096).
    expect(scripted.calls.find((c) => c.task === 'explain')?.maxTokens).toBe(1400);
    // The import's summary runs on the strong tier: max(3 x 900, 4096).
    expect(scripted.calls.find((c) => c.task === 'overview')?.maxTokens).toBe(4096);
    const strongOnly = new ScriptedLlm('anthropic', (_c, _n, real) => real);
    await useLlm(strongOnly, {
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test-key-not-used',
      MODEL_FAST: 'claude-sonnet-5-5',
    });
    const t = await signedInWithRepo();
    await t.d.post('/api/v1/explanations', { snapshotId: t.snapshotId, selection: LOGIN_SEL });
    expect(strongOnly.calls.find((c) => c.task === 'explain')?.maxTokens).toBe(4200);
  });

  it('attributes stripped references to the exact ledger row (no max(id) patching)', async () => {
    const { d, snapshotId } = await signedInWithRepo();
    await h.db.query(
      `INSERT INTO llm_calls (owner_id, task, model, prompt_version, status) SELECT owner_id, 'explain', 'm', 'p', 'ok' FROM repositories`,
    );
    const sel = { path: 'src/bad.js', startLine: 2, startCol: 9, endLine: 2, endCol: 12 };
    await d.post('/api/v1/explanations', { snapshotId, selection: sel });
    const stored = (await h.db.query(`SELECT refs_stripped, model FROM explanations`)).rows[0];
    expect(stored.refs_stripped).toBeGreaterThan(0);
    // The run that produced the stored answer carries its count; the unrelated row is untouched.
    const ledger = (
      await h.db.query(
        `SELECT model, refs_stripped FROM llm_calls WHERE task='explain' AND status='ok' ORDER BY id`,
      )
    ).rows;
    expect(ledger[0]).toEqual({ model: 'm', refs_stripped: 0 });
    expect(ledger.some((r) => r.model === stored.model && r.refs_stripped === stored.refs_stripped)).toBe(
      true,
    );
  });
});
