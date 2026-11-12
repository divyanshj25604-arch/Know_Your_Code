import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FlowDetail, FlowsView } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import { runImport } from '../src/jobs/importJob';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: { 'acme/notes-api': { fixture: 'express-cjs' }, 'acme/shop': { fixture: 'react-ts' } },
  }),
);
afterEach(() => h.close());

describe('request flows API (P3.2)', () => {
  it('stores POST /auth/login → login → findUserByEmail with verified steps tied to real call edges', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const list = (await d.get(`/api/v1/snapshots/${snapshotId}/flows`)).json() as FlowsView;
    expect(list.available).toBe(true);
    expect(list.flows.map((f) => f.name)).toEqual(['POST /auth/login', 'GET /health']);
    const summary = list.flows[0]!;
    expect(summary.handler).toMatchObject({
      name: 'login',
      path: 'src/controllers/authController.js',
      line: 3,
    });
    expect(summary.unknownCount).toBeGreaterThan(0);

    const flow = (await d.get(`/api/v1/flows/${summary.id}`)).json() as FlowDetail;
    expect(flow.snapshotId).toBe(snapshotId);
    expect(flow.steps.slice(0, 4).map((s) => [s.kind, s.label])).toEqual([
      ['route', 'POST /auth/login'],
      ['middleware', 'express.json()'],
      ['handler', 'login'],
      ['call', 'findUserByEmail'],
    ]);
    expect(flow.steps.map((s) => s.index)).toEqual(flow.steps.map((_, i) => i));
    for (const s of flow.steps) {
      if (s.provenance === 'verified') {
        // The stored edge is the call this step claims.
        const e = await h.db.query(
          `SELECT e.type, ts.id AS target FROM edges e JOIN symbols ts ON ts.id = e.target_symbol_id WHERE e.id=$1`,
          [s.edgeId],
        );
        expect(e.rows[0]).toEqual({ type: 'calls', target: s.symbolId });
      } else expect(s.edgeId).toBeNull();
      if (s.kind === 'unknown') expect(s.reason).toBeTruthy();
      if (s.symbolId) {
        const sym = await h.db.query(
          'SELECT f.path, s.start_line FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id=$1',
          [s.symbolId],
        );
        expect(sym.rows[0]).toEqual({ path: s.path, start_line: s.line });
      }
    }
    // The database refuses a "verified" step without an edge, and an unknown step without a reason.
    await expect(
      h.db.query(
        `INSERT INTO flow_steps (flow_id, position, kind, label, provenance) VALUES ($1, 99, 'call', 'x', 'verified')`,
        [summary.id],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      h.db.query(
        `INSERT INTO flow_steps (flow_id, position, kind, label, provenance) VALUES ($1, 99, 'unknown', 'x', 'unknown')`,
        [summary.id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('is readable only by the owner (or a share link), and re-analysis replaces flows', async () => {
    const d = new Device(() => h.app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const flowId = ((await d.get(`/api/v1/snapshots/${snapshotId}/flows`)).json() as FlowsView).flows[0]!.id;
    const stranger = new Device(() => h.app);
    expect((await stranger.get(`/api/v1/snapshots/${snapshotId}/flows`)).statusCode).toBe(404);
    expect((await stranger.get(`/api/v1/flows/${flowId}`)).statusCode).toBe(404);
    expect((await d.get(`/api/v1/flows/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
    await runImport(
      { config: h.app.services.config, db: h.db, github: h.app.services.github, log: h.app.log },
      snapshotId,
    );
    const after = (await d.get(`/api/v1/snapshots/${snapshotId}/flows`)).json() as FlowsView;
    expect(after.flows.map((f) => f.name)).toEqual(['POST /auth/login', 'GET /health']);
    expect((await h.db.query('SELECT count(*)::int AS n FROM flows')).rows[0].n).toBe(2);
    expect((await d.get(`/api/v1/flows/${flowId}`)).statusCode).toBe(404);
  });

  it('reports no flows for code without Express, and unavailable for runs before flow discovery', async () => {
    const d = new Device(() => h.app);
    const shop = await d.importRepo('acme/shop');
    expect((await d.get(`/api/v1/snapshots/${shop.snapshotId}/flows`)).json()).toEqual({
      available: true,
      flows: [],
    });
    await h.db.query('UPDATE analysis_runs SET flow_count = NULL');
    expect((await d.get(`/api/v1/snapshots/${shop.snapshotId}/flows`)).json()).toEqual({
      available: false,
      flows: [],
    });
  });
});
