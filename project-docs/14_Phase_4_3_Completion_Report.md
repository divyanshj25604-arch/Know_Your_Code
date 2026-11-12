# 14 — Phase 4.3 Completion Report: Real-Model Evaluation and AI Reliability

> **Date:** 2026-11-12 · **Branch:** `V1_KYC` (committed; not pushed) · **Scope:** P4.3. **No model provider was called.** Every number below comes from the deterministic test provider (`FakeLlm`), which checks the pipeline and the harness, not model quality. **Live-model evaluation is pending P0.2.**

## 1. What was built

| Part | Where | What it does |
| --- | --- | --- |
| Evaluation dataset | `server/eval/cases.ts` | 11 fixed cases covering all 7 capabilities, on two fixture repositories (Express `acme/notes-api`, React `acme/shop`). Each case states ahead of time the code a grounded answer must cite (`mustCite`), terms only a correct answer contains (`mustMention`), and plausible claims the code does **not** support (`mustNotMention`: hallucination probes such as bcrypt, JWT, Redis, Redux, GraphQL). Expectations come from the fixture source only |
| Runner | `server/eval/runner.ts` | Drives each case through the **real HTTP API** (retrieval, prompts, schema validation, reference and claim verification, persistence), on the provider given. It records every model call (tokens, latency, first token, stop reason, refusal, JSON validity) through a provider wrapper, and every evidence envelope through an executor observer (`RunObserver`, never set in production). It refuses any database whose name does not contain `_test` or `_eval`, because it empties it |
| Scoring | `server/eval/score.ts` | Pure, count-based scoring. A case fails on any of these categories: `error`, `refusal`, `schema_invalid`, `fallback_used`, `truncated`, `invalid_citation` (reference outside the evidence shown), `missing_citation`, `unsupported_claim` (forbidden mention, or a "verified" claim without a matching edge), `missing_content`, `incomplete_output` (required payload fields empty, per capability) |
| Reports and regression | `score.ts` `buildReport`, `compareReports`, `renderMarkdown`; `server/eval/cli.ts` | JSON and Markdown reports in `server/eval/reports/` (git-ignored), with rates per capability and overall, proposed-threshold checks and failure counts by category. `--baseline <report.json>` lists regressions: a capability pass rate that fell, a rate that worsened beyond `--tolerance`, or a case that passed before and fails now; it exits 1 on any. The committed baseline is `server/eval/baselines/fake.json` |
| Live gate | `cli.ts` `liveGate` | A real provider runs only with **all** of `KYC_LIVE_EVAL_APPROVED=yes`, `KYC_EVAL_BUDGET_USD>0` and the provider key. Otherwise it exits 2 with "Live evaluation refused (no model was called)". The approved budget becomes the run's hard spend cap through the budget reservations below |
| Budget controls | `server/src/ai/cost.ts`, `executor.ts`, migration `014_ai_budget.sql` | See section 3 |
| Usage visibility | `GET /api/v1/ai/usage` (own usage only); `npm run ai:usage -w server [days]` (operator) | Per user and capability: requests, input and output tokens, cost; operator report per day, capability and model, with failed calls and distinct users |

The capability IDs are those of the registry (`server/src/ai/registry.ts`): `explain_selection`, `explain_flow`, `teach_concept`, `follow_up`, `assess`, `grade`, `summarise_project`.

## 2. Metrics, thresholds and measured results

| Metric (denominator) | Proposed threshold | Fake-provider run (2026-11-12) |
| --- | --- | --- |
| Schema failure rate (model calls whose output failed the schema / model calls) | ≤ 2% | 0 (0/11) |
| Missing citation rate (expected citations absent / expected citations) | ≤ 10% | 33% (2/6) |
| Unsupported claim rate (cases with a forbidden mention or downgraded verified claim / cases) | ≤ 5% | 0 |
| Incomplete or truncated output rate (cases truncated, on fallback or missing required fields / cases) | ≤ 2% | 0 |
| Invalid citation rate (references stripped / references checked) | ≤ 5% | 4.3% (1/23) |
| Capability pass rate (passed cases / cases, per capability) | ≥ 90% | explain_selection 3/3, explain_flow 1/1, assess 2/2, grade 1/1, teach_concept 0/1, follow_up 0/1, summarise_project 0/2 |
| Latency, tokens | Reported, not judged | 11 calls, 11 006 input / 1 388 output tokens; fake latency is ~0 ms |

- **Thresholds are proposals.** They have not been measured against any real model. Agree them with the tech team after the first live run.
- **The fake run's failures are the stub's limits.** The fake does not mention "express" or "react" in summaries, does not answer the follow-up's question, and cites a placeholder path when teaching a concept. The harness reports each one, and the verifier strips the bad reference, which shows the scoring and verification work. Nothing about real-model accuracy can be inferred from this run.

## 3. AI budget controls

1. **Reservation before every model call.** The executor reserves the call's worst-case cost before calling the model. The estimate is prompt characters ÷ 3 as input tokens (generous; code tokenises at about 3.5–4) plus the full `max_tokens` output allowance, at the tier's configured prices. Thinking tokens count inside `max_tokens`.
2. **Serialised decisions.** All reservations take one transaction-scoped advisory lock (`pg_advisory_xact_lock`). Each decision counts today's logged spend (`llm_calls`, excluding cache hits) **plus** open reservations, so concurrent requests cannot together exceed:
   - the global cap `DAILY_SPEND_CAP_USD` (`BUDGET_EXCEEDED`, 402);
   - each user's share `AI_USER_DAILY_BUDGET_USD`, default 0.5 (`USER_BUDGET_EXCEEDED`, 429). In production this must be below the global cap, so one user can never exhaust it;
   - each user's model calls `AI_USER_DAILY_REQUESTS`, default 300 (`USER_BUDGET_EXCEEDED`).
3. **Settlement.** After the call, its actual tokens and cost are logged (with `capability` and `stop_reason`, both new columns) and the reservation is deleted. A crashed request's reservation stops counting after 10 minutes and is removed by retention.
4. **Graceful refusal.** Relations still stream when a budget is exhausted, and navigation keeps working. The user sees "You've used today's AI allowance…" or "AI explanations have reached today's limit on this server…".
5. **Attribution.** The import-time project summary is now charged to the importing user (it was unattributed before).
6. **Existing limits.** The per-hour route limits (`RATE_EXPLANATIONS_PER_HOUR`, `RATE_FOLLOWUPS_PER_HOUR`) remain as before.
7. **Price safety.** Caps are only as good as the prices behind them, so production with a real provider refuses to start until all four `MODEL_*_USD_PER_MTOK` are set explicitly (P4.5).

**Migration 014** (`014_ai_budget.sql`, rollback `014_ai_budget.down.sql`):

- adds the table `ai_reservations`;
- adds the columns `llm_calls.capability` and `llm_calls.stop_reason`;
- adds the index `llm_calls_owner_day`.

**Tests** (`server/tests/budget.test.ts`, 8 tests):

- 20 concurrent reservations against a cap that fits 3: exactly 3 succeed.
- One user's 10 concurrent calls: 2 succeed, 8 are refused, and another user still succeeds.
- Logged spend counts and cache hits do not; released and expired reservations stop counting.
- The request limit holds under concurrency.
- The worst-case arithmetic is correct.
- Production refuses a per-user cap at or above the global cap.
- Through the API: usage is recorded per capability, no reservation is left open, and `/ai/usage` is private.
- A user over their allowance gets `USER_BUDGET_EXCEEDED` with relations still streamed, while another user is unaffected.

## 4. Running the evaluation

```bash
# Free, offline, any time (test provider). Writes server/eval/reports/<time>-fake.{json,md}.
npm run eval -w server
npm run eval -w server -- --baseline eval/baselines/fake.json      # fails on any regression

# LIVE, after P0.2 is complete and spend is approved. Use a dedicated database: the run empties it.
createdb kyc_eval
EVAL_DATABASE_URL=postgres://localhost/kyc_eval \
KYC_LIVE_EVAL_APPROVED=yes \
KYC_EVAL_BUDGET_USD=<approved amount, e.g. 2> \
ANTHROPIC_API_KEY=<key> \
MODEL_FAST_INPUT_USD_PER_MTOK=<price> MODEL_FAST_OUTPUT_USD_PER_MTOK=<price> \
MODEL_STRONG_INPUT_USD_PER_MTOK=<price> MODEL_STRONG_OUTPUT_USD_PER_MTOK=<price> \
npm run eval:live -w server
# Optional: MODEL_FAST / MODEL_STRONG to evaluate other models; --fail-on-threshold to gate a release.
```

After the first live run:

1. Store its JSON report as `server/eval/baselines/<provider>-<date>.json`, and compare later live runs with `--baseline` against it. Do not compare live runs with the fake baseline.
2. Record the measured rates in this report.
3. Agree the final thresholds.

## 5. Files

**Added:**

- Eval harness: `server/eval/cases.ts`, `runner.ts`, `score.ts`, `cli.ts`, `baselines/fake.json`.
- Usage CLI: `server/src/ai/usage-cli.ts`.
- Migration and rollback: `server/src/db/migrations/014_ai_budget.sql`, `server/src/db/rollbacks/014_ai_budget.down.sql`.
- Tests: `server/tests/budget.test.ts`, `server/tests/eval.test.ts`.

**Modified:**

- `server/src/ai/cost.ts`: reservations, usage and report queries, neutral `modelFor`.
- `server/src/ai/executor.ts`: reserve and release, ledger `capability` and `stop_reason`, observer.
- `server/src/ai/service.ts`: observer plumbing; the summary is charged to the importer.
- `server/src/http/aiRoutes.ts`: `/ai/usage`.
- `server/src/services.ts`, `server/src/app.ts`: `aiObserver` override.
- `server/src/jobs/retention.ts`: expired reservations.
- `server/src/config/env.ts`: per-user caps and the production rule.
- `packages/contracts`: `AiUsageView`, `USER_BUDGET_EXCEEDED`.
- `server/package.json`: `eval`, `eval:live`, `ai:usage`.
- `server/tsconfig.json`: includes `eval`.
- Test resets now truncate `ai_reservations`.

## 6. Acceptance criteria

| Criterion | Status | Notes |
| --- | --- | --- |
| All seven capabilities have evaluation cases | **PASS** | `eval.test.ts` asserts coverage of `CAPABILITY_IDS` |
| Automated evaluation reports can be generated | **PASS** | `npm run eval -w server`; JSON and Markdown; regression comparison tested |
| Budget controls implemented and tested | **PASS** | Section 3 |
| Fake-provider tests pass | **PASS** | `eval.test.ts` (8), `budget.test.ts` (8); the full fake run matches the committed baseline |
| Thresholds defined | **PASS** (proposed) | Measured values exist only for the test provider |
| Live-model evaluation | **BLOCKED** | Pending P0.2, an approved key and an approved budget. The command is ready (section 4); the gate is verified to refuse without approval |
| Real-model grounding, schema, truncation and latency results | **BLOCKED** | Same dependency |
| No unapproved API spending | **PASS** | No provider was called in Phase 4 |
