# 17 — Phase 4 Final Completion Report

> **Date:** 2026-11-12 · **Branch:** `V1_KYC`. All Phase 4 work is **committed on `V1_KYC`, not pushed** (commits `c14e6f2`, `87ba7dd`, `a067e9f`, `ca24bcb`, `7d54665` and the documentation commit). Nothing was pushed, published, deployed or released, and no billable AI call was made. Workstream detail: [12](12_Phase_4_1_Completion_Report.md) (desktop), [13](13_Phase_4_2_Completion_Report.md) (deployment), [14](14_Phase_4_3_Completion_Report.md) (evaluation and budget), [15](15_Phase_4_4_Completion_Report.md) (secret detection), [16](16_Phase_4_5_Completion_Report.md) (Groq copy).

## 1. What was implemented

| Workstream | Delivered | Not delivered (why) |
| --- | --- | --- |
| P4.1 Desktop | Tauri 2 shell (`desktop/`): six least-privilege commands; session tokens in the OS credential store; API URL persisted and validated; API origins fixed per build and enforced by CSP, native side and client; release builds never use localhost. Client start-up gate: connect, sign in or register, restore, expiry, sign-out with server revocation. Hash routing. Unsigned macOS `.app` built; signing and release documented | Signed builds (no certificates); Windows build (needs a Windows host); native run against a cloud API (no deployment) |
| P4.2 Deployment and ops | Render selected and justified. `render.yaml` (staging and production, managed Postgres, pre-deploy migrations, health checks, secrets as `sync: false`). Single-instance worker lock with standby and automatic takeover. Fingerprinted, scrubbed error reports; 5xx and job-failure alerts with webhook. Database wait and 503 on outage; migration safety checks and lock timeout. Backup and restore scripts. Smoke test extended to all modes and auth | Staging and production deploys (no Render credentials); live webhook delivery (no URL); Sentry SDK (no documented Fastify 5 support) |
| P4.3 Evaluation and budget | Evaluation harness (11 cases, 7 capabilities, count-based scoring in 10 failure categories, JSON and Markdown reports, regression baseline, gated live CLI). Proposed thresholds. Budget reservations (global cap, per-user cap, per-user call limit; safe under concurrency); per-capability token and cost accounting; `/api/v1/ai/usage`; operator usage report | Live-model evaluation and measured real-model rates (P0.2) |
| P4.4 Secret detection | Scope verified: private repositories are out of MVP scope and import refuses them. Decision and implementation plan documented | Detection itself (deferred by scope) |
| P4.5 Groq copy | Full audit (14 items). Provider name and retention now come from server configuration. Unsupported claims removed ("free", fixed Anthropic naming, "all secrets removed"). Retired Groq default models removed; explicit models and prices required | Live pricing or provider behaviour checks (paid) |

## 2. Architecture changes

- Still one modular monolith and one PostgreSQL. No queue, cache, vector store, embeddings, microservice or ORM was added. `@kyc/core` is unchanged; Phase 4 code lives in `server` (ops, AI budget, eval), `client` (desktop gate, privacy copy), `contracts` (types) and the new `desktop` workspace.
- **Desktop:** the existing client runs in a native window over the cloud API with bearer tokens (P1.6 server support unchanged). There is no local runtime.
- **Jobs:** the in-process runner is kept. A Postgres advisory lock now selects the one process that runs jobs, recovery and retention; other instances serve HTTP in standby.
- **AI:** every model call goes through a budget reservation in the executor. Retrieval and evidence verification are unchanged: bounded, graph-based packs; no full-repository context.
- **Provider facts** reach the UI only through `HealthView.privacy`.

## 3. Database migrations

| Migration | Change | Rollback |
| --- | --- | --- |
| `014_ai_budget.sql` | Table `ai_reservations`; `llm_calls.capability`, `llm_calls.stop_reason`; index `llm_calls_owner_day` | `rollbacks/014_ai_budget.down.sql`, exercised by `migrations.test.ts` (reverse rollback of 004–014 to the pre-Phase-1 schema, then forward again) |

## 4. Dependencies added

- npm: `@tauri-apps/api` 2.12.4 (client) and `@tauri-apps/cli` 2.12.4 (desktop, dev).
- Rust (desktop only): `tauri` 2.12.5, `tauri-build` 2, `keyring` 3.6.3, `url` 2, `serde`, `serde_json`.
- Nothing was added to the server's runtime dependencies.

## 5. Files

**Added:**

- `desktop/**`, `client/src/desktop/*`, `client/src/components/PrivacyFacts.tsx` and its test.
- `server/src/ops/*`, `server/src/ai/usage-cli.ts`, `server/eval/**`.
- `server/src/db/migrations/014_ai_budget.sql` and its rollback.
- `server/tests/budget.test.ts`, `eval.test.ts`, `ops.test.ts`.

Also fixed: the share-token canonical-signature defect (`server/src/auth/shareTokens.ts`, new tests in `snapshot-authz.test.ts`; section 11).
- `e2e/desktop.spec.ts`, `render.yaml`, `scripts/db-backup.sh`, `scripts/db-restore.sh`.
- `project-docs/12`–`17`.

**Modified:**

- Server: `ai/cost.ts`, `ai/executor.ts`, `ai/service.ts`, `app.ts`, `config/env.ts`, `db/migrate.ts`, `http/aiRoutes.ts`, `jobs/importJob.ts`, `jobs/retention.ts`, `jobs/runner.ts`, `server.ts`, `services.ts`, `package.json`, `tsconfig.json`.
- Contracts: `api.ts` (`HealthView.jobs` and `privacy`, `AiUsageView`), `errors.ts` (`USER_BUDGET_EXCEEDED`, neutral messages).
- Client: `App.tsx`, `main.tsx`, `api/client.ts`, `pages/Landing.tsx`, `pages/Start.tsx`, `components/RepoMenu.tsx`, `components/Shell.tsx`, `components/modes/ValidateMode.tsx`, `styles/base.css`, `package.json`.
- Tests (extended only): `server/tests/config.test.ts` (new cases), `migrations.test.ts` (014 added to the rollback order), `harness.ts`, `api.test.ts`, `e2e-server.ts` (truncate `ai_reservations`; desktop test origin).
- Root: `package.json` (desktop workspace, desktop tests in `npm test`), `playwright.config.ts`, `scripts/smoke.mjs`, `.env.example`, `.gitignore`, `.prettierignore`, `eslint.config.js`.
- Docs: `CLAUDE.md`, `00_Engineering_Decision_Document.md`.

No test was weakened or deleted.

## 6. Test results (final run, 2026-11-12)

| Suite | Result |
| --- | --- |
| Core (`@kyc/core`) | 138/138 pass (11 files) |
| Server (real PostgreSQL 18) | 319/319 pass (35 files), including the 2 new share-token tests; `snapshot-authz.test.ts` also passed 8 repeated runs |
| Client | 61/61 pass (9 files) |
| Desktop build configuration (`node --test`) | 6/6 pass |
| Desktop Rust (`cargo test`) | 2/2 pass |
| Browser E2E (deterministic, including `desktop.spec.ts`) | 32/32 pass (30 existing + 2 desktop) |
| Typecheck, lint | Pass, no errors |
| Format check | Clean except `server/tests/groq-llm.test.ts`, the pre-existing issue, deliberately left unchanged |
| Production build (`npm run build`) | Pass (client and server) |
| Desktop release build (macOS `.app`, unsigned) | Pass: `Know Your Code.app`, 4.04 MiB |
| Local production-mode run (built server, `NODE_ENV=production`) | Smoke 14/14; second instance standby, then takeover on SIGTERM; no secrets in logs |
| Backup and restore | Backup verified; restore row counts identical; restore into a non-empty database refused |
| Fake-provider evaluation | 7/11 cases pass, the expected stub limits ([14](14_Phase_4_3_Completion_Report.md) section 2); matches the committed baseline |
| Secret scan of changed files and client bundles | Clean. Changed files: only deliberate fake values in `server/tests/ops.test.ts`. `client/dist` and `client/dist-desktop`: no keys, tokens or secret variable names |

## 7. Deployment status

**Not deployed.** `render.yaml` is ready but has not been applied (no Render account access). The local production-mode run covered:

- start-up, migrations and health;
- import, and all four modes;
- accounts with bearer tokens and revocation;
- the AI usage endpoint;
- the single-instance guard and takeover.

## 8. Desktop build status

- **macOS:** unsigned release build produced (4.0 MiB `.app`); launches and stays running.
- **Signing and notarization:** documented, not performed.
- **Windows:** not built (needs a Windows host); signing documented.

## 9. Security and privacy changes

**Desktop**

- Tokens are kept only in the OS credential store and in memory; never in web storage.
- The CSP restricts `connect-src` to IPC plus the build's API origins and fails closed without them.
- Six granted commands; no plugins.
- Native token shape checks; release builds are https-only.

**Server**

- Error reports scrub tokens, keys, credentials, email addresses and row values.
- No request bodies or code in logs.
- 503 for database outages, without internals.
- `ALERT_WEBHOOK_URL` must be https.
- The eval harness refuses non-test databases.

**AI**

- Per-user and global caps cannot be bypassed concurrently.
- Production refuses placeholder prices for real providers.
- The summary cost is attributed to the importing user.

**Copy**

- No unsupported pricing, "free", provider retention or perfect-redaction claims.
- Provider and retention are taken from configuration.

## 10. AI evaluation status

- **Harness and budget:** complete and tested with the test provider.
- **Real-model status: PENDING P0.2.** No real-model accuracy, grounding, schema, truncation or latency result exists, and none is claimed. The gated command is in [14](14_Phase_4_3_Completion_Report.md) section 4.

## 11. Known limitations

- The desktop native flow has been exercised only by automated browser tests with an IPC stand-in, plus a launch check. An interactive run on each OS is still required.
- The `render.yaml` `envVars` syntax was not confirmed from Render's documentation; the Blueprint editor validates it on creation.
- Alerting runs inside the application, so a full outage does not alert itself. Add an external uptime monitor (documented).
- The fake-provider evaluation fails 4 of 11 cases by design. It says nothing about model quality.
- The desktop bundle identifier and the icon are placeholders: the identifier must be fixed before the first signed release; the icon waits for the brand pass.
- The web client still has no sign-in UI; accounts are created in the desktop app (or via the API).
- PostgreSQL client tools must match the server's major version for backups.
- **Pre-existing defect found and fixed (Phase 1 code):** share-token verification compared *decoded* signature bytes, and base64url decoding ignores the unused low bits of the last character. A token whose last character was changed only in those bits (for example `…A` to `…B`) still verified.
  - **Impact:** malleable, not forgeable (the HMAC was still required).
  - **Symptom:** it made `snapshot-authz.test.ts` "reject tampered…" fail in about 1 run in 64.
  - **Fix** (`server/src/auth/shareTokens.ts`): the signature is compared as its canonical base64url text (constant-time), and expiry and issue times must be in canonical base 36.
  - **Tests:** two new deterministic tests in `snapshot-authz.test.ts`. Every possible last character is tried on a token ending in `A`, and only the issued one verifies; leading-zero timestamps are rejected. Both tests fail on the previous code and pass with the fix.

## 12. Blocked dependencies

| Blocked item | Needs |
| --- | --- |
| Staging and production deployment, managed backups active, live alert delivery | Render account and credentials; an alert webhook URL |
| Desktop login, session, import, modes and logout against the cloud API in the native app | A deployed staging API, then one interactive run per OS |
| Signed macOS and Windows builds; the Windows build | Apple Developer ID and notarization credentials; a Windows code-signing certificate; a Windows build host |
| Live-model evaluation, real-model thresholds, live pricing and provider checks | P0.2 completed by the tech team, an approved API key and an approved budget |
| P4.4 implementation | A product decision to support private repositories |

## 13. Manual steps still required

1. Review the Phase 4 commits on `V1_KYC`; push when instructed.
2. Create the Render Blueprint (staging first). Fill the `sync: false` values, then run `BASE_URL=<staging> npm run smoke`. Check the database Recovery window and send a test alert.
3. Add an external uptime monitor on `/api/v1/health`, and optionally a log stream to a log or error service.
4. Choose the real bundle identifier. Set up the signing credentials in CI, build on macOS and Windows runners, verify the signatures, and run the manual desktop checklist ([12](12_Phase_4_1_Completion_Report.md) section 7) against staging.
5. Tech team: run P0.2, then the live evaluation command. Store its report as the live baseline and agree the thresholds.
6. Production:
   1. Set the provider key, the four model prices and the spend caps.
   2. Deploy from `main` manually.
   3. Schedule `scripts/db-backup.sh` weekly.

## 14. Acceptance criteria (all workstreams)

| ID | Criterion | Status |
| --- | --- | --- |
| P4.1 | Desktop app launches | **PASS** |
| P4.1 | Login works against the cloud backend | **BLOCKED** (no cloud deployment; verified against the local API in the browser E2E) |
| P4.1 | Session persists securely after restart | **BLOCKED** (logic verified; native keychain needs an interactive run) |
| P4.1 | Repository import/open through the cloud workflow | **BLOCKED** (verified against the local API) |
| P4.1 | Project, Learn, Explore, Validate work | **BLOCKED** (verified against the local API) |
| P4.1 | Logout removes the session | **BLOCKED** (server revocation and token deletion call verified; native deletion unobserved) |
| P4.1 | Web application continues working | **PASS** |
| P4.1 | Desktop builds and signing instructions documented | **PASS** |
| P4.1 | Signed builds for macOS and Windows | **BLOCKED** |
| P4.2 | Deployment configuration exists | **PASS** |
| P4.2 | Staging deployed and verified | **BLOCKED** (local production-mode equivalent passed) |
| P4.2 | Backup and restore procedures documented | **PASS** (scripts verified locally) |
| P4.2 | Managed backups active | **BLOCKED** |
| P4.2 | Monitoring and error tracking configured | **PASS** |
| P4.2 | 5xx alerting configured | **PASS** (live webhook delivery BLOCKED) |
| P4.2 | Production deployment instructions documented | **PASS** |
| P4.3 | All seven capabilities have evaluation cases | **PASS** |
| P4.3 | Automated evaluation reports can be generated | **PASS** |
| P4.3 | Budget controls implemented and tested | **PASS** |
| P4.3 | Fake-provider tests pass | **PASS** |
| P4.3 | Live-model evaluation | **BLOCKED** (pending P0.2) |
| P4.3 | No unapproved API spending | **PASS** |
| P4.4 | Scope verified; decision and dependency documented; no unnecessary implementation | **PASS** |
| P4.4 | Detection, redaction of findings, false-positive tests | **NOT DONE** (deferred by scope) |
| P4.5 | Groq-specific claims audited | **PASS** |
| P4.5 | Unsupported claims removed | **PASS** |
| P4.5 | Verified claims accurate and dated | **PASS** |
| P4.5 | Provider-independent architecture intact | **PASS** |
| P4.5 | Live provider pricing and behaviour checks | **BLOCKED** (paid usage) |
