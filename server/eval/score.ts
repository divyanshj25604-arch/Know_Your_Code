import type { CapabilityId, Claim } from '@kyc/contracts';
import type { Cite, EvalCase } from './cases';

/**
 * Automated scoring for the evaluation harness (P4.3). Pure functions: no I/O, no model calls.
 * Every metric is a count; rates are counts over a stated denominator. There are no subjective scores.
 */

/** One model call as the harness saw it (from the provider wrapper). */
export interface CallRecord {
  capability: string | null;
  inputTokens: number;
  outputTokens: number;
  totalMs: number;
  firstTokenMs: number | null;
  stopReason: string | null;
  refused: boolean;
  /** The provider returned no parseable JSON. */
  jsonMissing: boolean;
  error: string | null;
}

/** What one case produced. */
export interface CaseOutput {
  /** Final evidence envelope(s) for the case's capability (null when it failed before producing one). */
  envelope: {
    payload: unknown;
    claims: Claim[];
    refsStripped: number;
    refsTotal: number;
    claimsDowngraded: number;
    degraded: boolean;
  } | null;
  /** Error code surfaced to the user, if the request failed. */
  error: string | null;
  calls: CallRecord[];
  /** Ledger statuses of the case's model calls (`ok`, `invalid:...`, `refusal`, error codes). */
  ledgerStatuses: string[];
}

export type FailureCategory =
  | 'error'
  | 'refusal'
  | 'schema_invalid'
  | 'fallback_used'
  | 'truncated'
  | 'invalid_citation'
  | 'missing_citation'
  | 'unsupported_claim'
  | 'missing_content'
  | 'incomplete_output';

export interface CaseResult {
  id: string;
  capability: CapabilityId;
  pass: boolean;
  failures: FailureCategory[];
  details: string[];
  metrics: {
    calls: number;
    schemaInvalidCalls: number;
    truncatedCalls: number;
    refusals: number;
    refsTotal: number;
    refsStripped: number;
    claims: number;
    claimsDowngraded: number;
    expectedCites: number;
    missingCites: number;
    forbiddenMentions: number;
    missingMentions: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    firstTokenMs: number | null;
  };
}

/** Every {path, line} reference anywhere in the payload, plus line evidence of the claims. */
export function collectRefs(payload: unknown, claims: Claim[]): { path: string; line: number }[] {
  const out: { path: string; line: number }[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.path === 'string' && typeof o.line === 'number') out.push({ path: o.path, line: o.line });
      Object.values(o).forEach(walk);
    }
  };
  walk(payload);
  for (const c of claims)
    for (const e of c.evidence ?? [])
      if (e.kind === 'lines' && typeof e.path === 'string' && typeof e.line === 'number')
        out.push({ path: e.path, line: e.line });
  return out;
}

/** All prose in the payload, lower-cased (keys excluded), for mention checks. */
export function payloadText(payload: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') parts.push(v);
    else if (typeof v === 'number') parts.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(payload);
  return parts.join('\n').toLowerCase();
}

const cited = (refs: { path: string; line: number }[], c: Cite) =>
  refs.some((r) => r.path === c.path && r.line >= c.from && r.line <= c.to);

/**
 * Output completeness per capability: the fields a learner needs must be present and non-empty. Field names follow
 * the capability payloads (server/src/ai/capabilities/*).
 */
export function missingFields(capability: CapabilityId, payload: unknown): string[] {
  const p = (payload ?? {}) as Record<string, unknown>;
  const at = (path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
        p,
      );
  const nonEmpty = (path: string) => {
    const v = at(path);
    return typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : v != null;
  };
  // Required for a learner to use the answer (payload shapes: packages/contracts/src/schemas.ts, evidence.ts).
  const need: Record<CapabilityId, string[]> = {
    explain_selection: ['sections.what.text'],
    explain_flow: ['summary.text', 'steps'],
    teach_concept: ['plain', 'backToCode'],
    follow_up: ['text'],
    assess: ['question', 'explanation'],
    grade: ['verdict', 'feedback'],
    summarise_project: ['text'],
  };
  const missing = need[capability].filter((k) => !nonEmpty(k));
  if (capability === 'assess') {
    const choice = Array.isArray(p.options) && p.options.length === 4 && typeof p.correctIndex === 'number';
    const open = Array.isArray(p.rubric) && p.rubric.length > 0;
    if (!choice && !open) missing.push('options+correctIndex | rubric');
  }
  return missing;
}

export function scoreCase(c: EvalCase, out: CaseOutput): CaseResult {
  const failures = new Set<FailureCategory>();
  const details: string[] = [];
  const env = out.envelope;
  const schemaInvalidCalls =
    out.ledgerStatuses.filter((s) => s.startsWith('invalid')).length ||
    out.calls.filter((x) => x.jsonMissing && !x.refused && !x.error).length;
  const truncatedCalls = out.calls.filter((x) => x.stopReason === 'max_tokens').length;
  const refusals = out.calls.filter((x) => x.refused).length;

  if (out.error) {
    failures.add('error');
    details.push(`request failed: ${out.error}`);
  }
  if (refusals) failures.add('refusal');
  if (schemaInvalidCalls) {
    failures.add('schema_invalid');
    details.push(`${schemaInvalidCalls} model call(s) returned output that failed the schema`);
  }
  if (truncatedCalls) {
    failures.add('truncated');
    details.push(`${truncatedCalls} model call(s) stopped at max_tokens`);
  }

  let missingCites = 0;
  let forbidden = 0;
  let missingMentions = 0;
  if (env) {
    if (env.degraded) {
      failures.add('fallback_used');
      details.push('plain-text fallback shown instead of structured output');
    }
    if (env.refsStripped) {
      failures.add('invalid_citation');
      details.push(`${env.refsStripped}/${env.refsTotal} references pointed outside the evidence shown`);
    }
    if (env.claimsDowngraded) {
      failures.add('unsupported_claim');
      details.push(`${env.claimsDowngraded} claim(s) marked verified without a matching edge`);
    }
    const refs = collectRefs(env.payload, env.claims);
    for (const cite of c.expect.mustCite)
      if (!cited(refs, cite)) {
        missingCites++;
        details.push(`missing citation: ${cite.path}:${cite.from}-${cite.to}`);
      }
    if (missingCites) failures.add('missing_citation');
    const text = payloadText(env.payload);
    for (const term of c.expect.mustNotMention)
      if (text.includes(term.toLowerCase())) {
        forbidden++;
        details.push(`unsupported claim: mentions "${term}", which is not in the code`);
      }
    if (forbidden) failures.add('unsupported_claim');
    for (const term of c.expect.mustMention)
      if (!text.includes(term.toLowerCase())) {
        missingMentions++;
        details.push(`missing content: does not mention "${term}"`);
      }
    if (missingMentions) failures.add('missing_content');
    const missing = missingFields(c.capability, env.payload);
    if (missing.length) {
      failures.add('incomplete_output');
      details.push(`incomplete: empty ${missing.join(', ')}`);
    }
  } else if (!out.error) {
    failures.add('error');
    details.push('no answer was produced');
  }

  const firsts = out.calls.map((x) => x.firstTokenMs).filter((x): x is number => x !== null);
  return {
    id: c.id,
    capability: c.capability,
    pass: failures.size === 0,
    failures: [...failures],
    details,
    metrics: {
      calls: out.calls.length,
      schemaInvalidCalls,
      truncatedCalls,
      refusals,
      refsTotal: env?.refsTotal ?? 0,
      refsStripped: env?.refsStripped ?? 0,
      claims: env?.claims.length ?? 0,
      claimsDowngraded: env?.claimsDowngraded ?? 0,
      expectedCites: c.expect.mustCite.length,
      missingCites,
      forbiddenMentions: forbidden,
      missingMentions,
      inputTokens: out.calls.reduce((a, x) => a + x.inputTokens, 0),
      outputTokens: out.calls.reduce((a, x) => a + x.outputTokens, 0),
      latencyMs: out.calls.reduce((a, x) => a + x.totalMs, 0),
      firstTokenMs: firsts.length ? Math.min(...firsts) : null,
    },
  };
}

export interface Rates {
  cases: number;
  passed: number;
  passRate: number;
  /** Model calls whose output failed the schema / all model calls. */
  schemaFailureRate: number;
  /** Expected citations not present / expected citations. */
  missingCitationRate: number;
  /** Cases with an unsupported claim (forbidden mention or downgraded verified claim) / cases. */
  unsupportedClaimRate: number;
  /** Cases whose output was truncated, a fallback, or missing required fields / cases. */
  incompleteOutputRate: number;
  /** References removed as pointing outside the evidence / all references checked. */
  invalidCitationRate: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  p50LatencyMs: number;
  maxLatencyMs: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

export function rates(results: CaseResult[]): Rates {
  const sum = (f: (r: CaseResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const calls = sum((r) => r.metrics.calls);
  return {
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    passRate: ratio(results.filter((r) => r.pass).length, results.length),
    schemaFailureRate: ratio(
      sum((r) => r.metrics.schemaInvalidCalls),
      calls,
    ),
    missingCitationRate: ratio(
      sum((r) => r.metrics.missingCites),
      sum((r) => r.metrics.expectedCites),
    ),
    unsupportedClaimRate: ratio(
      results.filter((r) => r.failures.includes('unsupported_claim')).length,
      results.length,
    ),
    incompleteOutputRate: ratio(
      results.filter((r) =>
        r.failures.some((f) => f === 'truncated' || f === 'fallback_used' || f === 'incomplete_output'),
      ).length,
      results.length,
    ),
    invalidCitationRate: ratio(
      sum((r) => r.metrics.refsStripped),
      sum((r) => r.metrics.refsTotal),
    ),
    calls,
    inputTokens: sum((r) => r.metrics.inputTokens),
    outputTokens: sum((r) => r.metrics.outputTokens),
    p50LatencyMs: pct(
      results.map((r) => r.metrics.latencyMs),
      50,
    ),
    maxLatencyMs: Math.max(0, ...results.map((r) => r.metrics.latencyMs)),
  };
}

/**
 * PROPOSED release thresholds for a real model. They have not been measured against one: P0.2 (the real-model
 * baseline) has not run. Fake-provider results are checked against them only to exercise the harness.
 */
export const PROPOSED_THRESHOLDS = {
  schemaFailureRate: { max: 0.02 },
  missingCitationRate: { max: 0.1 },
  unsupportedClaimRate: { max: 0.05 },
  incompleteOutputRate: { max: 0.02 },
  invalidCitationRate: { max: 0.05 },
  /** Per capability. */
  passRate: { min: 0.9 },
} as const;

export interface ThresholdCheck {
  metric: string;
  scope: string;
  value: number;
  limit: string;
  ok: boolean;
}

export function checkThresholds(overall: Rates, byCapability: Record<string, Rates>): ThresholdCheck[] {
  const t = PROPOSED_THRESHOLDS;
  const out: ThresholdCheck[] = [];
  for (const k of [
    'schemaFailureRate',
    'missingCitationRate',
    'unsupportedClaimRate',
    'incompleteOutputRate',
    'invalidCitationRate',
  ] as const)
    out.push({
      metric: k,
      scope: 'all',
      value: overall[k],
      limit: `<= ${t[k].max}`,
      ok: overall[k] <= t[k].max,
    });
  for (const [cap, r] of Object.entries(byCapability))
    out.push({
      metric: 'passRate',
      scope: cap,
      value: r.passRate,
      limit: `>= ${t.passRate.min}`,
      ok: r.passRate >= t.passRate.min,
    });
  return out;
}

export interface EvalReport {
  kind: 'kyc-ai-eval';
  version: 1;
  startedAt: string;
  provider: string;
  models: { fast: string; strong: string };
  /** False for the fake provider: its results say nothing about real-model quality. */
  realModel: boolean;
  cases: CaseResult[];
  overall: Rates;
  byCapability: Record<string, Rates>;
  thresholds: ThresholdCheck[];
  failureCounts: Record<string, number>;
}

export function buildReport(
  meta: Pick<EvalReport, 'startedAt' | 'provider' | 'models' | 'realModel'>,
  results: CaseResult[],
): EvalReport {
  const caps = [...new Set(results.map((r) => r.capability))].sort();
  const byCapability = Object.fromEntries(
    caps.map((c) => [c, rates(results.filter((r) => r.capability === c))]),
  );
  const overall = rates(results);
  const failureCounts: Record<string, number> = {};
  for (const r of results) for (const f of r.failures) failureCounts[f] = (failureCounts[f] ?? 0) + 1;
  return {
    kind: 'kyc-ai-eval',
    version: 1,
    ...meta,
    cases: results,
    overall,
    byCapability,
    thresholds: checkThresholds(overall, byCapability),
    failureCounts,
  };
}

export interface Regression {
  scope: string;
  metric: string;
  baseline: number;
  current: number;
}

/**
 * Compare against an earlier report. A regression is a capability whose pass rate fell, a rate that got worse by
 * more than `tolerance`, or a case that passed before and fails now. Latency and tokens are reported, not judged.
 */
export function compareReports(baseline: EvalReport, current: EvalReport, tolerance = 0): Regression[] {
  const out: Regression[] = [];
  for (const [cap, cur] of Object.entries(current.byCapability)) {
    const base = baseline.byCapability[cap];
    if (!base) continue;
    if (cur.passRate < base.passRate - tolerance)
      out.push({ scope: cap, metric: 'passRate', baseline: base.passRate, current: cur.passRate });
  }
  for (const m of [
    'schemaFailureRate',
    'missingCitationRate',
    'unsupportedClaimRate',
    'incompleteOutputRate',
    'invalidCitationRate',
  ] as const)
    if (current.overall[m] > baseline.overall[m] + tolerance)
      out.push({ scope: 'all', metric: m, baseline: baseline.overall[m], current: current.overall[m] });
  const before = new Map(baseline.cases.map((c) => [c.id, c.pass]));
  for (const c of current.cases)
    if (before.get(c.id) === true && !c.pass)
      out.push({ scope: c.id, metric: 'case', baseline: 1, current: 0 });
  return out;
}

const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(3));

export function renderMarkdown(r: EvalReport, regressions: Regression[] | null): string {
  const lines = [
    `# AI evaluation report`,
    '',
    `- Started: ${r.startedAt}`,
    `- Provider: ${r.provider} (fast: ${r.models.fast}, strong: ${r.models.strong})`,
    r.realModel
      ? '- Real model: yes. These results are measurements of the configured model.'
      : '- Real model: **no**. This run used the deterministic test provider. It checks the pipeline and the harness; it is **not** evidence of real-model accuracy.',
    `- Cases: ${r.overall.cases}, passed: ${r.overall.passed} (${f(r.overall.passRate)})`,
    `- Model calls: ${r.overall.calls}; tokens in/out: ${r.overall.inputTokens}/${r.overall.outputTokens}; latency p50/max: ${r.overall.p50LatencyMs}/${r.overall.maxLatencyMs} ms`,
    '',
    '## Per capability',
    '',
    '| Capability | Cases | Pass rate | Schema fail | Missing cites | Unsupported | Incomplete | Tokens in/out |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(r.byCapability).map(
      ([c, x]) =>
        `| ${c} | ${x.cases} | ${f(x.passRate)} | ${f(x.schemaFailureRate)} | ${f(x.missingCitationRate)} | ${f(x.unsupportedClaimRate)} | ${f(x.incompleteOutputRate)} | ${x.inputTokens}/${x.outputTokens} |`,
    ),
    '',
    '## Proposed thresholds (not yet validated on a real model; P0.2 pending)',
    '',
    '| Metric | Scope | Value | Limit | Met |',
    '| --- | --- | --- | --- | --- |',
    ...r.thresholds.map(
      (t) => `| ${t.metric} | ${t.scope} | ${f(t.value)} | ${t.limit} | ${t.ok ? 'yes' : 'no'} |`,
    ),
    '',
    '## Failures by category',
    '',
    ...(Object.keys(r.failureCounts).length
      ? Object.entries(r.failureCounts).map(([k, v]) => `- ${k}: ${v}`)
      : ['- none']),
    '',
    '## Cases',
    '',
    ...r.cases.flatMap((c) => [
      `- **${c.id}** (${c.capability}): ${c.pass ? 'pass' : `FAIL [${c.failures.join(', ')}]`}`,
      ...c.details.map((d) => `  - ${d}`),
    ]),
  ];
  if (regressions) {
    lines.push('', '## Regressions against the baseline', '');
    lines.push(
      ...(regressions.length
        ? regressions.map((x) => `- ${x.scope} ${x.metric}: ${f(x.baseline)} -> ${f(x.current)}`)
        : ['- none']),
    );
  }
  return `${lines.join('\n')}\n`;
}
