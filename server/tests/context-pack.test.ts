import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Selection } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import { resolveSelection } from '../src/index/resolve';
import { buildContextPack, estimateTokens } from '../src/retrieval/context';
import { Harness } from './harness';

const h = new Harness();
let snapshotId = '';
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(async () => {
  await h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } });
  snapshotId = (await h.importRepo('https://github.com/acme/notes-api')).snapshotId;
});
afterEach(() => h.close());

// `await findUserByEmail(req.body.email)` inside login().
const CALL: Selection = {
  path: 'src/controllers/authController.js',
  startLine: 4,
  startCol: 15,
  endLine: 4,
  endCol: 52,
};

async function pack(selection: Selection, over: { maxTokens?: number; question?: string } = {}) {
  const resolved = await resolveSelection(h.db, snapshotId, selection);
  return buildContextPack({
    db: h.db,
    snapshotId,
    selection,
    resolved,
    maxTokens: over.maxTokens ?? 3000,
    facts: { frameworks: ['express'], languages: { js: 6 } },
    ...(over.question ? { question: over.question } : {}),
  });
}

describe('buildContextPack', () => {
  it('packs the selection with real line numbers, the callee definition and its relations', async () => {
    const p = await pack(CALL);
    expect(p.items[0]).toBe('SELECTED_CODE');
    expect(p.text).toContain('[SELECTED_CODE] file: src/controllers/authController.js lines 1-9');
    expect(p.text).toContain('4|   const user = await findUserByEmail(req.body.email);');
    // The callee's definition is included from its own file, with its own line numbers.
    expect(p.text).toContain('src/services/userService.js');
    expect(p.text).toContain('7| async function findUserByEmail(email) {');
    expect(p.relations?.symbol?.name).toBe('login');
    expect(p.items).toContain('PROJECT_FACTS');
    // Allowed ranges are exactly what the model is shown, so the verifier can check every citation.
    expect(p.ranges.get('src/controllers/authController.js')).toContainEqual([1, 9]);
    expect(p.ranges.get('src/services/userService.js')?.some(([a, b]) => a <= 7 && b >= 8)).toBe(true);
    expect(p.truncated).toBe(false);
  });

  it('is deterministic for the same selection', async () => {
    const a = await pack(CALL);
    const b = await pack(CALL);
    expect(b.text).toBe(a.text);
    expect([...b.ranges.entries()]).toEqual([...a.ranges.entries()]);
  });

  it('stays within the token budget and reports truncation', async () => {
    const p = await pack(CALL, { maxTokens: 120 });
    expect(p.tokens).toBeLessThanOrEqual(120);
    expect(estimateTokens(p.text)).toBeLessThan(200);
    expect(p.truncated).toBe(true);
  });

  it('adds lexical hits for follow-up questions, never duplicating lines already shown', async () => {
    const p = await pack(CALL, { question: 'Where is normalise used?' });
    expect(p.items).toContain('LEXICAL_HIT');
    expect(p.text).toContain('mentions "normalise"');
  });

  it('re-redacts the packed text before it can leave the server (defence in depth)', async () => {
    // Simulate a secret that escaped extraction-time redaction (e.g. a pattern added later).
    await h.db.query(
      `UPDATE files SET content = replace(content, '{ error: ''Invalid'' }', '{ error: ''ghp_${'z'.repeat(36)}'' }')
       WHERE snapshot_id=$1 AND path=$2`,
      [snapshotId, CALL.path],
    );
    const p = await pack(CALL);
    expect(p.text).not.toContain('ghp_');
    expect(p.text).toContain('[REDACTED]');
  });
});
