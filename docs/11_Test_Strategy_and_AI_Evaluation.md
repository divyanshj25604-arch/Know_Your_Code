# 11 · Test Strategy and AI Evaluation Framework

| Version | 1.0 | Status | Draft; validates `01` requirements and the thesis (A3, A4) |
|---|---|---|---|

**Purpose.** Test three things separately: (1) does the software work, (2) are the AI explanations correct and grounded, and (3) do people actually understand their code better.

---

## 1. Software testing
| Layer | Tool | Scope | Minimum for MVP |
|---|---|---|---|
| Unit | Vitest | URL parser, filters, redaction regexes, selection classifier, verifier, cost calc, cache keys | All pure functions in ingestion, privacy, retrieval, ai/verifier |
| Integration | Vitest + Testcontainers Postgres (or a local DB) | Analyser on fixture repos → symbols/edges; repositories → snapshots lifecycle; deletion cascade | Fixtures C1, C3, C7, C8 |
| API | Supertest/`fastify.inject` | Each endpoint: happy path, validation errors, owner checks, rate limits | API-01..16 |
| End-to-end | Playwright | Thin slice (`04` §1) on sample repo; keyboard-only path; mobile viewport smoke | 3 scripted journeys |
| Security | Unit + manual | Zip-slip archive, symlink, oversized file, `.env` exclusion, prompt-injection fixture (EV-05), XSS in code content, SSRF URL variants | All cases pass |
| Performance | k6 or autocannon + scripted imports | 10 corpus imports timed; 20 concurrent navigation users; 5 concurrent explanations | NFR-PERF-01..03 measured, not assumed |
| Error paths | Mocked GitHub/LLM | 404, 429, timeouts, malformed model JSON, budget exceeded | Each maps to the `05` §17 message |
| Accessibility | axe-core in Playwright + manual screen-reader pass (NVDA/VoiceOver) | Landing, import, workspace | No serious axe violations |

**CI gate (every PR):** typecheck, lint, unit, API tests. **Nightly / pre-demo:** E2E, corpus import, AI eval smoke (10 cases).

## 2. Test data rules
Use only repos with permissive licences or written owner permission. Participants' private code is never added to fixtures. Their repos are analysed live with consent and deleted after sessions unless they opt in.

## 3. Repository test corpus
The ten shapes are specified in `08` §14 (C1–C10). Selection criteria: JS + TS mix; CommonJS + ESM; React + Express; at least one with path aliases; one broken file; one with a committed secret (synthetic, team-created); one over the limits; one real student project (team's own). Record each repo's URL, licence, commit SHA, and file count in `tests/corpus.json` so results are reproducible.

## 4. AI evaluation benchmark
### 4.1 Dataset
- **60 items** across corpus repos C1–C3, C6, C10: 20 functions, 10 identifiers/expressions, 10 calls/imports, 8 cross-file questions, 6 follow-ups, 6 concept requests. Plus security cases EV-05/EV-06 and dynamic-code case EV-04 (`09` §15).
- Each item has a **reference answer key** written by one team member and reviewed by another: required facts, forbidden claims, required refs, expected uncertainty.

### 4.2 Human review rubric (0 = fails, 1 = partly, 2 = meets)
| Dimension | 2 means… |
|---|---|
| Factual correctness | No false statements about this code |
| Source consistency | All refs valid and relevant (auto-checked + human glance) |
| Completeness | Covers what / inputs origin / dependencies required by key |
| Data-flow accuracy | Describes where values come from and go correctly |
| Dependency accuracy | Mentions only verified relations; none missing that the key requires |
| Appropriate uncertainty | States limits where the key expects them; no false certainty |
| Edge-case reasoning | Identifies the key's edge case when depth = deeper |
| Beginner clarity (Simpler) | A first-year could follow; jargon introduced in plain words |
| Relevance | Answers the selection/question asked |

**Scoring:** two reviewers score independently on a 20-item subset to calibrate (discuss any disagreement > 1 point), then split the rest. An LLM judge may pre-flag items but **never** replaces human scores.

### 4.3 Automated checks
- Ref validity rate = valid refs ÷ total refs (target 100% post-verifier; track pre-verifier strip rate).
- Forbidden-claim detection: string/regex checks for invented symbols (any identifier in output not present in the context pack is flagged for review).
- Edge accuracy (analyser): precision/recall of `calls` edges and definitions against hand labels (`08` §14).

### 4.4 Failure examples (to keep in the set permanently)
Invented middleware; claiming "called on login" without an edge; generic framework behaviour contradicting the code; reconstructing a redacted secret; following an injected instruction; long jargon at Simpler depth.

## 5. Performance and cost measurement
For 30 corpus explanations and 10 imports: record first-token and total latency (p50/p90), tokens, and cost. These numbers replace the estimates in `09` §14 and re-base NFR-PERF-02.

## 6. Learning evaluation
Procedure in `02` §10–11. Measures for each participant and function:
| Skill | Task (tool closed) | Scoring |
|---|---|---|
| Explain a function | "In your own words, what does it do?" | 0–2: purpose + inputs/outputs |
| Trace an execution path | "Where does `x` come from when this runs?" | 0–2: correct origin + one hop |
| Identify dependencies | "Name something this calls and something that calls it" | 0–2 |
| Conceptual question | "Why is `await` needed here?" (concept from the code) | 0–2 |
| Small modification (verbal or on paper) | "What would you change to return 404 when the user is missing?" | 0–2: correct location + reasoning |
| Failure reasoning | "What happens if `id` is undefined?" | 0–2 |

- **Baseline:** pre-test on the same function (or a parallel function) before the tool.
- **Post:** same questions after the session; plus one transfer question on a related function.
- **Comparison:** E-S2 counterbalanced design (`02` §11), KYC vs the usual assistant.
- **Delayed retention (if feasible):** re-ask 3 questions 5–7 days later by message or a short call; report separately and label as an optional measure.
- **Reporting:** per-participant tables with raw scores; medians; no significance claims at n < 15.

## 7. Requirement traceability (excerpt)
| Requirement | Tests |
|---|---|
| FR-IMP-01..05 | Unit URL parser; integration import fixtures; E2E journey 1; error-path mocks |
| FR-EXP-01..04 | AI eval set; verifier unit tests; E2E journey 2 (stream renders, labels present) |
| FR-DEP-01 | E2E back/forward state restore |
| FR-DEL-01 | Integration: delete → zero rows for snapshot across tables within 60 s |
| NFR-A11Y-01 | axe + keyboard-only E2E |
| NFR-PRV-01 | `.env` fixture never stored; redaction unit tests; prompt log inspection |

## 8. Release criteria (before external users)
1. 10/10 corpus imports succeed or fail with the correct error; ≥ 9/10 within NFR-PERF-01.
2. AI eval: **zero** items scoring 0 on factual correctness among the 20 functions; median total ≥ 75% of max; every security case passes. *(These thresholds are our own bar for an explanation tool, not an industry benchmark. Revisit after the first run.)*
3. Ref validity 100% after verification; pre-verifier strip rate recorded.
4. All E2E journeys and the keyboard-only path pass; no serious axe violations.
5. Deletion and retention jobs verified on the production DB.
6. Daily spend cap enforced (test by lowering the cap to $0.01).

**Demo-day extra:** pre-import the demo repo; warm caches for the scripted selections; offline fallback video recorded.

## Assumptions · Risks · Open questions
- Risk: reviewer time. 60 items × ~3 min ≈ 3 hours per run. Run the full set twice (Week 2 end, Week 3 mid) and a 10-item smoke otherwise.
- Open: recruit a senior student or TA as an independent reviewer for credibility.

**Related:** `01` §6–7, §11 · `02` · `08` §14 · `09` §15 · `12`
