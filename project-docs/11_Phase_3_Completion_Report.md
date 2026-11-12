# Know Your Code — Phase 3 Completion Report

*2026-11-12 · branch `V1_KYC` · committed, not pushed, not deployed*

**Outcome:** all seven Phase 3 tasks (P3.1–P3.7) are implemented, committed and verified with the fake AI provider, real PostgreSQL and the deterministic browser suite. Every acceptance criterion in EDD §7 passes. The work followed the documented order: P3.4, P3.1, P3.5, P3.3, P3.2, P3.6, P3.7.

**Not verified:**

- **Real-model behaviour of the AI-backed parts:** multi-example concept teaching, rubric grading of free text, and flow narration. This needs **P0.2**, which is **deferred to the tech team** and has not run.
- No billable AI calls were made, and no live-model tests ran.

**Not started:** Phase 4, the brand pass and the local runtime.

## 1. Commits

| Commit | Message |
| --- | --- |
| `55e5406` | feat(learning): bookmarks, thread restore and guided tours (P3.4) |
| `325fde0` | feat(analysis): module detection and architecture map (P3.1) |
| `f5ac7bc` | feat(assessment): attempt history, open questions, rubric grading and results (P3.5) |
| `7ef540b` | feat(concepts): concept detection, repository concept index and multi-example teaching (P3.3) |
| `f7ae868` | feat(flows): Express adapter and request-flow discovery with persisted flows API (P3.2) |
| `8e37f00` | feat(client): flow explorer and step-by-step walkthrough (P3.2, P3.6) |
| `c18dd5e` | feat(learning): learning paths with lessons, missions and knowledge checks (P3.7) |
| `e482a67` | feat(learning): two lessons per learning path (P3.7) |
| `9bee560` | style(e2e): format the Phase 3 spec |
| (this commit) | docs: Phase 3 completion report and roadmap status |

As in earlier phases, each commit is a coherent unit. Only the branch tip was verified as a whole.

## 2. What was built

### P3.4 — Level 4: bookmarks, thread restore, guided tours

**Server:**

- **Bookmarks:** `GET`/`POST /repositories/:id/bookmarks` and `DELETE /bookmarks/:id`, owner only. Saving the same anchor again updates it instead of duplicating it.
- **Tours:** `GET /snapshots/:id/tour` builds up to 8 stops (entry points, then the most-used functions). Each stop carries its stable symbol key.

**Client:**

- A Bookmark button sits in the viewer, and Project mode lists the bookmarks.
- Learn mode has a "Guided tour" bar with Previous and Next. Tour stops go through the learning trail, so the place is saved.

**Fixed:** a deep link was re-pushed on top of a restored trail (a stale ref in the restore effect). Follow-up threads now restore after a reload.

### P3.1 — Level 1: module detection and architecture map

- `detectModules` in core finds:
  - workspace packages (monorepos, from `package.json` workspaces);
  - otherwise, directory modules;
  - module-to-module dependencies, counted from verified import edges.
- **Migration 010:** tables `modules`, `module_files`, `module_dependencies`, and the column `analysis_runs.monorepo`. Written in the content transaction.
- **API:** `GET /snapshots/:id/architecture`.
- **UI:** Project mode shows the map. Every module lists its real files, each opening in the code viewer.

### P3.5 — Level 6: assessment

- **Formats:** choice and open. Open questions carry a rubric (`assess@3`).
- **Grading:** free text is graded point by point against the rubric (`grade@2`). The verdict and score are derived from the points, and references are checked against the code the model was shown.
- **Migration 011:** `assessment_attempts` keeps every answer, and `check_attempts.format` records the format.
- **API:** `GET /repositories/:id/assessment` returns personal results.
- **Validate mode:** "Explain it in your own words", a rubric checklist, a results section and attempt history (newest first).

### P3.3 — Level 3: concepts

- **Detection:** `detectConcepts` in core tags each function with the concepts its own body shows, as `concept:<id>` symbol tags. Nested functions are attributed to themselves. 26 concepts from the contract vocabulary are detected, among them async/await, try/catch, middleware signatures, React hooks, JSX and destructuring. `ANALYSER_VERSION` is now `core-2`.
- **Concept index:** `GET /snapshots/:id/concepts`. Examples are chosen one per file first, and test files are excluded.
- **Teaching:** `POST /snapshots/:id/concepts/:conceptId/teach` (SSE, owner only) teaches from up to four real examples.
  - The pack comes from the new `planExamples` in core.
  - It runs through the `teach_concept` capability, and the lesson's references are checked against the example lines shown.
  - The result is stored and cached as a `concept` explanation.
- **UI:** Project mode lists the concepts with clickable examples and "Teach me …".

### P3.2 — Level 2: Express adapter and request flows

**Express adapter** (`packages/core/src/analysis/express.ts`, static only). It recognises:

- **Apps and routers:** `express()`, `express.Router()`, `require('express').Router()`, and `Router()` imported from express.
- **Mounts:** `use()` mounts resolved across `require` and `import` to the router a file exports.
- **Middleware:** in registration order, with path prefixes (whole-segment matching).
- **Routes:** route-level middleware, the handler, and `router.route(path).verb(...)` chains.
- **Client calls:** literal `fetch` and `axios` calls. Template URLs become `*` segments; non-literal URLs and methods are recorded as unknown.

**Flow discovery** (`discoverFlows` in core). For each route it builds ordered steps:

- client call(s) matched to the route path;
- route;
- middleware, outermost first;
- handler;
- then verified `calls` edges, depth-first, up to 4 levels deep and 24 steps.

Calls on one line are ordered by evaluation, using the call's end offset (`edges.meta.end`), so in `User.findOne(normalise(email))` the inner `normalise` comes first. The handler's own `res.*` calls are grouped into one `response` step.

**Unknown steps:** anything the analysis cannot follow (external packages, missing declarations, computed members, non-literal paths, unmounted routers, unresolved middleware) becomes an `unknown` step with a plain-language reason. A relationship is never invented.

**Storage (migration 012):** tables `flows` and `flow_steps`, and the column `analysis_runs.flow_count` (null means the run predates flow discovery).

- The database enforces that a `verified` step references its stored call edge (`edge_id`), and that an `unknown` step has a reason.
- Persistence resolves each verified step to its edge id. If the id cannot be found, the step is stored as unknown, never as an unsupported "verified".

**API and UI:**

- `GET /snapshots/:id/flows` and `GET /flows/:id` follow snapshot read access (owner or share link).
- `ANALYSER_VERSION` is now `core-3`.
- Project mode lists the flows: name, step count, handler, matching client calls, and the number of steps not followed.

### P3.6 — Level 5: walkthrough

- A walkthrough banner in Explore mode offers Previous, Next, Play and Pause over a flow's stored steps.
- Each step opens its file and highlights its line in the code viewer (the current step is also marked in the step list).
- **Nothing is executed.**
- **Optional narration** (owner only) runs `explain_flow` from the handler. Narration attaches to a step only through the verified call edge it stands for; the handler step shows the summary. Unknown steps are never narrated as facts.

### P3.7 — Learning paths, lessons and missions

**Content model** (`@kyc/contracts`): paths with items of three kinds:

- **lesson:** text blocks and code blocks that open real code;
- **mission:** find a place in the code, then mark it;
- **knowledge check:** multiple choice.

**Generator** (`buildLearningPaths` in core). It is deterministic and uses no AI. From the architecture map, concept index and flows it builds up to three paths, each with two lessons, a mission and a check:

| Path | Lessons | Mission | Check |
| --- | --- | --- | --- |
| **Project** | Modules; how they depend on each other | Open a file of the most-used module | What a module imports from |
| **Application** | How the request reaches its handler; what the handler does | Find the handler | Which function the handler calls |
| **Concept** | The concept with one example; after the check, a review of every place it appears | Find another use in a different file | Which function uses the concept |

**Grading:**

- Missions are graded against real function ranges (or whole files), and checks against the code graph.
- Both are graded **on the server**, and answers are never sent to the client.
- Item ids come from durable names (module keys, route names, concept ids), so progress carries over to new snapshots of the same repository.

**Progress (migration 013):** `learning_progress` gains the subject kinds `path`, `lesson`, `mission` and `check`, plus an `attempts` count. A completion is never undone by a later wrong answer. The path is recorded complete when all of its items are.

**API:** `GET /snapshots/:id/paths` and `POST /snapshots/:id/paths/:pathId/items/:itemId`, owner only.

**UI:**

- Project mode lists the paths with per-item progress.
- Learn mode plays a path. A mission is answered by clicking a line in the code viewer, then "Mark this place".

## 3. Acceptance criteria (EDD §7)

| Task | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| P3.1 | Modules shown for both fixtures; each node links to files | `server/tests/architecture.test.ts` (express-cjs, react-ts, monorepo); `packages/core/tests/modules.test.ts`; `e2e/phase3.spec.ts` "modules are shown on the project page and each node links to its files" | **PASS** |
| P3.2 | `express-cjs` shows `POST /auth/login` → `login` → `findUserByEmail`; unknown hops labelled | `packages/core/tests/flows.test.ts` (exact step list; every verified step is a real edge; unknown steps have reasons); `server/tests/flows.test.ts` (stored steps reference the right edges; database refuses unlabelled unknowns); E2E "POST /auth/login is walked step by step…" | **PASS** |
| P3.3 | A concept shows at least two real examples from different files | `server/tests/concepts.test.ts` (async-await: `authController.js` and `userService.js`, each example a stored tagged symbol at its real line); `packages/core/tests/concepts.test.ts`; E2E "a concept shows real examples from two files" | **PASS** |
| P3.4 | A thread is restored after reload | E2E "a follow-up thread is restored after reload"; `server/tests/bookmarks-tour.test.ts` | **PASS** |
| P3.5 | Attempts are kept; free text is graded with cited evidence | `server/tests/assessment.test.ts` ("keeps every attempt…", "grades open questions against a rubric, point by point, with evidence"); E2E P3.5 | **PASS** (fake provider) |
| P3.6 | A user steps through a flow with synced code highlighting | E2E: each step opens its file, and the highlighted line (`.cm-kyc-target`) is checked at every step; Play advances, Pause stops | **PASS** |
| P3.7 | A path of lessons with one mission and one check completes and records progress | `server/tests/paths.test.ts` (wrong then right mission, two lessons, wrong then right check, path recorded complete, attempts counted, progress visible from a new snapshot); `packages/core/tests/paths.test.ts`; E2E "a path with a mission, lessons and a knowledge check is completed and recorded" | **PASS** |
| P3.3, P3.5, P3.6 (AI parts) | Real-model behaviour of concept teaching, rubric grading and narration | Requires P0.2 (deferred to the tech team) | **NOT VERIFIED** |

## 4. Verification (final run, 2026-11-12)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run format:check` | Passed except `server/tests/groq-llm.test.ts`: **pre-existing**, unchanged since baseline |
| `@kyc/core` tests | 11 files, **138 passed** |
| Server tests (real PostgreSQL) | 32 files, **289 passed**; includes migrations 004–013 up, down in reverse order to the pre-Phase-1 schema, and up again |
| Client tests | 7 files, **52 passed** |
| `npm run build` | Passed |
| `npm run test:e2e` (deterministic, fake AI) | **30 passed** (22 earlier tests plus 8 Phase 3 tests); the Phase 3 spec also passed 24/24 when repeated 3 times |
| Client bundle secret scan | Clean |
| Live E2E, real model | **Not run** (P0.2 deferred; no billable calls) |

## 5. Database migrations

Every migration is forward-only and has an operator rollback script in `server/src/db/rollbacks/`. All are exercised by `server/tests/migrations.test.ts`.

| Migration | Adds | Rollback loses |
| --- | --- | --- |
| `010_architecture.sql` | `modules`, `module_files`, `module_dependencies`, `analysis_runs.monorepo` | Stored module maps (recomputed by re-importing) |
| `011_assessment_attempts.sql` | `assessment_attempts`, `check_attempts.format`; backfills existing answers as attempts | Attempt history beyond the latest answer |
| `012_flows.sql` | `flows`, `flow_steps` (verified-needs-edge and unknown-needs-reason checks), `analysis_runs.flow_count` | Stored flows (recomputed by re-importing) |
| `013_learning_paths.sql` | `learning_progress` subject kinds `path`, `lesson`, `mission`, `check`; `attempts` | Learning-path progress and attempt counts |

Snapshots analysed before this phase need a re-import to show concepts, flows and paths built from them. Until then the API says so (`available: false` for flows; empty concept index), and the UI explains it.

## 6. New and changed APIs

All are under `/api/v1`.

| Method and path | Access | Task |
| --- | --- | --- |
| `GET /repositories/:id/bookmarks`, `POST /repositories/:id/bookmarks`, `DELETE /bookmarks/:id` | Owner | P3.4 |
| `GET /snapshots/:id/tour` | Snapshot reader | P3.4 |
| `GET /snapshots/:id/architecture` | Snapshot reader | P3.1 |
| `POST /explanations/:id/checks` with `{ format: 'choice' \| 'open' }` | Owner | P3.5 |
| `POST /checks/:id/answer`: free text graded with a rubric (`points`, `score`, verdict `partly`) | Owner | P3.5 |
| `GET /repositories/:id/assessment` | Owner | P3.5 |
| `GET /snapshots/:id/concepts` | Snapshot reader | P3.3 |
| `POST /snapshots/:id/concepts/:conceptId/teach` (SSE: `examples`, `message`, `done`) | Owner | P3.3 |
| `GET /snapshots/:id/flows`, `GET /flows/:id` | Snapshot reader | P3.2 |
| `GET /snapshots/:id/paths`, `POST /snapshots/:id/paths/:pathId/items/:itemId` | Owner | P3.7 |

"Snapshot reader" means the owner or a share-link holder; anyone else gets 404. Narration uses the existing `POST /flows/explain`.

## 7. Known limitations and unresolved issues

**Static analysis (Express only, by decision):**

- **Frameworks:** no Fastify, Koa, Next.js or NestJS adapters.
- **Routes:** regex and array route paths are not matched. `app.use([a, b])` arrays are labelled unknown.
- **Error-handling middleware:** registered after the routes, it is not part of a flow.
- **Client calls:** an axios instance's `baseURL` is not applied, so `api.get('/x')` with `baseURL: '/api'` does not match `/api/x`. Calls with non-literal URLs are recorded but not matched.
- **Call steps:** they follow only resolved `calls` edges. Calls through callbacks, dynamic dispatch, or methods on values whose type is unknown (for example the Mongoose model's `User.findOne`) are shown as unknown steps with a reason, never followed.
- **Branches:** flows show every call in a function in evaluation order. Conditional branches and early returns are not modelled (Audit 02 limitation, unchanged).

**Concepts:**

- Detection is syntactic, from the function's own body (for example a `req, res, next` signature for middleware). It is reported as a recognised pattern, not proof.
- Only 13 concepts have a one-sentence description in path lessons. For the others, the lessons rely on the examples.

**AI-backed parts (unverified without P0.2):**

- Concept teaching from several examples, rubric grading, and flow narration have been checked only with the fake provider.
- Narration uses `explain_flow`'s own 3-hop plan from the handler, so steps not covered by it show no narration (by design, nothing is attached without an edge match).

**Learning paths:**

- **Template-generated:** up to three paths per snapshot, with plain wording. The brand and voice pass is still pending.
- **Computed per request:** paths are not stored. A request reads up to 50 flow details.
- **Renames:** item ids follow names, so renaming a route, module or concept starts that item fresh.
- **Mission granularity:** a mission is graded by location (function range or file), not by understanding; the knowledge check covers understanding.

**Walkthrough and paths UI:**

- The open flow and the open path are kept in page state, so a reload closes them. Path progress itself is saved on the server.
- Play uses a fixed 2.5-second interval.

**Bookmarks and tours:**

- Bookmarks reopen at their stored path and line. Re-anchoring to a moved symbol across commits (by symbol key) is not implemented.
- Tours are limited to 8 stops.

**Carried over from earlier phases:**

- In-memory rate limits and single-instance assumptions (T16).
- The pre-existing format issue in `server/tests/groq-llm.test.ts`.

## 8. Remaining work: Phase 4 and its dependencies

| Task | Depends on | Status |
| --- | --- | --- |
| P4.1 Desktop shell (Tauri), CSP, API URL setting, secure token storage | P1.5, P1.6, P2.2 (done) | Not started; can start now |
| P4.2 Deployment manifest, error tracking, Postgres backups, single-instance guard | P0.1 (done); a chosen deployment target | Not started; needs the deployment target decided |
| P4.3 Real-model evaluation and per-user budget | **P0.2** (deferred to the tech team) | Blocked until P0.2 runs |
| P4.4 Entropy-based secret redaction | None | Not started; can start now |
| P4.5 Groq provider | P2.3 (done); its real-model check needs approved spend | Not started; code can start now, live verification needs approval |

**Agreed sequence:**

1. Phase 4 except work blocked on P0.2 (P4.1, P4.2, P4.4, and the P4.5 code).
2. **P0.2**, run by the tech team.
3. P4.3, and the real-model verification of P2.3, P3.3, P3.5, P3.6 and P4.5.

**Also outstanding:**

- The brand implementation pass (`08_Brand_Identity_Requirements.md` section E), which needs approval and brand assets.
- The local runtime, deferred by decision.

## 9. P0.2 status

**P0.2 remains deferred to the tech team.** It was not run, and no billable AI calls or live-model tests were made in Phase 3.

The MVP is **not** complete.
