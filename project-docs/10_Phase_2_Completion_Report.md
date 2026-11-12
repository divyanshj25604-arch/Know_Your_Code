# Know Your Code — Phase 2 Completion Report

*2026-11-12 · branch `V1_KYC` · not pushed, not deployed*

**Outcome:** all four Phase 2 tasks (P2.1–P2.4) are implemented, committed and verified with the fake AI provider, real PostgreSQL and the deterministic browser suite. Every acceptance criterion that can be checked without a real model passes. **P2.3 depends on P0.2 (real-model baseline), which has not run:** real-model behaviour of the new capabilities, streaming and token sizing is unverified, and P2.3 is not complete until P0.2 runs (section 4). No billable API calls were made. Phases 3 and 4 and the brand pass have not been started.

## 1. Commits

Phase 1 (committed first, from the tree verified at the end of Phase 1):

| Commit | Message |
| --- | --- |
| `f178b07` | feat(core): extract runtime-free @kyc/core package (P1.1) |
| `7008883` | feat(config): production-safe configuration (P0.1) |
| `d283168` | feat(jobs): transactional, idempotent snapshot writes (P0.3, P0.4) |
| `d1a7b51` | feat(auth): user accounts, token sessions and anonymous upgrade (P1.2) |
| `22e89e9` | feat(analysis): stable symbol keys and analysis-run records (P1.3) |
| `c91089f` | feat(db): learning layer that outlives code snapshots (P1.4) |
| `41b0865` | feat(http): snapshot read authorisation and share links (P1.5) |
| `e9f43c5` | feat(client,http): configurable API base URL, auth strategy and CORS allowlist (P1.6) |
| `c5a0909` | docs: Phase 1 completion report and brand identity requirements |

Files that changed under several tasks (for example `config/env.ts`, `http/routes.ts`) went with their main task. Each commit is a coherent, reviewable unit, but only the tip of each phase was verified as a whole: intermediate commits are not guaranteed to build on their own.

Phase 2:

| Commit | Message |
| --- | --- |
| `2790fb1` | feat(retrieval): graph-based retrieval planner over GraphStore (P2.4) |
| `5d7286a` | feat(ai): capability registry with evidence-carrying envelope (P2.3) |
| `ca8de2b` | feat(server): server-persisted learner position API (P2.1) |
| `af13314` | feat(client): persistent branching workspace and mode-based shell (P2.1, P2.2) |
| `40c65b7` | style(core): format retrieval modules committed unformatted in 2790fb1 |

## 2. What was built

**P2.4 — Retrieval planner over `GraphStore`.**

- `@kyc/core` now holds retrieval: the `GraphStore` interface, `relationsOf` (relation ranking moved out of SQL), `Pack` and `planContext`.
- The server implements `PgGraphStore`; core implements `MemoryGraphStore` over an analysis result.
- **Plans:** intent-specific (`explain`, `followup`, `concept`, `assess`, `flow`). Each is deterministic and bounded by its token budget, and sends a source line at most once (merged ranges; blank-only remainders dropped).
- **Flow plans** follow verified `calls` edges breadth-first for up to four hops, with capped fan-out.
- **Separation of certainty:** every verified relation carries its edge id, and the pack records which edges the model was shown. Pattern and unresolved relations stay labelled as such.
- **Compatibility:** the `explain` plan keeps the previous recipe step for step, and `buildContextPack` is now a thin adapter.

**P2.3 — AI capability registry.**

- **Capabilities:** `explain_selection`, `explain_flow`, `teach_concept`, `follow_up`, `assess`, `grade` and `summarise_project`, each in its own module with a versioned prompt and schema, a normaliser, a fallback and a finaliser.
- **Executor** (shared model loop):
  - budget check and cost ledger;
  - retry with a schema reminder;
  - doubled allowance after a `max_tokens` stop;
  - one strong-model retry after a refusal;
  - thinking-aware `max_tokens` for adaptive-thinking models (risk T5);
  - streaming when the provider supports it (Anthropic adapter), with progress events and first-token latency.
- **`AiService`** is now orchestration only, and all AI SQL moved to `ai/store.ts`.
- **Evidence envelope** (in `@kyc/contracts`): every answer carries claims with evidence. The core verifier keeps a claim `verified` only if it cites an edge the model was actually shown; anything else becomes `explained`.
- **New endpoints:** `POST /flows/explain`, and free-text check answers graded by `grade`.
- **Migration 009** stores capability, version and claims on explanations and messages.
- The ledger row is updated by id, which fixes the old `max(id)` patch (DB audit F10).

**P2.1 — Persistent workspace and learner position.**

- **Server:** `GET /repositories/:id/positions` and `PUT /repositories/:id/positions/:track` over the Phase 1 `learner_positions` table, owner-only.
- **Client:** `useWorkspace` was rebuilt on four pieces:
  - a **branching trail** (`state/trail.ts`): Back then somewhere new adds a branch, and Forward follows the most recent;
  - a shared **query cache** with in-flight de-duplication (`state/queryCache.ts`);
  - an **explanation store** restored from the server by id (`state/explanations.ts`);
  - per-track positions saved to the server, debounced and flushed with `keepalive` on page hide. The UI says "Saving your place…" until the server confirms, then "Place saved".

**P2.2 — Mode-based shell.**

- `/r/:id/:mode` with **Project**, **Learn**, **Explore** and **Validate** over one shared state. `/r/:id` redirects to Explore, so existing links keep working.
- Learn and Explore are separate tracks, so exploring never moves the learning position, and "Return to learning" restores the exact stop.
- Project offers "Continue learning", and its starting points open in Learn. Validate lists explanations from both tracks and checks understanding (multiple choice or free text).
- `ExplanationPanel` was split: `ExplanationSections` and `CheckSection` are reused by the panel and by Validate.
- A hash router is used off http(s) or with `VITE_ROUTER=hash` (desktop-safe).
- The visual design is unchanged: only layout CSS was added for the mode bar and pages, using existing tokens (brand pass still pending).

## 3. Verification (final run, 2026-11-12)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run format:check` | Passed after `40c65b7`, except `server/tests/groq-llm.test.ts`: **pre-existing**, unchanged since baseline |
| `@kyc/core` tests | 7 files, **124 passed** (includes the retrieval fixture suite) |
| Server tests (real PostgreSQL) | 26 files, **273 passed** (includes migrations 004–009 up, down and up again) |
| Client tests | 7 files, **52 passed** |
| `npm run build` | Passed |
| `npm run test:e2e` (deterministic, fake AI) | **22 passed** (the 18 existing tests plus 4 new mode/persistence tests); the new spec also passed 20/20 when repeated 5 times |
| Client bundle secret scan | Clean |
| Live E2E / real model | **Not run** (needs approved spend, P0.2) |

## 4. Acceptance criteria

| Criterion (EDD §7) | Evidence | Status |
| --- | --- | --- |
| P2.1 Explore then Return to learning restores the exact prior step after reload | `e2e/modes.spec.ts` "explore, reload, then Return to learning…"; `server/tests/positions.test.ts` | **PASS** |
| P2.1 No forward-trail loss | `client/src/state/trail.test.ts`; `e2e/modes.spec.ts` "going back and somewhere new keeps the forward trail, also after a reload" | **PASS** |
| P2.1 Position consistent across devices | `positions.test.ts` (second device via bearer token) | **PASS** |
| P2.2 Project, Learn, Explore and Validate reachable | `e2e/modes.spec.ts` "all four modes are reachable" | **PASS** |
| P2.2 Panel parts reused in two places | `ExplanationSections` and `CheckSection` used in `ExplanationPanel` and `ValidateMode`; `e2e/modes.spec.ts` Validate test | **PASS** |
| P2.3 The existing five flows run through the registry | `server/tests/capabilities.test.ts` (capability and version recorded per answer) | **PASS** (fake provider) |
| P2.3 Claims marked verified must cite an edge | `capabilities.test.ts` (forged edge downgraded; every stored claim checked) | **PASS** (fake provider) |
| P2.3 `ai.test.ts` passes | 273/273 server tests | **PASS**, with one deliberate contract change (section 6) |
| P2.3 Real-model behaviour (schema-failure rates, streaming, token sizing, refusals) | Requires P0.2 | **BLOCKED** (approved spend) |
| P2.4 Same selection gives the same pack | `packages/core/tests/retrieval.test.ts` (four intents, two stores) | **PASS** |
| P2.4 A 3-hop plan stays within budget | `retrieval.test.ts` (2,000 and 250 tokens) and the all-budgets sweep | **PASS** |
| P2.4 A retrieval fixture suite passes | `retrieval.test.ts` (8 cases); `server/tests/context-pack.test.ts` | **PASS** |

## 5. Bugs found and fixed during Phase 2

- **Save status claimed "saved" before the server had the position**, and a quick reload lost the last step. The status is now honest, and pending saves are flushed with `keepalive`.
- **A deep-link stop added during restore was treated as already saved.** The baseline is now the server's state.
- **Two races in the new E2E spec:** the tree was used before the mode view swapped.
- **My own P2.4 commit was unformatted**; fixed in `40c65b7`.

## 6. Deliberate contract changes

- **Free-text check answers:** `POST /checks/:id/answer` with `{ text }` previously returned 400 ("not supported yet"). It is now graded by the `grade` capability. `ai.test.ts` was updated to assert the new behaviour (a verdict, plus references checked against the shown code); empty text still returns 400.
- **The SSE `done` event** of explanations, follow-ups and concepts carries an `evidence` summary (capability, version, claims). Event names and order are unchanged.
- **`/r/:id` redirects to `/r/:id/explore`.**
- **`RelationItem.edgeId`** added, and **`SymbolRef.key`** is required.

## 7. Known risks and limitations

- **Unverified real-model behaviour (T1, T5):** the Anthropic streaming adapter is tested only at the wire level with a mocked response; thinking-aware token sizes are estimates.
- **No flow UI:** `explain_flow` is available by API, and the flow explorer is P3.2.
- **Learn mode is a guided trail**, starting from the overview's starting points. There is no curriculum (lessons and missions are P3.7).
- **Validate** covers explanations in this browser's or account's trails; attempt history is still one row per check (P3.5).
- **Saved trail size:** each track keeps up to 200 stops.
- **Cache staleness:** the shared query cache does not expire within a session (snapshot data is immutable per snapshot id).
- **Single instance:** in-memory rate limits and boot recovery (T16).

## 8. Remaining MVP roadmap (unchanged scope)

- **P0.2** real-model baseline: blocks P2.3 completion and P4.3.
- **Phase 3:** P3.1 architecture map, P3.2 flows and flow explorer, P3.3 concepts, P3.4 bookmarks, thread restore and tours, P3.5 assessment history and results, P3.6 walkthrough, P3.7 paths, lessons and missions.
- **Phase 4:** P4.1 desktop shell, P4.2 deployment and operations, P4.3 real-model evaluation and per-user budget, P4.4 entropy redaction, P4.5 Groq.
- **Brand implementation pass:** `08_Brand_Identity_Requirements.md` section E.

**External approvals needed:** spend for P0.2 and P4.3; brand assets (logos, fonts) from the brand team; deployment target for P4.2.

The MVP is **not** complete.
