# 01 · Implementation Status (V1, as built)

| Field | Value |
|---|---|
| Branch | `V1_KYC` |
| Scope | Requirement-by-requirement status against `01_Product_Requirements_Document.md`, plus how the implementation differs from the design documents |
| Evidence | Test names refer to `server/tests`, `client/src` and `e2e/`. See `04_Testing_and_Measurements.md` for results |

Legend: ✅ implemented and tested · 🟡 partial (what is missing is stated) · ❌ not implemented (deliberately deferred) · ⚠️ implemented but not verified against the real external service.

## 1. Functional requirements

### Import (FR-IMP)
| ID | Status | Notes / evidence |
|---|---|---|
| FR-IMP-01 URL validation, distinct errors | ✅ | Only `github.com/{owner}/{repo}[/tree/{ref}]`; inline hint while typing; server `INVALID_URL` / `REPO_NOT_FOUND_OR_PRIVATE` returned by a fail-fast probe before any job is queued. `ingestion-url.test.ts` (35 cases incl. SSRF variants), `errors.spec.ts` |
| FR-IMP-02 Commit SHA snapshot, reuse | 🟡 | Reuse by `(repository, SHA)` works when the SHA is known: with `GITHUB_TOKEN`, or when a full SHA is given as the ref. Anonymous mode (codeload only) cannot resolve a SHA, so each import creates a new snapshot. A racing double-submit is handled (unique index + reuse) |
| FR-IMP-03 Limits before parsing | ✅ | Streamed byte cap, entry cap, decompression-bomb cap, per-file/total text caps, 1,500 analysable files. With a token, GitHub-reported size is checked first. Verified on real repos: React rejected in 1.2 s, TypeScript in 2.8 s |
| FR-IMP-04 Progress by stage | ✅ | `fetching → filtering → analysing (n/total) → summarising`, polled every 1.5 s; failure names the stage |
| FR-IMP-05 Partial success | ✅ | Files with syntax errors are listed as skipped (`parse_error`), the repo opens as `ready_partial`; `api.test.ts`, `errors.spec.ts` |

### Overview (FR-OVR)
| ID | Status | Notes |
|---|---|---|
| FR-OVR-01 Deterministic facts | ✅ | Languages, frameworks (from `package.json`), entry points, counts; labelled Verified |
| FR-OVR-02 AI summary (Should) | 🟡 ⚠️ | Generated with the strong tier from facts + file headers + README; module paths and links validated against real files; failure is non-fatal. Missing: the "Why do we think this?" toggle. Live model not verified |
| FR-OVR-03 Starting points (Should) | ✅ | Entry points + most-used symbols from graph degree; test/spec/fixture paths excluded |

### Navigation and viewing (FR-NAV)
| ID | Status | Notes |
|---|---|---|
| FR-NAV-01 Tree + filename filter | ✅ | `role=tree`, arrow keys, `/` focuses the filter |
| FR-NAV-02 Read-only highlighted viewer | ✅ | CodeMirror 6; files > 300 KB show the first 2,000 lines with a notice |
| FR-NAV-03 `file:line` deep links | ✅ | `?path=&line=` kept in the URL; survives reload (journey test) |

### Selection and explanation (FR-SEL, FR-EXP)
| ID | Status | Notes |
|---|---|---|
| FR-SEL-01 Select by mouse, double-click, keyboard | ✅ | Floating "Explain" button, `E` shortcut at the cursor |
| FR-SEL-02 Kind resolution | ✅ | function / identifier / block / call / import / reference; multi-declaration blocks flagged; blank/comment-only rejected. `resolve.test.ts`, `api.test.ts` |
| FR-EXP-01 Grounded explanation | ⚠️ | Pack, schema validation, retry, verifier, cache implemented. Sections appear after generation completes (not token-streamed). Real-model quality unverified |
| FR-EXP-02 Verified relations | ✅ | Calls, used-by (calls, values, JSX, route registrations), imports, unresolved with reasons; all clickable |
| FR-EXP-03 Depth control | ✅ | Simpler/Default/Deeper regenerates a linked explanation; remembered per browser |
| FR-EXP-04 Verified vs Explained labels | ✅ | Icon + word, never colour alone |

### Dependency exploration (FR-DEP)
| ID | Status | Notes |
|---|---|---|
| FR-DEP-01 Breadcrumbs + Back/Forward | ✅ | Restores file, highlighted line and the explanation/thread state of that stop; Alt+←/→. Pixel scroll position is not restored (the target line is centred instead) |
| FR-DEP-02 Local call diagram (Should) | ❌ | Deferred. Relation lists are the text alternative the design calls for |
| FR-DEP-03 Trace this value (Should) | ❌ | Deferred |

### Follow-up, concepts, checks (FR-FUP, FR-CON, FR-CHK)
| ID | Status | Notes |
|---|---|---|
| FR-FUP-01 Follow-ups | 🟡 ⚠️ | Same grounded pack + lexical hits + last 4 messages. Threads are stored server-side and `GET /explanations/:id` returns them, but the UI restores them only within the session's trail, not after a page reload |
| FR-CON-01 Concept chips | ✅ ⚠️ | Taught with the selection; `inYourCode` lines verified; cached per (snapshot, symbol, concept) |
| FR-CON-02 Explore next (Should) | 🟡 | AI-suggested questions only; graph-derived symbol suggestions not built (callers/callees are already one click away) |
| FR-CHK-01 Check yourself (Should) | ✅ ⚠️ | Explicit click only, always skippable, never gating; the correct answer never leaves the server until answered; discarded if its answer cannot be tied to shown lines |
| FR-CHK-02 Explain it back (Could) | ❌ | Not built; free-text answers are refused with a clear message |

### Errors, feedback, deletion (FR-ERR, FR-FBK, FR-DEL)
| ID | Status | Notes |
|---|---|---|
| FR-ERR-01 Cause + recovery per failure | ✅ | Single message table from `docs/05 §17` in `packages/contracts`; E2E covers invalid URL, private/missing, rate limit, outage, unsupported language, partial parse, AI failure, unknown snapshot |
| FR-FBK-01 👍/👎 + reason | ✅ | Owner-checked; one vote per target (updates in place) |
| FR-DEL-01 Delete on demand + 7-day retention | ✅ | Cascade delete (149 ms on a real repo after migration 003); hourly retention job with audit log; 90-day trim of cost/event rows |

### Analysis (FR-ANL)
FR-ANL-01 (file filters), FR-ANL-02 (symbols), FR-ANL-03 (reference graph with unresolved reasons) are ✅. Express route
registration is implemented as a *pattern* edge (`provenance: pattern`, labelled "Verified (pattern)").

## 2. Non-functional requirements

| ID | Status | Evidence |
|---|---|---|
| NFR-PERF-01 import ≤ 90 s at limit / ≤ 30 s typical | ✅ (typical) | express 2.6–4.5 s, commander 2.4–3.9 s, ky 5.0–6.9 s end to end on one laptop. A repo *at* the 1,500-file limit was not measured |
| NFR-PERF-02 first token ≤ 4 s p50 | ❌ not measured | Needs the real model; also the UI is not token-streamed |
| NFR-PERF-03 navigation ≤ 500 ms p90 | ✅ | p90 2.3 ms at 20 concurrent clients (loopback, one machine) |
| NFR-REL-02 AI failure never blocks navigation | ✅ | Relations are emitted before any model call; E2E asserts they stay visible |
| NFR-SEC-01 untrusted content | ✅ | See `03_Security_and_Privacy.md` |
| NFR-PRV-01 privacy | ✅ | Public only, redaction, 7-day retention, delete, provider disclosed on landing/start/menu |
| NFR-A11Y-01 | 🟡 | axe-core (WCAG 2.2 AA tags) clean in both themes for landing, start, overview, viewer and panel; keyboard-only journey passes. A manual screen-reader pass was **not** done |
| NFR-USE-01 first explanation ≤ 3 min unaided | ❌ not tested | Needs moderated user sessions (`docs/02`) |
| NFR-MNT-01 | ✅ | One TypeScript codebase, shared Zod contracts, versioned prompts (`PROMPT_VERSION` in cache keys) |
| NFR-COST-01 | ✅ | Per-call ledger (`llm_calls`), cache, daily cap, bounded tokens/timeouts/retries |
| NFR-SCL-01 ~20 concurrent users | 🟡 | 20 concurrent navigation clients tested; 20 concurrent explanations not tested (needs the real model) |

## 3. Deviations from the design documents

| # | Design said | Built | Why |
|---|---|---|---|
| D1 | `pnpm` (07 §12) | npm workspaces | pnpm was not installed; npm avoids global tooling (ADR-11) |
| D2 | GitHub API metadata call for every import | API only with `GITHUB_TOKEN`; otherwise `codeload.github.com` | The anonymous API quota (60/h per IP) was already exhausted in the dev environment (ADR-12) |
| D3 | Worker thread "from Day 1" was an open question | **Implemented** (`analysis/worker.ts`) | Measured: main-thread analysis stalled other API calls up to 1.1 s; with the worker the worst case is 19 ms. Inline fallback kept for dev/tests. (Supersedes ADR-13's initial "no worker") |
| D4 | drizzle-kit migrations | Plain SQL files + a small runner (ADR-14) | Queries are hand-written SQL; no ORM needed |
| D5 | `snapshots.commit_sha char(40)` | nullable `text` + `content_hash` | Anonymous mode cannot know the SHA |
| D6 | Edge types `imports`, `calls`, `route_handler` | plus `references` (migration 002) | "Who uses this function?" must include callbacks, JSX use and exports, not only direct calls |
| D7 | `defines`/`references` computed on demand with a cached ts-morph Project | Relations precomputed into `edges`; selection kind resolved syntactically from the stored file | Fast, no per-request project rebuild; the LRU Project cache was not needed |
| D8 | SSE events `relations`, `meta`, `section`, `delta`, `done`, `error` | `delta` unused; follow-ups/concepts use `message` + `done` | The model returns one validated JSON object, so there are no partial deltas |
| D9 | Unresolved `reason` set of 5 values | adds `callback_parameter` | A call through a function parameter resolves to the parameter, not a runtime target |
| D10 | `POST /explanations/{id}/messages` returns deltas | returns a single `message` event | As D8 |
| D11 | Sentry (optional) | Not integrated | Optional in the design; structured logs only |
| D12 | Seed script with 3 sample repos | 3 public sample repos linked from the Start page (express, commander.js, ky), verified by real imports | No seed data needed: samples are imported on demand |

## 4. API as built (additions to `docs/10`)

`POST /repositories`, `GET /snapshots/:id`, `…/overview`, `…/tree`, `…/file`, `POST …/resolve`, `GET /symbols/:id/relations`,
`POST /explanations` (SSE), `POST /explanations/:id/messages` (SSE), `POST …/checks`, `POST /checks/:id/answer`,
`POST /feedback`, `POST /events`, `DELETE /repositories/:id`, `GET /health` as specified, plus:

- `GET /api/v1/my/snapshots` — the caller's live snapshots (landing "Continue").
- `GET /api/v1/explanations/:id` — an explanation with its thread, for the owner.
- Relations items carry `via: call | reference | route`; `Relations.symbol` carries the symbol's path and range.
- `GET /health` returns **503** when the database is down; `ai` is `configured | not_configured | test_provider`.
- Unsafe methods are refused when `Sec-Fetch-Site: cross-site` or the `Origin` is neither the request host nor `APP_BASE_URL`.

Migrations: `001_init` (docs/10 schema with D5), `002_edge_references`, `003_fk_indexes`.

## 5. What is not verified

1. **The real Claude API.** The client uses the official SDK; request shape, retries, error mapping and timeouts are tested
   against an injected `fetch`. No test used a real key. `npm run test:live` and `smoke.mjs --ai` are provided for the first
   run with a key. The structured-output request (`output_config.format` with a JSON schema, `thinking: disabled` for the Haiku
   tier) follows the current SDK documentation but has not been accepted by the live API in these runs.
2. **Explanation quality** (the `docs/11` human-rated evaluation, M-08…M-10) and any user research. None was run.
3. **Authenticated GitHub mode** (`GITHUB_TOKEN`): covered by unit tests with a mocked `fetch`, not by a live call.
4. **Deployment on Replit** (or any host): not performed; instructions are in `02_Deployment_and_Operations.md`.
