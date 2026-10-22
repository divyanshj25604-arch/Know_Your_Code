import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Load a local `.env` for development and simple deployments. Uses Node's built-in parser, never overrides variables
 * that are already set in the real environment, and silently does nothing when no file exists.
 */
export function loadDotEnv(cwd = process.cwd()): string | null {
  for (const dir of [cwd, path.resolve(cwd, '..')]) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
  }
  return null;
}
