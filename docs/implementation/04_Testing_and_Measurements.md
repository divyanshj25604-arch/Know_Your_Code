# 04 · Testing and Measurements

| Field | Value |
|---|---|
| Machine | MacBook (Apple silicon, arm64), macOS, Node v26.9.0, npm 11, PostgreSQL 16.15 (Homebrew), Chromium via Playwright, 22 Oct 2026 |
| Network | Real internet. `api.github.com` unauthenticated quota was exhausted, so imports used `codeload.github.com` |
| Not available | `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`: **nothing below exercised the real Claude API or authenticated GitHub** |

Numbers describe what happened on this machine at this moment. They are not benchmarks.

## 1. Test inventory

### Unit and integration (Vitest) — `npm test`
Server tests use a **real PostgreSQL** (`kyc_test`), the **real Fastify app**, and for import tests a **real HTTP download** from
a local stand-in for codeload serving real `.tar.gz` archives, so extraction, analysis (ts-morph) and persistence are real.

| File | Tests | Covers |
|---|---|---|
| `ingestion-url.test.ts` | 35 | URL grammar, SSRF variants, ref override |
| `redact.test.ts` | 18 | token/key/connection-string redaction, secret-file rules |
| `extract.test.ts` | 19 | zip-slip, symlinks, binary/UTF-8, limits, bombs, generated files, corrupt archive |
| `github.test.ts` | 8 | codeload vs token mode, redirect to a foreign host, 404/429, size caps, error leakage |
| `analyse.test.ts` | 23 | symbols, ranges, cross-file calls (CJS destructure, ESM alias, `@/` paths), JSX references, route pattern edges, unresolved reasons, syntax errors, ground-truth edges, "no edge to an unknown symbol" |
| `resolve.test.ts` | 13 | selection kinds (6), cursor expansion, whitespace/comment/out-of-range, TS/TSX, broken syntax |
| `api.test.ts` | 12 | full import → tree/file/overview/resolve/relations, partial repo, limits, not-ready/expired gating, ownership, delete cascade, double-submit race, starting-point filtering |
| `ai.test.ts` | 24 | SSE order, cache, prompt/untrusted placement, secrets, stripped refs, retry then error, timeout/busy/refusal, budget cap, AI not configured, rate limit, ownership, follow-ups, concepts, depth, checks, feedback, summary |
| `ai-units.test.ts` | 10 | verifier, schema normalisation, check schema, cost formula |
| `anthropic-llm.test.ts` | 6 | **wire-level only** (injected `fetch`): request body, auth header, retries, error mapping, timeout |
| `runner.test.ts` | 4 | worker output identical to inline, event loop stays responsive, time-limit termination, fallbacks |
| `security.test.ts` | 15 | cross-site/Origin, headers/CSP, cookie flags, forged cookie, proxy trust, body limits, retention |
| `deletion-perf.test.ts` | 1 | delete with 48k other symbols stored must take < 2 s (fails at 14.0 s without migration 003) |
| `health.test.ts`, `config.test.ts`, `dotenv.test.ts` | 4, 4, 3 | health states (incl. 503), config validation, `.env` loading |
| **Server total** | **199** | |
| Client: `components.test.tsx` 11, `repoUrl.test.ts` 7, `App.test.tsx` 3, `inline.test.tsx` 3 | **24** | tree keyboard/filter, relations, URL input, error state, XSS-safe inline rendering, routing |

### End to end (Playwright, Chromium) — `npm run test:e2e` (deterministic mode, 18 tests)
Real built SPA, real server, real ingestion/analysis/Postgres, local GitHub stand-in, **deterministic test AI provider**.

- `journey.spec.ts` (4): the critical journey — landing → import with staged progress → overview → open file → select function →
  verified relations then explanation → follow a callee → Back restores → follow-up → concept → Simpler → optional check (skip) →
  feedback → deep link survives reload → delete → old link errors (also asserts **no CSP violations**); hostile/secret text;
  keyboard-only path; empty selection message.
- `errors.spec.ts` (8): inline URL hints, private/missing, GitHub rate limit, outage, unsupported language, partial parse, AI failure
  keeps relations + Retry, unknown snapshot.
- `a11y.spec.ts` (4): axe-core (WCAG 2a/2aa/21aa/22aa) on landing, start, overview, viewer, panel — light and dark; zero serious/critical.
- `responsive.spec.ts` (2): tablet drawer; mobile bottom sheet, no horizontal scroll.

### Live mode — `npm run test:live` (needs network; `ANTHROPIC_API_KEY` for the AI test)
Production build (`node server/dist/server.js`, worker thread active), real GitHub downloads. Result of the final run:
5 passed (express, commander.js, ky imported through the UI; React rejected over the limit; nonexistent repo → public-only
message), **1 skipped: "LIVE Claude" (no key) — the real AI integration remains unverified.**

## 2. Results (final run on this machine)

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors (contracts, server, client) |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run format:check` | clean |
| `npm test` | server 16 files / 199 tests pass; client 4 files / 24 tests pass |
| `npm run build` | succeeds (editor chunk ~410 kB, lazy-loaded; server bundle + worker) |
| `npm run test:e2e` | 18 / 18 pass (~33 s) |
| `npm run test:live` | 5 pass, 1 skipped (real Claude) |
| `npm audit` | 0 vulnerabilities |
| `scripts/smoke.mjs --ai` against the built server | passes (10 steps; `--ai` hit the test provider) |

## 3. Measurements (real public repositories, this machine)

**Import pipeline** (`scripts/measure-import.ts`, no DB, anonymous codeload):

| Repository | Files (analysable) | Symbols | Edges (unresolved) | Download+filter | Analyse | Peak RSS |
|---|---|---|---|---|---|---|
| expressjs/express | 213 (141) | 8,326 | 11,478 (10,735) | 0.9 s | 1.4 s | 436 MB |
| tj/commander.js | 214 (170) | 5,865 | 9,953 (4,671) | 0.6 s | 1.0 s | 504 MB |
| sindresorhus/ky | 112 (98) | 9,842 | 11,988 (9,601) | 0.4 s | 3.4 s | 746 MB |
| facebook/react | — | — | rejected: > 1,500 analysable files | 1.2 s to reject | — | 208 MB |
| microsoft/TypeScript | — | — | rejected: too many archive entries | 2.8 s to reject | — | 276 MB |

(Unresolved counts were taken before external-package calls stopped being counted as "can't follow"; in express 93% of the
unresolved edges are in `test/`.) Through the UI against the production build: workspace ready in **4.4 s (express), 3.9 s
(commander), 5.4–6.9 s (ky)**.

**Event-loop impact of an import** (`scripts/measure-blocking.mjs`, `GET /health` polled every 25 ms during an import):

| Repository | Main-thread analysis (before) max latency | Worker thread (after) max latency |
|---|---|---|
| ky | 1,113 ms (p99 1,113) | 19 ms (p99 16) |
| express | 311 ms | 19 ms |
| commander.js | 157 ms | 20 ms |

**Navigation under load** (`scripts/measure-nav.mjs`, express snapshot, 20 concurrent clients, 10 s, loopback):
127,004 requests, 12.7k req/s, 0 errors. p50/p90/p99: file 0.9/1.4/2.9 ms, tree 1.2/1.7/3.1 ms, overview 0.5/0.8/2.4 ms,
relations 8.9/10.2/12.3 ms; all requests p90 **2.3 ms**.

**Delete** of an imported repository (5.9k symbols): 149 ms after migration 003 (it took 11.6–16.7 s with other repositories
stored before the foreign-key indexes existed).

**Not measured:** real-model latency, first-token time, tokens and cost per explanation (no key); import time for a repository
at the 1,500-file limit; 20 concurrent explanations.

## 4. Defects found by testing (and fixed)

| Found by | Defect | Fix |
|---|---|---|
| First import test | `tags` NULL violated NOT NULL on symbol insert | `COALESCE` to empty array |
| Pipeline test | A `data` listener started the stream before extraction attached, dropping chunks | Hash inside the pipeline (Transform) |
| Anthropic wire test | A 400 was retried like a 5xx; `x-api-key` assumption wrong (SDK sends `Authorization: Bearer`) | Retry only 5xx/429/timeouts; assertion fixed |
| First browser run | "Calls" links used the call-site line with the target's path | Link to the callee's definition line; regression test |
| Browser run | Follow-up answer overwritten by "connection interrupted" (same item id) | Convert only still-pending items |
| Browser run | Tree arrow keys acted on stale focus (async focus) | Focus synchronously |
| axe | Contrast failures (warning colour, light keyword, dark comment on the highlight tint) | Tokens recomputed to ≥ 4.5:1 |
| Event-loop measurement | Main-thread analysis stalled the API up to 1.1 s | Worker thread |
| Smoke test | Delete took 12–16 s once other repos were stored | FK indexes (migration 003) + regression test |
| Live-mode run | Relative `STATIC_DIR` crashed the production server | Resolve to an absolute path |
| Dev check | Vite proxy + new Origin check rejected every POST in `npm run dev` | `changeOrigin: false` |
| Own review | Racing double submit → unique-violation 500; spoofable `X-Forwarded-For`; feedback on unowned ids; `\.` lost in a template-string SQL regex | idempotent create; `TRUST_PROXY`; ownership check; escaped |
| Gate failure | A commit was pushed with lint failing (command chain did not gate) | Fixed in the next commit; `npm run check` added |

## 5. What would raise confidence next

1. Run `npm run test:live` and `node scripts/smoke.mjs --ai` with a real `ANTHROPIC_API_KEY`; record first-token latency,
   tokens and cost per explanation, then re-base `NFR-PERF-02` and `DAILY_SPEND_CAP_USD`.
2. Run the `docs/11` AI evaluation (60 items, human rubric) and the learning study in `docs/02`. Neither was run.
3. Deploy to the target host and run the smoke test there; confirm the GitHub Actions workflow in `.github/workflows/ci.yml`
   passes on GitHub (it was written but **has not been run** there).
4. A manual screen-reader pass (VoiceOver/NVDA) and mobile-device test.
