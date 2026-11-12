#!/usr/bin/env node
/**
 * Runs the Tauri CLI with the build-time API configuration (see desktop-config.mjs):
 *   node scripts/tauri.mjs dev                 # local API (http://localhost:8080 by default)
 *   KYC_DESKTOP_API_ORIGINS=https://api.example.com node scripts/tauri.mjs build [tauri build args]
 * Writes src-tauri/tauri.generated.conf.json (git-ignored) and passes it to the CLI with --config.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopConfigError, desktopBuildConfig } from './desktop-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const [command, ...rest] = process.argv.slice(2);
if (command !== 'dev' && command !== 'build') {
  console.error('usage: node scripts/tauri.mjs dev|build [tauri args]');
  process.exit(2);
}
const release = command === 'build' && !rest.includes('--debug');

let cfg;
try {
  cfg = desktopBuildConfig(process.env, { release });
} catch (e) {
  if (e instanceof DesktopConfigError) {
    console.error(`Desktop configuration error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
const generated = path.join(root, 'src-tauri', 'tauri.generated.conf.json');
writeFileSync(generated, `${JSON.stringify(cfg.tauriConfig, null, 2)}\n`);
console.log(
  `Desktop ${release ? 'release' : 'development'} build. API origins: ${cfg.origins.join(', ')}; default: ${cfg.defaultUrl || '(user enters one)'}`,
);

const r = spawnSync('npx', ['tauri', command, '--config', generated, ...rest], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...cfg.env },
});
process.exit(r.status ?? 1);
