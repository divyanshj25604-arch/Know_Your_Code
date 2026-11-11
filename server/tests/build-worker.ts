import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Third-party packages stay external (they resolve from node_modules at run time); workspace packages (`@kyc/*`) are
 * TypeScript source, so they are bundled in, exactly as tsup does for the deployed build.
 */
const externalExceptWorkspace: Plugin = {
  name: 'external-except-workspace',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@kyc/') ? undefined : { path: args.path, external: true },
    );
  },
};

/** Compile the real analysis worker entry for tests that need worker-thread isolation. Returns its path. */
export async function buildTestWorker(outfile = path.join(here, '.build', 'worker.mjs')): Promise<string> {
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(here, '..', 'src', 'analysis', 'worker.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [externalExceptWorkspace],
    logLevel: 'silent',
  });
  return outfile;
}
