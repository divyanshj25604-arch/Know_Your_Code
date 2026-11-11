# Know Your Code — Phase 1 Completion Report

*2026-11-12 · branch `V1_KYC` (base HEAD `fd6bb41`), uncommitted working tree awaiting review*

**Outcome:** all six Phase 1 tasks (P1.1–P1.6) and their Phase 0 prerequisites (P0.1, P0.3, P0.4) are implemented. They are verified by automated tests against a real PostgreSQL, a migration test on representative legacy data, a dry run on a clone of the development database, a production build, and the deterministic browser E2E suite. Every Phase 1 acceptance criterion is **PASS** (section 13). P0.2 (real-model baseline) was **not** run: it needs approved spend and is not a Phase 1 prerequisite. No billable API calls were made. Nothing was committed, pushed or deployed. Phase 2 has not been started.

## 1. Summary of the work

| Task | What was built |
| --- | --- |
| P0.1 Production-safe config | The bundled server refuses to start without explicit `NODE_ENV=production`. Production rejects a missing or development `COOKIE_SECRET` and `ANALYSIS_MODE=inline`, and upgrades `auto` to `worker`. The startup check fails clearly if the worker script is missing. The bundled build never reads a parent `.env`. `.env.example` lists every variable, guarded by a test. `process.env` was removed from `analysis/runner.ts` |
| P0.3 Test gaps | Tests for `JobRunner.recover`, `POST /events`, `buildContextPack` (direct), and the plain-text AI fallback, written against the unchanged code first |
| P0.4 Transactional imports | `UNIQUE(jobs.snapshot_id)`; atomic snapshot+job creation; reset of failed or expired same-commit snapshots (error cleared, expiry refreshed); a snapshot is never run twice; all content written in one transaction that first removes prior rows; `jobs.last_error` written; failure cleanup logged instead of swallowed; the retention delete re-checks expiry; repository deletion is atomic with its audit row |
| P1.1 `@kyc/core` | New runtime-free package containing the analyser, project setup, types, selection classifier, overview, file filters, redaction and `KycError` (replaces `AppError`). `node:path` was replaced by a ported POSIX module proven identical to Node's. The moved server files were removed (no duplicates); unit tests and fixtures moved with the code. The boundary is enforced by the compiler and a test |
| P1.2 Identity | `owners` renamed to `users` (ids kept). Email+password accounts (scrypt); hashed, expiring, revocable session tokens (cookie for web, bearer for desktop, bound to their transport). In-place upgrade on registration; explicit transactional claim of a browser's anonymous work; register, login, logout, logout-all, me and claim routes; rate limits; client API methods |
| P1.3 Stable keys and runs | Structural, offset-free `symbol_key` computed in core (ordinals by source position, escaped, versioned). An `analysis_runs` history row for every pipeline execution; current-run pointer; a failed re-run keeps the previous good run; interrupted runs are failed on boot; diagnostics stored; keys exposed in the API |
| P1.4 Learning schema | Explanations moved off the snapshot cascade (kept with repository, commit and stable key; snapshot link set to null on retention). Typed feedback foreign keys, with orphans archived rather than deleted. New `learning_progress`, `bookmarks` and `learner_positions` tables. Composite `(repository_id, user_id)` foreign keys forbid cross-user rows. Retention keeps learning history; explanations are re-linked by key after re-analysis; the claim operation merges learning rows |
| P1.5 Snapshot authorisation | Owner-or-share-token on every snapshot read path, including the symbol→snapshot route. Strangers get 404, decided before any status check (no oracle). HMAC share tokens: snapshot-bound, read-only, at most 7 days, revocable per snapshot. Mint and revoke routes. The explain route checks ownership before snapshot status |
| P1.6 API config and CORS | Client `createApiClient({ baseUrl, auth })` with cookie (web default, unchanged) and bearer (desktop) strategies; validated config with readable errors, also checked when Vite starts; share-link support. Server `CORS_ALLOWED_ORIGINS` exact-origin allowlist: never `*`, never credentials, bearer-only, preflight handled. Other foreign origins are refused |

## 2. Files

**Created.**

- `packages/core/`: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `src/index.ts`, `src/errors.ts`, `src/host.d.ts`, `src/analysis/symbolKey.ts`, `src/util/posixPath.ts`, `tests/boundary.test.ts`, `tests/posixPath.test.ts`, `tests/symbolKey.test.ts`.
- `server/src/auth/`: `identity.ts`, `store.ts`, `password.ts`, `tokens.ts`, `claim.ts`, `shareTokens.ts`.
- `server/src/http/`: `authRoutes.ts`, `snapshotAccess.ts`, `validate.ts`.
- `server/src/index/runs.ts`, `server/src/config/build.ts`.
- Migrations `004_job_integrity.sql` … `008_snapshot_shares.sql`, with matching scripts in `server/src/db/rollbacks/`.
- Tests in `server/tests/`: `auth`, `analysis-runs`, `learning-layer`, `snapshot-authz`, `cors`, `migrations`, `import-idempotency`, `runner-recover`, `events`, `context-pack` (all `.test.ts`), plus helpers `device.ts` and `build-worker.ts`.
- Client: `client/src/api/config.ts`, `client/src/api/client.test.ts`, `client/src/vite-env.d.ts`.
- Docs: `project-docs/08_Brand_Identity_Requirements.md` and this report.

**Moved** (`git mv`, history kept).

- `server/src/analysis/{analyse,project,types,overview}.ts` → `packages/core/src/analysis/`.
- `server/src/analysis/resolve.ts` → `packages/core/src/analysis/classify.ts`.
- `server/src/ingestion/filter.ts` → `packages/core/src/files/filter.ts`.
- `server/src/privacy/redact.ts` → `packages/core/src/privacy/redact.ts`.
- `server/tests/{analyse,redact,resolve}.test.ts` → `packages/core/tests/` (`resolve` became `classify.test.ts`).
- `server/tests/fixtures/` and `fixture-loader.ts` → `packages/core/tests/`. The server keeps a one-line re-export.

**Removed:** `server/src/http/owner.ts` (replaced by `auth/identity.ts`) and the `AppError` class (replaced by `KycError` plus the HTTP mapping in `http/errors.ts`).

**Modified:** 64 tracked files (`git status`: 64 modified, 42 new paths, 26 moved or deleted).

- Mechanical `AppError` → `KycError` import changes in `ai/*` and `ingestion/*`.
- Substantive changes in `config/*`, `db/pool.ts`, `http/routes.ts`, `http/aiRoutes.ts`, `http/security.ts`, `index/*`, `jobs/*`, `ai/service.ts` (explanation insert and expired-snapshot guard), `services.ts`, `app.ts`, `server.ts`, `client/src/api/client.ts`, `client/vite.config.ts`, `client/src/pages/Workspace.tsx` (one effect for share links; no visible change) and the contracts.
- Docs: `CLAUDE.md`, `README.md`, `.env.example`, `project-docs/00` (status, risk outcomes, implementation notes) and a pointer line in audits 01–07.

## 3. Architecture changes

`@kyc/contracts` ← `@kyc/core` ← `server`; the client depends only on contracts. The server's `analysis/` now holds only the worker host (`runner.ts`, `worker.ts`). Identity resolution is a service (`IdentityService`) used by every route, in place of `getOwner`. Snapshot access is a single function (`authorizeSnapshotRead`) used by every read path. The import pipeline is split into fetch → analyse → one persistence transaction → optional summary, and the summary can never undo committed content. tsup and the test worker build bundle `@kyc/*` packages.

## 4. Database

| Migration | Change | Reversible |
| --- | --- | --- |
| 004 | `UNIQUE(jobs.snapshot_id)`; stops (does not delete) if duplicates exist | Yes, lossless |
| 005 | `owners`→`users`, `kind/email/password_hash/registered_at` with consistency checks, `user_sessions` | Yes; the script refuses while registered accounts exist (it would erase credentials) |
| 006 | `analysis_runs`, `snapshots.current_analysis_run_id`, `symbols.symbol_key`, run FKs on symbols and edges, `legacy` backfill, md5-based key indexes, FK indexes | Yes; loses run history and keys (both recomputable) |
| 007 | PG ≥ 15 check; explanations get `repository_id/symbol_key/commit_sha` and `snapshot_id ON DELETE SET NULL`; composite deferrable FKs; typed feedback FKs with a generated `target_id`; orphan feedback archived to `feedback_orphans`; `learning_progress`, `bookmarks`, `learner_positions` | Yes; restores the archived orphans; refuses while explanations whose snapshot has expired exist |
| 008 | `snapshots.shares_revoked_at` | Yes |

No irreversible operation runs in any migration; nothing is dropped without being preserved or derivable. Validation evidence:

- `migrations.test.ts`: builds a fresh database at 003, seeds every table, applies 004–008, checks every row, serves the data through the app, rolls back 008→004, compares columns, constraints and indexes for exact equality with 003, then migrates forward again.
- Dry run on a clone of `kyc_dev` with the real migration CLI: all row counts identical before and after (2 users, 1 repository, 2 snapshots, 50 files, 388 symbols, 328 edges, 3 explanations, 2 messages, 3 checks, 13 events, 9 cost rows). The clone was dropped afterwards; `kyc_dev` itself is still at 003 and will migrate on the next `npm run dev`.

## 5. Authentication and authorisation design

- **Resolution order:** `Authorization: Bearer`, then (cross-origin callers: bearer required), then the `kyc_session` cookie, then the signed anonymous `kyc_owner` cookie.
  - A presented bearer token must be valid: there is no silent downgrade to anonymous.
  - A stale session cookie is cleared.
  - An anonymous cookie resolves only to a still-anonymous user.
  - Only identity-requiring routes mint an anonymous user; reads never do.
- **Tokens:** `kyc_st_` + 256 random bits, stored as SHA-256 only, with absolute expiry and per-session or all-session revocation. Each token is bound to its transport (cookie or bearer).
- **Passwords:** scrypt (N=2^15, r=8, p=1), NFKC-normalised, 10–128 characters. Unknown emails are verified against a decoy hash, so timing does not reveal accounts. Wrong-password and unknown-email answers are identical. Rate limits: 20 per IP per hour, 10 per email per hour.
- **Claim:** needs both the account's web session and the browser's signed anonymous cookie. It runs in one transaction with users locked in id order and deferred composite keys, and is idempotent.
- **Snapshots:** owner or share token, otherwise 404. Mutation and AI routes keep the established 403 `NOT_OWNER`.
- **CORS:** exact allowlist, no wildcard, no credentials. Any other `Origin` → 403. A non-web scheme can never count as same-origin (this fixed a pre-existing host-only comparison that let `tauri://localhost` pass as same-origin with a localhost server).
- **Secrets:** no tokens or passwords in logs, responses (except a bearer token, once) or the client bundle (verified by `auth.test.ts` "secrets stay secret" and a scan of `client/dist`).

## 6. Stable symbol identity

`<escaped path>#<kind>:<name>[~n]/…` (see `packages/core/src/analysis/symbolKey.ts`).

- **Built from:** file path plus the chain of enclosing symbols.
- **Never uses:** line numbers, offsets, database ids or visit order.
- **Ordinals:** only for same-kind same-name siblings (overloads, repeated callbacks, same-named locals), ordered by source position.
- **Uniqueness:** guaranteed within a run by construction and enforced by `UNIQUE (analysis_run_id, md5(symbol_key))`.
- **Versioning:** `SYMBOL_KEY_VERSION` and `ANALYSER_VERSION` are recorded on every run.

Known limitations (also pinned by tests):

- Renaming or moving a file or symbol, or changing its kind, changes the key.
- Inserting a same-named sibling before an existing one shifts later ordinals.
- Callback names follow their call site.
- Legacy rows have no key.

## 7. Shared core boundary

`packages/core` may import only `@kyc/contracts`, `ts-morph` and itself. It is compiled with `lib: ES2022, types: []`, so `process`, `Buffer`, `setImmediate` and `node:*` fail to compile. The declared host contract is `setTimeout` and `performance.now` (`src/host.d.ts`). `tests/boundary.test.ts` parses every source file for forbidden imports and globals, and self-tests its own scanner. Both layers were shown to reject a planted violation.

## 8. Test results (final run, 2026-11-12)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (contracts, core src+tests, server, client) | Pass |
| `npm run lint` | Pass |
| `npm run format:check` | **Fails on 1 pre-existing file only**: `server/tests/groq-llm.test.ts` (failed identically at baseline, before any change; not touched by this work) |
| `@kyc/core` tests | 6 files, **116 passed** |
| Server tests (real PostgreSQL 18) | 24 files, **258 passed** |
| Client tests | 5 files, **45 passed** |
| `npm run build` | Pass (client and server; core bundled) |
| `npm run test:e2e` (deterministic, production config, compiled worker) | **18 passed** |

Baseline before any change: 207 server + 24 client tests and 18 E2E, all passing, with the same single format warning (plus `groq.ts`, which Phase 1 had to edit and is now formatted).

Mutation checks were run on key guards: delete-prior-rows, anonymous-cookie-only-anonymous, token transport binding, the snapshot owner predicate, `.env.example` completeness and the core boundary. Each made its tests fail and was then reverted. Two intermittent or ordering failures found during the work were root-caused and fixed: share revocation mixed database and application clocks, and the fake GitHub's failure registrations leaked between tests.

## 9. Security verification

Negative tests cover:

- Cross-user reads on every snapshot path (anonymous, cookie and bearer strangers), the indirect symbol IDOR, and the absence of an existence or state oracle.
- No anonymous identity minted on reads.
- Forged, replayed-after-upgrade and cross-account anonymous cookies; claims without a session, with a bearer token, or with a forged cookie.
- Malformed, unknown, expired and revoked tokens; transport mismatch; rate limits; duplicate emails; weak passwords.
- Tampered, foreign-key, expired, wrong-snapshot and revoked share tokens, and share tokens used for writes.
- Disallowed origins on preflight, reads and writes; look-alike origins; cookies ignored cross-origin; wildcard and invalid CORS configuration.
- Database-level rejection of cross-user learning rows and malformed feedback.
- Logs and stored data free of passwords and tokens.

## 10. Known limitations and unresolved issues

- No sign-in or claim **screens**: P1.2's EDD module list covers the API client only. New UI should follow the brand pass, which needs approval. Acceptance was verified through the API.
- No email verification or password reset (they need an email service). Registration reveals whether an email is registered (409), and is rate-limited.
- Share links have no UI to create them yet (API only). A token carried in the `?share=` query can appear in browser history.
- The repository model is still per user (no shared canonical repository; DB audit F5). Snapshots of the same commit by different users are analysed separately; their keys are identical.
- During a re-analysis a snapshot shows its in-progress stage, and reads answer 409 until the run ends.
- In-memory rate limits and boot-time recovery remain single-instance (T16).
- Real-model behaviour is still unverified (T1, T5; P0.2 not run).

## 11. Deviations from the Engineering Decision Document

- PostgreSQL minimum raised from 14 to **15** (needed for `ON DELETE SET NULL (column)`; PG 14 reaches end of life this month).
- Fixtures and the moved unit tests now live in `packages/core/tests`.
- `resolve.ts` renamed to `classify.ts` while moving (EDD §8 permits renames of files already being changed).
- Reads by strangers return 404 rather than 403.
- The CORS work also tightened the existing same-origin check to reject non-web schemes.
- No `GraphStore` / `FileStore` interfaces were introduced: they belong to P2.4. Persistence stays in `server/src/index/*`.

## 12. Remaining technical debt

- `explanations` has no unique cache key (DB audit F9).
- `llm_calls` patches `max(id)` (F10).
- `AiService` still issues SQL directly (T10).
- Object-method `qualifiedName` doubling (`api.api.get`, T15).
- `SKIP_REASON_TEXT` is exported but unused (pre-existing).
- Learning tables have no API yet (P2.1, P3.4, P3.7 will add them).
- The pre-existing format warning on `groq-llm.test.ts` (a one-command fix, left untouched as unrelated).

## 13. Acceptance criteria

| Criterion (EDD §7 and the authorisation brief) | Evidence | Status |
| --- | --- | --- |
| P1.1 `@kyc/core` builds independently | `tsc -p packages/core/tsconfig.json` with no host typings; own test suite | **PASS** |
| P1.1 No Fastify, `pg` or `process.env` imports | `boundary.test.ts` (AST scan plus scanner self-test); compiler rejection demonstrated | **PASS** |
| P1.1 Existing tests pass | All 207 baseline server tests, 24 client tests and 18 E2E still pass (moved tests included) | **PASS** |
| P1.2 Learner signs in on two devices and sees the same repositories | `auth.test.ts` "two devices, one learner" (second browser plus bearer client; explanation from the second device) | **PASS** (API; no sign-in screen yet) |
| P1.2 Anonymous data can be claimed securely | `auth.test.ts` claim suites; `learning-layer.test.ts` claim merge; negative claim cases | **PASS** |
| P1.3 Re-importing an unchanged commit yields identical keys | `analysis-runs.test.ts` (two importers, same commit); `symbolKey.test.ts` (four fixtures, order independence) | **PASS** |
| P1.3 One commit can be analysed twice without identity corruption | `analysis-runs.test.ts` (two runs, one current row set, identical keys, failed re-run keeps data) | **PASS** |
| P1.4 Deleting a snapshot (retention) keeps learning history | `learning-layer.test.ts` "deletes the code of an expired snapshot but keeps every learning row" | **PASS** |
| P1.4 Feedback has valid typed foreign keys and no orphans | `learning-layer.test.ts` typed feedback suites; `migrations.test.ts` orphan archival | **PASS** |
| P1.5 Another user's snapshot id returns 403 or 404 | `snapshot-authz.test.ts` (404 on all six read paths for three kinds of stranger) | **PASS** |
| P1.5 Authorised access continues to work, tests cover both | Same file (owner and share-token reads); existing API, E2E and AI suites | **PASS** |
| P1.6 Existing web deployment continues to work | 18/18 E2E with the production config; `cors.test.ts` same-origin case; client default unchanged | **PASS** |
| P1.6 API base URL is configurable | `client.test.ts` (`resolveBaseUrl`, `createApiClient`); Vite start-time validation | **PASS** |
| P1.6 An allowed desktop-origin request authenticates with a token | `cors.test.ts` "an allowed desktop origin authenticates with a bearer token" | **PASS** |
| P1.6 Disallowed origins are rejected | `cors.test.ts` "rejects disallowed origins" (including look-alikes) | **PASS** |
| P0.1 Startup fails clearly when misconfigured | `config.test.ts` production-safety cases; bundled build checked manually | **PASS** |
| P0.3 New tests pass | `runner-recover`, `events`, `context-pack`, AI fallback | **PASS** |
| P0.4 A killed import re-runs cleanly; a failed SHA re-import succeeds | `import-idempotency.test.ts` (with mutation check) | **PASS** |
| P0.2 Real-model baseline | Not run: requires approved spend | **BLOCKED** (not a Phase 1 prerequisite) |
