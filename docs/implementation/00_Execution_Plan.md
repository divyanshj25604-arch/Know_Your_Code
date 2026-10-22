# V1 Execution Plan

Branch: `V1_KYC` (from `main` @ `49d1268`). Implements the documentation in `docs/` (source of truth: `01`).

## 1. Starting point
The repository contained only documentation (no code, no tooling, no CI). Everything below is greenfield.

Environment facts that shaped decisions (checked 22 Oct 2026):
| Fact | Consequence |
|---|---|
| Node 26.9, npm 11, **no pnpm** | npm workspaces instead of the `pnpm` named in `07` §12 (ADR-11) |
| Local PostgreSQL 16 with `pg_trgm`, `pgcrypto`; no Docker | Dev/test DB is local Postgres; tests use a separate `kyc_test` database |
| No `ANTHROPIC_API_KEY`, no `GITHUB_TOKEN` | Live AI tests cannot run here; a clearly-labelled deterministic provider covers CI. Live mode is implemented and documented but unverified in this environment |
| `api.github.com` unauthenticated limit (60/h) already exhausted from this IP; `codeload.github.com` reachable | Ingestion uses the GitHub API when `GITHUB_TOKEN` is set and falls back to codeload-only (HEAD ref, no metadata pre-check) otherwise (ADR-12) |
| Playwright Chromium already cached | Playwright E2E is feasible |

## 2. Architecture (as in `07`, with the deviations in §5)
Modular monolith: Fastify API + in-process job runner + React/Vite SPA served statically by the same process; PostgreSQL; ts-morph; Claude API behind `LlmClient`.

```
packages/contracts   Zod schemas + shared types/error codes (client + server)
server/src/
  config/            env validation
  db/                pool, migration runner, SQL migrations
  ingestion/         URL parsing, GitHub client, tarball fetch + safe extraction, filters
  privacy/           secret redaction
  analysis/          ts-morph analyser, selection resolver
  index/             repositories (SQL) for snapshots/files/symbols/edges
  retrieval/         context pack builder
  ai/                LlmClient, prompts, schemas, verifier, explain/followup/concept/check services
  jobs/              in-process runner, retention
  http/              Fastify routes (API-01..16), owner cookie, rate limits, SSE
client/src/          React SPA per `06`
tests/               fixtures, e2e (Playwright)
```

## 3. Milestones and exit criteria
| # | Milestone | Exit criteria |
|---|---|---|
| 1 | Baseline + plan | This document committed |
| 2 | Foundation | `npm run typecheck lint test build` run on skeleton; health endpoint; DB migrations apply |
| 3 | Ingestion | URL/SSRF/zip-slip/limits/filters unit tests pass; fixture tarball import works |
| 4 | Analysis + index | Fixture repos yield expected symbols/edges; syntax-error repo is partial; unresolved reasons recorded |
| 5 | Retrieval + relations API | Relations, resolve, tree, file, overview endpoints tested via `fastify.inject` |
| 6 | AI service | Context pack, schema validation, verifier (incl. injection fixture), SSE, caching, budget cap, error mapping tested; fake provider for CI |
| 7 | Client workspace + learning UX | Landing, import, processing, overview, workspace, explanation panel, follow-up, depth, concepts, feedback, delete |
| 8 | Optional checks (Should) | Only if core is green: `Check yourself` skippable, never gating |
| 9 | Hardening | Playwright E2E over real server + real ingestion of a local fixture repo; security regressions; perf measurements |
| 10 | Deploy + docs | Health/readiness, prod build, smoke script, README, deployment/rollback docs, known limitations |

## 4. Testing approach
- Unit (Vitest): URL parser, filters, redaction, selection classifier, verifier, cost calc, cache keys.
- Integration (Vitest + local Postgres `kyc_test`): analyser on fixtures → DB, lifecycle, deletion cascade.
- API: `fastify.inject`.
- E2E: Playwright against the running app. **Deterministic mode** (`LLM_PROVIDER=fake`, ingestion from a local fixture tarball server) vs **live mode** (real Claude + real GitHub; skipped without credentials and reported as unverified).
- Never report deterministic results as proof the live AI integration works.

## 5. Decisions and deviations
| ID | Decision | Reason |
|---|---|---|
| ADR-11 | npm workspaces, not pnpm | pnpm absent; npm is the incumbent tool in this environment; avoids installing global tooling |
| ADR-12 | GitHub API optional; codeload fallback | API rate limit exhausted; metadata (private/size) pre-check degrades gracefully, tarball cap still enforced |
| ADR-13 | ts-morph runs in the main process (no worker thread) for V1 | `07` lists the worker thread as a *Should*/open question; concurrency is capped at 2 imports and per-file caps apply. Revisit if T-1 measurements show API stalls |
| ADR-14 | Plain SQL migrations + a ~40-line runner, not drizzle-kit | `10` allows `node-pg-migrate` *or* drizzle; a tiny runner avoids an ORM we would not use (queries are hand-written SQL) |
| ADR-15 | Deterministic LLM provider (`LLM_PROVIDER=fake`) exists for tests/CI only | Required by the testing mandate; production config rejects it unless explicitly set and the UI shows a visible banner |
| ADR-16 | Express route heuristic (D-09/T-4) implemented only if time permits after core | Marked *Could* in `04` |

## 6. Risks
| Risk | Mitigation |
|---|---|
| Live Claude path unverified (no key) | Interface + schema + error-path tests; document precisely what is unverified |
| ts-morph memory/time on big repos | Limits from `08` §3; measured and reported, not assumed |
| Scope creep into Should features | Must features and hardening first; Should features only after |

## 7. Completion criteria
See the task's §18: working thin slice end to end, tests green, build succeeds, docs match implementation, all on `V1_KYC`, limitations stated honestly.
