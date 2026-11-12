import { describe, expect, it } from 'vitest';
import { analyse, detectModules, readPathAliases } from '../src';
import { analysable, loadFixture } from './fixture-loader';

async function mapOf(fixture: string) {
  const files = loadFixture(fixture);
  const code = analysable(files);
  const r = await analyse(code, {
    knownPaths: files.map((f) => f.path),
    aliases: readPathAliases(code, files),
  });
  return detectModules(
    files.map((f) => f.path),
    files.filter((f) => f.path.endsWith('package.json')),
    r.edges,
  );
}

describe('module detection and architecture map (P3.1)', () => {
  it('groups an Express app into its directory modules with their import dependencies', async () => {
    const m = await mapOf('express-cjs');
    expect(m.monorepo).toBe(false);
    expect(m.modules.map((x) => x.name)).toEqual([
      'top level',
      'src (top level)',
      'controllers',
      'models',
      'routes',
      'services',
    ]);
    expect(m.modules.find((x) => x.name === 'controllers')!.files).toEqual([
      'src/controllers/authController.js',
    ]);
    expect(m.dependencies).toContainEqual({
      from: 'dir:src/controllers',
      to: 'dir:src/services',
      imports: 1,
    });
    expect(m.dependencies).toContainEqual({ from: 'dir:src/routes', to: 'dir:src/controllers', imports: 1 });
  });

  it('maps a React/TypeScript app, every file in exactly one module', async () => {
    const files = loadFixture('react-ts');
    const m = await mapOf('react-ts');
    expect(m.modules.map((x) => x.name).sort()).toEqual(
      ['components', 'lib', 'src (top level)', 'top level'].sort(),
    );
    const all = m.modules.flatMap((x) => x.files).sort();
    expect(all).toEqual(files.map((f) => f.path).sort());
    expect(m.dependencies).toContainEqual(
      expect.objectContaining({ from: 'dir:src/components', to: 'dir:src/lib' }),
    );
  });

  it('treats each workspace package of a monorepo as a module, with cross-package dependencies', async () => {
    const m = await mapOf('monorepo');
    expect(m.monorepo).toBe(true);
    expect(m.modules.filter((x) => x.kind === 'package').map((x) => x.name)).toEqual([
      '@acme/api',
      '@acme/shared',
      '@acme/web',
    ]);
    expect(m.modules.find((x) => x.name === '@acme/web')!.files).toEqual([
      'packages/web/package.json',
      'packages/web/src/main.js',
      'packages/web/src/pages/profile.js',
    ]);
    expect(m.dependencies).toEqual([
      { from: 'pkg:packages/api', to: 'pkg:packages/shared', imports: 1 },
      { from: 'pkg:packages/web', to: 'pkg:packages/shared', imports: 1 },
    ]);
  });

  it('is deterministic', async () => {
    expect(await mapOf('express-cjs')).toEqual(await mapOf('express-cjs'));
  });
});
