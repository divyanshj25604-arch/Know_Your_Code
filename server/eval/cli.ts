/**
 * AI evaluation CLI (P4.3).
 *
 *   npm run eval -w server                         # deterministic test provider: free, offline, any time
 *   npm run eval -w server -- --baseline eval/baselines/fake.json
 *   npm run eval:live -w server                    # real model: GATED, see below
 *
 * Options: --provider fake|anthropic|groq, --baseline <report.json>, --out <dir>, --tolerance <rate>,
 *          --fail-on-threshold (exit 1 when a proposed threshold is missed).
 *
 * Live runs spend money and are refused unless every gate is open:
 *   - KYC_LIVE_EVAL_APPROVED=yes      the tech team completed P0.2 and approved this run;
 *   - KYC_EVAL_BUDGET_USD=<n>         the approved spend; the budget reservations stop the run at this amount;
 *   - the provider's API key          ANTHROPIC_API_KEY (or GROQ_API_KEY) in the environment.
 * Reports are written to eval/reports/ (git-ignored). They contain model output about the fixture repositories
 * only, never user code.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeLlm } from '../src/ai/fake';
import { createLlm } from '../src/ai/llm';
import { loadConfig } from '../src/config/env';
import { createPool } from '../src/db/pool';
import { runEval } from './runner';
import { compareReports, renderMarkdown, type EvalReport } from './score';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Why a live run may not start, or null when every gate is open. Exported for tests. */
export function liveGate(provider: string, env: NodeJS.ProcessEnv): string | null {
  if (provider === 'fake') return null;
  const problems: string[] = [];
  if (env.KYC_LIVE_EVAL_APPROVED !== 'yes')
    problems.push(
      'KYC_LIVE_EVAL_APPROVED=yes is not set. Live evaluation waits for P0.2 (real-model baseline) and an approved budget.',
    );
  const budget = Number(env.KYC_EVAL_BUDGET_USD);
  if (!env.KYC_EVAL_BUDGET_USD || !Number.isFinite(budget) || budget <= 0)
    problems.push('KYC_EVAL_BUDGET_USD must be set to the approved spend in USD (e.g. 2).');
  const key = provider === 'groq' ? 'GROQ_API_KEY' : 'ANTHROPIC_API_KEY';
  if (provider !== 'anthropic' && provider !== 'groq') problems.push(`unknown provider "${provider}"`);
  else if (!env[key]) problems.push(`${key} is not set.`);
  return problems.length ? problems.join('\n  - ') : null;
}

async function main() {
  const provider = arg('provider') ?? 'fake';
  const blocked = liveGate(provider, process.env);
  if (blocked) {
    console.error(`Live evaluation refused (no model was called):\n  - ${blocked}`);
    process.exit(2);
  }
  const databaseUrl =
    process.env.EVAL_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? 'postgres://localhost/kyc_test';
  const db = createPool(databaseUrl);
  const budgetUsd = provider === 'fake' ? 100 : Number(process.env.KYC_EVAL_BUDGET_USD);
  let llm;
  if (provider === 'fake') llm = new FakeLlm();
  else {
    const config = loadConfig({
      ...process.env,
      LLM_PROVIDER: provider,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
    });
    llm = createLlm(config, { warn: () => undefined } as never);
    if (!llm) throw new Error('provider not configured');
  }
  const env: Record<string, string> = {};
  for (const k of [
    'ANTHROPIC_API_KEY',
    'GROQ_API_KEY',
    'GROQ_API_BASE',
    'MODEL_FAST',
    'MODEL_STRONG',
    'AI_TIMEOUT_MS',
  ])
    if (process.env[k]) env[k] = process.env[k]!;
  for (const k of Object.keys(process.env).filter((x) =>
    /^MODEL_(FAST|STRONG)_(INPUT|OUTPUT)_USD_PER_MTOK$/.test(x),
  ))
    env[k] = process.env[k]!;

  let report: EvalReport;
  try {
    report = await runEval({ db, databaseUrl, llm, provider, budgetUsd, env, log: (l) => console.log(l) });
  } finally {
    await db.end();
  }

  const baselinePath = arg('baseline');
  const regressions = baselinePath
    ? compareReports(
        JSON.parse(readFileSync(path.resolve(baselinePath), 'utf8')) as EvalReport,
        report,
        Number(arg('tolerance') ?? 0),
      )
    : null;
  const outDir = path.resolve(arg('out') ?? path.join(here, 'reports'));
  mkdirSync(outDir, { recursive: true });
  const stem = `${report.startedAt.replace(/[:.]/g, '-')}-${provider}`;
  writeFileSync(path.join(outDir, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outDir, `${stem}.md`), renderMarkdown(report, regressions));
  console.log(
    `\n${report.overall.passed}/${report.overall.cases} cases passed. Report: ${path.join(outDir, `${stem}.md`)}`,
  );
  if (!report.realModel) console.log('Test provider: these numbers are not evidence of real-model quality.');
  if (regressions?.length) {
    console.error(`${regressions.length} regression(s) against ${baselinePath}`);
    process.exit(1);
  }
  if (process.argv.includes('--fail-on-threshold') && report.thresholds.some((t) => !t.ok)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
