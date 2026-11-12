/**
 * Measures the real import pipeline (download -> filter -> analyse) on public GitHub repositories.
 *   npx tsx scripts/measure-import.ts expressjs/express tj/commander.js
 * Needs network access. Uses GITHUB_TOKEN if set, otherwise codeload directly. No database, no AI.
 * Reports what happened on THIS machine at THIS moment; numbers are not a benchmark.
 */
import { loadConfig } from '../server/src/config/env';
import { GitHubClient } from '../server/src/ingestion/github';
import { extractTarball } from '../server/src/ingestion/extract';
import { extractLimits } from '../server/src/jobs/importJob';
import { analyse } from '../server/src/analysis/analyse';
import { readPathAliases } from '../server/src/analysis/project';
import { parseRepoUrl } from '../server/src/ingestion/url';

const repos = process.argv.slice(2);
if (repos.length === 0) {
  console.error('usage: tsx scripts/measure-import.ts owner/repo [owner/repo ...]');
  process.exit(2);
}

const config = loadConfig({
  DATABASE_URL: 'postgres://unused/unused',
  NODE_ENV: 'development',
  ...process.env,
} as NodeJS.ProcessEnv);
const gh = new GitHubClient(config);
const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

console.log(
  `node ${process.version} · ${process.platform}/${process.arch} · github=${gh.hasToken ? 'token' : 'anonymous'}`,
);
console.log(
  'repo | outcome | files(analysable) | symbols | edges | unresolved | download+filter ms | analyse ms | peak RSS',
);

for (const r of repos) {
  const repo = parseRepoUrl(`https://github.com/${r}`);
  const rssBefore = process.memoryUsage().rss;
  let peak = rssBefore;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
  const t0 = performance.now();
  try {
    const h = await gh.openTarball(repo, AbortSignal.timeout(config.IMPORT_TIMEOUT_MS));
    const ex = await extractTarball(h.stream, extractLimits(config));
    const t1 = performance.now();
    const analysable = ex.files.filter((f) => f.analysable);
    const cfg = ex.files.filter((f) => ['tsconfig.json', 'jsconfig.json', 'package.json'].includes(f.path));
    const res = await analyse(
      analysable.map((f) => ({ path: f.path, content: f.content })),
      { knownPaths: ex.files.map((f) => f.path), aliases: readPathAliases(analysable, cfg) },
    );
    const t2 = performance.now();
    console.log(
      `${r} | ok | ${ex.files.length}(${analysable.length}) | ${res.symbols.length} | ${res.edges.length} | ${res.edges.filter((e) => e.reason).length} | ${Math.round(t1 - t0)} | ${Math.round(t2 - t1)} | ${mb(peak)} | failed=${res.failedFiles.length} skipped=${ex.skipped.length}`,
    );
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'ERROR';
    console.log(
      `${r} | rejected: ${code} - ${(e as Error).message} | | | | | ${Math.round(performance.now() - t0)} | | ${mb(peak)}`,
    );
  } finally {
    clearInterval(sampler);
  }
}
