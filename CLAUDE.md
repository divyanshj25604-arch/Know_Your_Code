# CLAUDE.md — Know Your Code

Guidance for Claude (and any contributor) working in this repository. **Keep this file current**: update it in the same
change whenever structure, commands, decisions, roadmap status or documentation rules change, and add a line to the
changelog at the bottom.

## Product in one paragraph

Know Your Code is a learning-first codebase understanding platform, complemented by AI (not a chatbot with a codebase
attached). MVP direction: **desktop frontend + cloud runtime + shared core**; the local runtime is deferred. The MVP has six
learning levels: project understanding, application understanding, concept understanding, guided code exploration,
interactive understanding, knowledge validation. Users can follow guided learning and also explore freely, and exploring
must never reset their learning progress.

## Source of truth (only these documents)

All documentation lives in [`project-docs/`](project-docs/). Nothing else in the repo is authoritative documentation.

| File                                                    | Use it for                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_Engineering_Decision_Document.md`                   | **Start here.** Decisions, component classification, six-level gap analysis, risk register, target architecture, phased roadmap (P0.1–P4.5), what not to build        |
| `01_Repository_Reconnaissance_Audit.md`                 | Repository map, stack, routes, tables, tests, dead code                                                                                                               |
| `02_Ingestion_and_Static_Analysis_Audit.md`             | Ingestion pipeline, ts-morph analyser, symbols, edges, flow readiness                                                                                                 |
| `03_Database_and_Data_Model_Audit.md`                   | ER diagram (Mermaid), table catalogue, data lifecycle, schema recommendations                                                                                         |
| `04_Context_Retrieval_Audit.md`                         | Request lifecycle, context-pack algorithm, evidence verification                                                                                                      |
| `05_AI_Layer_Audit.md`                                  | Providers, prompts, schemas, verification, cost, capability-registry recommendation                                                                                   |
| `06_Frontend_and_Product_Experience_Audit.md`           | Client architecture, components, state, desktop readiness                                                                                                             |
| `07_Architecture_Security_and_Cloud_Readiness_Audit.md` | Module coupling, shared-core extraction, jobs, security findings, deployment checklist                                                                                |
| `08_Brand_Identity_Requirements.md`                     | **Authoritative brand requirement** (from `KnowYourCode-Brand-Kit-v1.0.pdf`): palette, type, logo rules, voice, tokens; audit of the current UI; brand-pass work list |
| `09_Phase_1_Completion_Report.md`                       | What Phase 1 (and its Phase 0 prerequisites) changed, how it was verified, acceptance-criteria evidence, limitations and debt                                         |
| `10_Phase_2_Completion_Report.md`                       | Phase 2 (P2.1–P2.4): what changed, evidence per acceptance criterion, what is blocked on P0.2, risks                                                                  |
| `11_Phase_3_Completion_Report.md`                       | Phase 3 (P3.1–P3.7): six learning levels, flows, paths; acceptance evidence, migrations, APIs, limitations, Phase 4 dependencies                                      |
| `12_Phase_4_1_Completion_Report.md`                     | P4.1 Tauri desktop shell: security model, build, macOS/Windows signing and release procedure, manual checklist                                                        |
| `13_Phase_4_2_Completion_Report.md`                     | P4.2 deployment: Render selection, `render.yaml`, single-instance guard, backups and restore, monitoring and alerts, staging steps                                    |
| `14_Phase_4_3_Completion_Report.md`                     | P4.3 AI evaluation harness, proposed thresholds, budget reservations, the gated live-evaluation command                                                               |
| `15_Phase_4_4_Completion_Report.md`                     | P4.4 secret detection: scope decision (deferred until private repos) and implementation plan                                                                          |
| `16_Phase_4_5_Completion_Report.md`                     | P4.5 provider pricing and privacy copy audit, verified Groq facts (dated)                                                                                             |
| `17_Phase_4_Final_Completion_Report.md`                 | Phase 4 summary: status of every acceptance criterion, test results, blocked dependencies, manual steps                                                               |

Diagrams are PNGs in `project-docs/images/`. The same documents also exist as Claude Docs (shareable copies); the files in
`project-docs/` are canonical.

### Documentation rules

- When code changes make a statement in `project-docs/` untrue, update that document in the same change. Prefer editing the
  relevant section over appending notes.
- When a roadmap task starts or finishes, update the **Roadmap status** table below and, if the decision changed, section 7
  of `00_Engineering_Decision_Document.md`.
- Keep the evidence labels used in the documents: **Verified** (source + named test), **Partially verified**, **Inference**,
  **Unverified**. Never present a planned feature as implemented, and never claim real-AI behaviour without a recorded
  live run.
- Do not add new top-level documentation elsewhere (no new `docs/` folder). New material goes into `project-docs/` and is
  listed in the table above.
- `project-docs/` is excluded from Prettier (`.prettierignore`) and ESLint (`eslint.config.js`), as the old `docs/` was.

### Removed documentation (historical only)

The previous `docs/` folder (product blueprint 00–14, 99, `docs/implementation/*`, screenshots, archive zip) was deleted on
2026-11-12. The audits and some code comments still cite paths such as `docs/07_System_Architecture.md` or
`docs/implementation/04_Testing_and_Measurements.md:51`; those citations are historical evidence and can be read with
`git show b10a2f5:<path>`. Do not treat them as current requirements.

## Key decisions (from `00_Engineering_Decision_Document.md`)

- Keep this repository; reshape rather than rewrite. One deployable **modular monolith** + one **PostgreSQL**. No Redis,
  BullMQ, microservices, vector DB or ORM migration for the MVP.
- Target packages: `@kyc/contracts` ← `@kyc/core` (new, runtime-free: analysis, retrieval planning, AI contracts, learning
  logic) ← `server` (cloud runtime). The client depends only on `contracts`.
- `core` must never import Fastify, `pg`, `process.env` or HTTP errors. All SQL lives behind store interfaces in `server`.
  Enforced by `packages/core/tsconfig.json` (no host typings) and `packages/core/tests/boundary.test.ts`.
- Learning data references code by **stable symbol keys** (`symbols.symbol_key`, see
  `packages/core/src/analysis/symbolKey.ts`), never by per-run row ids. Code rows expire; learning rows hang off the
  durable `repositories` row (composite `(repository_id, user_id)` foreign keys).
- Identity (P1.2): `users` (anonymous or registered, email + scrypt password), opaque session tokens stored hashed in
  `user_sessions`; httpOnly cookie for the web, bearer token for desktop. Snapshot reads are owner-or-share-token
  (P1.5); strangers get 404. Cross-origin access only for `CORS_ALLOWED_ORIGINS`, bearer-only (P1.6).
- Product UI must follow `project-docs/08_Brand_Identity_Requirements.md`; the brand pass is a separate, approved task.
- Reuse as-is: ingestion (`server/src/ingestion/*`), worker host (`analysis/runner.ts`), selection classifier, migrations,
  `FakeLlm`, UI primitives (`client/src/components/ui.tsx`).
- Replace: anonymous `owners` identity, the fixed `buildContextPack` slot recipe, the five AI output schemas,
  `client/src/hooks/useWorkspace.ts`.
- Imported repository code is never executed. Keep it that way (Level 5 is a static walkthrough, not execution).

## Repository layout (current code)

- `packages/contracts/` — shared TS types, Zod schemas, error codes (`@kyc/contracts`).
- `packages/core/` — runtime-free logic (`@kyc/core`): analyser, stable symbol keys, selection classifier, overview,
  file filters, redaction, `KycError`, retrieval planner over `GraphStore` (`retrieval/`), reference and claim
  verifier (`ai/verify.ts`), module detection (`analysis/modules.ts`), concept detectors (`analysis/concepts.ts`),
  Express adapter and request-flow discovery (`analysis/express.ts`, `analysis/flows.ts`), learning-path generator
  (`learning/paths.ts`). Its tests own the sample-repository fixtures (`packages/core/tests/fixtures`).
- `server/src/` — Fastify 5 API: `http/` (routes, auth routes, SSE, snapshot access, CORS and security), `auth/`
  (identity, sessions, passwords, share tokens, anonymous-work claim), `ingestion/` (GitHub URL, tarball, extraction),
  `analysis/` (worker host only), `index/` (raw-SQL persistence incl. analysis runs, architecture, concepts, flows,
  learning paths, tours, bookmarks), `retrieval/` (context pack),
  `ai/` (providers incl. streaming, capability registry `registry.ts` + `capabilities/*`, `executor.ts`, SQL `store.ts`,
  prompts, schemas, cost, orchestrating `AiService`), `jobs/` (in-process queue, transactional import
  pipeline, retention), `db/` (pool + `withTx`, migration runner, `migrations/`, operator `rollbacks/`), `config/`.
- `server/tests/` — Vitest suites against a real Postgres, fixtures, fake GitHub, E2E server bootstrap.
- `client/src/` — React 19 + Vite SPA: `pages/` (workspace under `/r/:id/:mode`), `components/` (`modes/`,
  `explanation/` presentational parts, `learning/` architecture map, concepts, bookmarks, tour, learning paths,
  `flows/` flow explorer and walkthrough), `hooks/useWorkspace.ts` (one track), `state/` (branching trail, query cache,
  explanation store), `api/` (`createApiClient`, base URL and auth strategy in `config.ts`), `styles/`.
- `server/src/ops/` — operations: error reports and 5xx/job alerts (`monitor.ts`), single-instance worker lock
  (`instanceLock.ts`), database connectivity (`database.ts`).
- `server/eval/` — AI evaluation harness (dataset, runner through the real API, scoring, reports, gated live CLI);
  `eval/baselines/fake.json` is the regression baseline for the test provider.
- `desktop/` — Tauri 2 shell (`src-tauri/`: six native commands, capabilities, CSP; `scripts/tauri.mjs` build wrapper).
  The client side is `client/src/desktop/` (start-up gate, bridge).
- `render.yaml` — Render Blueprint (staging + production web services and databases).
- `e2e/` — Playwright specs (`live.spec.ts` needs `LIVE=1` and an API key; `desktop.spec.ts` serves the client from a
  second origin and stubs Tauri IPC).
- `scripts/` — smoke test (`smoke.mjs`, covers all modes and auth), database backup and restore, measurement scripts.
- `project-docs/` — the source-of-truth documents (00–17).

## Commands

```bash
npm install
npm run dev          # API :8080 + web :5173
npm run check        # typecheck + lint + format check + tests (needs PostgreSQL >= 15: createdb kyc_test)
npm test             # core + server + client tests
npm run test:e2e     # Playwright, deterministic mode (fake AI, local GitHub stand-in)
npm run test:live    # real GitHub; real Claude only if ANTHROPIC_API_KEY is set (costs money — ask first)
npm run build        # client/dist + server/dist
npm start            # node server/dist/server.js (set NODE_ENV=production explicitly in deploys)
npm run db:migrate   # apply SQL migrations
npm run eval -w server                 # AI evaluation on the test provider (free); eval:live is gated (P0.2)
npm run ai:usage -w server             # AI usage per day/capability/model from the cost ledger
npm run dev -w @kyc/desktop            # desktop shell against the local API (needs Rust)
KYC_DESKTOP_API_ORIGINS=https://… npm run build -w @kyc/desktop   # desktop release build (unsigned without keys)
BASE_URL=https://… npm run smoke       # post-deploy smoke test (no AI calls without --ai)
scripts/db-backup.sh / db-restore.sh   # logical backup; restore into an empty database only
```

## Working conventions

- Raw SQL via `pg`; forward-only migrations in `server/src/db/migrations/`, each with an operator rollback script in
  `server/src/db/rollbacks/` (tested by `server/tests/migrations.test.ts`). There is no Prisma. PostgreSQL >= 15.
- Multi-statement writes go through `withTx` (`db/pool.ts`).
- Branch in use: `V1_KYC` (main branch for PRs: `main`). Do not commit or push unless asked.
- Never read or print values from `.env`; refer to variables by name only.
- Do not make billable AI calls (live tests, smoke `--ai`) without explicit approval.
- Known traps: real-model AI is still unverified (T1, P0.2), including streaming and thinking-aware token sizes;
  object-method `qualifiedName` doubling (T15). Resolved in Phase 1: S1 (bundled build requires explicit
  `NODE_ENV=production`), S2 (snapshot reads authorised), S3 (accounts), S6, S7, T2, T3, T6, T9, T13, T14.
- The built server (`npm start`) refuses to start unless `NODE_ENV=production` is set; use `npm run dev` locally.
- Analysis output changed in Phase 3 (`ANALYSER_VERSION` `core-3`): snapshots analysed earlier have no concept tags or
  flows until re-imported (the flows API reports `available: false`).
- Every model call reserves budget first (`reserveBudget` in `ai/cost.ts`); never call a provider outside the executor.
  Production with a real provider needs explicit `MODEL_*_USD_PER_MTOK` prices; Groq needs explicit model names.
- The eval harness empties its database: it refuses names without `_test`/`_eval`. Never point it at real data.
- Only the process holding the worker advisory lock runs imports (`server.ts`); tests use an unpaused runner.
- Privacy copy comes from `HealthView.privacy` (`components/PrivacyFacts.tsx`); do not hard-code provider names,
  retention days, prices or provider data-handling claims in the UI.
- Flow steps are evidence: a `verified` step must reference its stored call edge (enforced by the database), and
  anything not followed is an `unknown` step with a reason. Never add a step the analysis did not find.

## Roadmap status

Phases and task IDs are defined in section 7 of `00_Engineering_Decision_Document.md`.

| Phase                            | Tasks                                                                                                                  | Status                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0 — Safety and evidence baseline | P0.1 config, P0.2 live AI baseline, P0.3 test gaps, P0.4 transactional imports                                         | P0.1, P0.3, P0.4 done; **P0.2 deferred to the tech team** (needs approved spend; runs after Phase 4's unblocked tasks)       |
| 1 — Foundations                  | P1.1 core package, P1.2 identity, P1.3 stable keys, P1.4 learner schema, P1.5 snapshot authz, P1.6 API base URL + CORS | **Done** 2026-11-12, awaiting review (see `09_Phase_1_Completion_Report.md`)                                                 |
| Brand pass (unscheduled)         | Implement `08_Brand_Identity_Requirements.md` section E                                                                | Not started; needs approval                                                                                                  |
| 2 — Restructure                  | P2.1 learner state, P2.2 app shell, P2.3 AI registry, P2.4 retrieval planner                                           | **Done** 2026-11-12, awaiting review; P2.3 real-model criteria blocked on P0.2 (see `10_Phase_2_Completion_Report.md`)       |
| 3 — Six levels                   | P3.1 architecture, P3.2 flows, P3.3 concepts, P3.4 bookmarks/tours, P3.5 assessment, P3.6 walkthrough, P3.7 paths      | **Done** 2026-11-12, awaiting review; AI parts unverified on a real model until P0.2 (see `11_Phase_3_Completion_Report.md`) |
| 4 — Ship                         | P4.1 desktop shell, P4.2 deploy + ops, P4.3 AI evaluation, P4.4 redaction, P4.5 Groq                                   | **Implemented** 2026-11-12, committed (not pushed); deploy, signing, live eval BLOCKED; P4.4 deferred (see 17)               |

## Changelog

- 2026-11-12 — Created `project-docs/` with the eight audit and decision documents as the only source of truth; deleted the
  old `docs/` folder; replaced `README.md` with a pointer; pointed the Prettier and ESLint ignores at `project-docs/`;
  created this file.
- 2026-11-12 — Phase 1 (P1.1–P1.6) and its prerequisites P0.1, P0.3, P0.4 implemented: `@kyc/core`, accounts and
  sessions, stable symbol keys and analysis runs, learning-layer schema, snapshot read authorisation and share links,
  configurable client API and CORS allowlist; migrations 004–008 with rollback scripts; PostgreSQL >= 15. Added
  `08_Brand_Identity_Requirements.md` and `09_Phase_1_Completion_Report.md`.
- 2026-11-12 — Phase 2 (P2.1–P2.4) implemented: retrieval planner over `GraphStore` in core, AI capability registry
  with evidence envelope and migration 009, server-persisted learner positions, branching workspace and the
  Project/Learn/Explore/Validate shell. Phase 1 committed in nine commits. Added `10_Phase_2_Completion_Report.md`.
- 2026-11-12 — Phase 3 (P3.1–P3.7) implemented and committed (not pushed): architecture map, bookmarks and tours,
  assessment history and rubric grading, concept detection and teaching, Express adapter with request flows, flow
  walkthrough, learning paths with lessons, missions and checks; migrations 010–013 with rollback scripts. P0.2 is
  deferred to the tech team. Added `11_Phase_3_Completion_Report.md`.
- 2026-11-12 — Phase 4 implemented and committed (not pushed, not deployed): Tauri desktop shell with OS credential
  storage and build-time API allowlist; Render Blueprint, single-instance worker lock, error reports and 5xx/job
  alerts, backup/restore scripts, migration safety checks; AI evaluation harness and per-user budget reservations
  (migration 014); provider-neutral privacy copy and removal of retired Groq defaults. P4.4 deferred by scope.
  Fixed share-token signature malleability (canonical spelling only). Added `12`–`17` completion reports.
