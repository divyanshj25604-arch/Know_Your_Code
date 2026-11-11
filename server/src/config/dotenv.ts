import { existsSync } from 'node:fs';
import path from 'node:path';

export interface DotEnvOptions {
  /**
   * Also look in the parent directory. Only for source runs: `npm run dev -w server` starts in `server/` while the
   * developer's `.env` lives at the repository root. A deployed (bundled) build never searches upwards, so a stray
   * `.env` above the deployment directory cannot configure production (risk S7).
   */
  searchParent?: boolean;
}

/**
 * Load a local `.env` for development and simple deployments. Uses Node's built-in parser, never overrides variables
 * that are already set in the real environment, and does nothing when no file exists.
 */
export function loadDotEnv(cwd = process.cwd(), opts: DotEnvOptions = {}): string | null {
  const dirs = opts.searchParent ? [cwd, path.resolve(cwd, '..')] : [cwd];
  for (const dir of dirs) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
  }
  return null;
}
