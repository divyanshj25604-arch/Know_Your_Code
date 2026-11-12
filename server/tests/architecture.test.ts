import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { runImport } from '../src/jobs/importJob';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: {
      'acme/notes-api': { fixture: 'express-cjs' },
      'acme/shop': { fixture: 'react-ts' },
      'acme/mono': { fixture: 'monorepo' },
    },
  }),
);
afterEach(() => h.close());

interface Arch {
  available: boolean;
  monorepo: boolean;
  modules: { key: string; name: string; files: string[] }[];
  dependencies: { from: string; to: string }[];
}

describe('architecture map API (P3.1)', () => {
  it('shows modules for both fixtures, each linked to its real files', async () => {
    const d = new Device(app);
    for (const [repo, expected] of [
      ['acme/notes-api', ['controllers', 'models', 'routes', 'services']],
      ['acme/shop', ['components', 'lib']],
    ] as const) {
      const { snapshotId } = await d.importRepo(repo);
      const arch = (await d.get(`/api/v1/snapshots/${snapshotId}/architecture`)).json() as Arch;
      expect(arch.available).toBe(true);
      expect(arch.modules.map((m) => m.name)).toEqual(expect.arrayContaining([...expected]));
      const tree = JSON.stringify((await d.get(`/api/v1/snapshots/${snapshotId}/tree`)).json());
      for (const m of arch.modules) {
        expect(m.files.length, m.name).toBeGreaterThan(0);
        for (const f of m.files) expect(tree).toContain(`"path":"${f}"`); // every node links to a stored file
      }
    }
  });

  it('detects a monorepo and its cross-package dependencies; re-analysis keeps one map', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/mono');
    await runImport(
      { config: h.app.services.config, db: h.db, github: h.app.services.github, log: h.app.log },
      snapshotId,
    );
    const arch = (await d.get(`/api/v1/snapshots/${snapshotId}/architecture`)).json() as Arch;
    expect(arch.monorepo).toBe(true);
    expect(arch.modules.map((m) => m.name)).toEqual(
      expect.arrayContaining(['@acme/api', '@acme/shared', '@acme/web']),
    );
    expect(arch.dependencies).toEqual(
      expect.arrayContaining([
        { from: 'pkg:packages/api', to: 'pkg:packages/shared', imports: 1 },
        { from: 'pkg:packages/web', to: 'pkg:packages/shared', imports: 1 },
      ]),
    );
    expect((await h.db.query('SELECT count(*)::int AS n FROM modules')).rows[0].n).toBe(arch.modules.length);
    expect((await new Device(app).get(`/api/v1/snapshots/${snapshotId}/architecture`)).statusCode).toBe(404);
  });
});
