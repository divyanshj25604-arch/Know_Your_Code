import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConceptIndex } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
let llm: FakeLlm;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(async () => {
  llm = new FakeLlm();
  await h.reset({
    llm,
    repos: { 'acme/notes-api': { fixture: 'express-cjs' }, 'acme/shop': { fixture: 'react-ts' } },
  });
});
afterEach(() => h.close());

describe('concept index (P3.3)', () => {
  it('lists concepts from symbol tags, with at least two real examples from different files', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const idx = (await d.get(`/api/v1/snapshots/${snapshotId}/concepts`)).json() as ConceptIndex;
    const aa = idx.concepts.find((c) => c.id === 'async-await')!;
    expect(aa).toBeDefined();
    expect(aa.label).toBe('async await');
    expect(aa.files).toBeGreaterThanOrEqual(2);
    expect(new Set(aa.examples.slice(0, 2).map((e) => e.path)).size).toBe(2);
    expect(aa.examples.map((e) => e.path)).toEqual(
      expect.arrayContaining(['src/controllers/authController.js', 'src/services/userService.js']),
    );
    // Every example is a stored symbol carrying the tag, at its real line.
    for (const c of idx.concepts)
      for (const e of c.examples) {
        const r = await h.db.query('SELECT start_line, tags FROM symbols WHERE id=$1 AND snapshot_id=$2', [
          e.symbolId,
          snapshotId,
        ]);
        expect(r.rows[0].start_line).toBe(e.line);
        expect(r.rows[0].tags).toContain(`concept:${c.id}`);
      }
    // Express handlers use request and response; React code shows state.
    expect(idx.concepts.map((c) => c.id)).toContain('http-request-response');
    const shop = await d.importRepo('acme/shop');
    const ids = (
      (await d.get(`/api/v1/snapshots/${shop.snapshotId}/concepts`)).json() as ConceptIndex
    ).concepts.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['react-state', 'jsx']));
    // Strangers cannot read it.
    expect((await new Device(() => h.app).get(`/api/v1/snapshots/${snapshotId}/concepts`)).statusCode).toBe(
      404,
    );
  });

  it('teaches a concept with references only from the examples shown, stores and caches it', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const r = await d.sse(`/api/v1/snapshots/${snapshotId}/concepts/async-await/teach`, {});
    const names = r.events.map((e) => e.event);
    expect(names[0]).toBe('examples');
    expect(names).toContain('message');
    expect(names.at(-1)).toBe('done');
    const ex = r.events[0]!.data as { examples: { path: string; line: number }[] };
    const msg = r.events.find((e) => e.event === 'message')!.data as {
      concept: string;
      cached: boolean;
      inYourCode: { path: string; line: number }[];
    };
    expect(msg).toMatchObject({ concept: 'async-await', cached: false });
    const paths = new Set(ex.examples.map((e) => e.path));
    for (const ref of msg.inYourCode) expect(paths.has(ref.path)).toBe(true);
    expect(llm.calls.at(-1)!.user).toContain('src/services/userService.js');
    expect(llm.calls.at(-1)!.user).toContain('src/controllers/authController.js');
    const rows = await h.db.query(`SELECT kind, capability FROM explanations WHERE kind='concept'`);
    expect(rows.rows).toEqual([{ kind: 'concept', capability: 'teach_concept' }]);
    const before = llm.calls.length;
    const again = await d.sse(`/api/v1/snapshots/${snapshotId}/concepts/async-await/teach`, {});
    expect(again.events.find((e) => e.event === 'message')!.data).toMatchObject({ cached: true });
    expect(llm.calls.length).toBe(before);
    const missing = await d.sse(`/api/v1/snapshots/${snapshotId}/concepts/generators/teach`, {});
    expect(missing.events.map((e) => e.event)).toEqual(['error']);
    expect(
      (await new Device(() => h.app).sse(`/api/v1/snapshots/${snapshotId}/concepts/async-await/teach`, {}))
        .status,
    ).toBe(403);
  });
});
