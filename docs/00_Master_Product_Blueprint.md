# 00 · Master Product Blueprint: Know Your Code

| Version | 1.0 | Status | Entry point to the documentation set · 22 Oct 2026 |
|---|---|---|---|

Read this first. It summarises all 14 documents and links to the source of truth for each decision.

---

## 1. Executive summary
**Know Your Code (KYC)** is a free browser workspace where a CS student pastes a public GitHub repository URL, selects any line of their own JavaScript/TypeScript code, and gets a plain-language explanation. Alongside it, they see the code's callers, callees, and definitions, **computed by static analysis and linked to exact lines**. They can go simpler or deeper, learn the underlying concept using their own code, ask follow-ups, and optionally check themselves.
- **User:** undergraduates whose projects work but who can't fully explain, trace, or modify them.
- **Problem:** working code without a working mental model (hypothesis; evidence plan in `02`).
- **Outcome:** after a session, the student can explain a function, where its inputs come from, what depends on it, and one failure case, without the tool.

## 2. Product thesis (what we must prove)
> **Grounded, verifiable, learner-paced explanations of a student's own code improve independent comprehension more than the student's current tools do.**
Tested by A3 (comparative usefulness) and A4 (learning gain) in `02`, using the rubric in `11` §6.

## 3. Product principles
PP1 Learning before testing · PP2 Codebase context over snippets · PP3 Grounded in actual source · PP4 User controls the path · PP5 Honest uncertainty (Verified vs Explained) · PP6 Progressive disclosure · PP7 Simplicity (Must = needed to test the thesis) · PP8 Independent understanding (no code generation). Decision rules: `01` §5. Design principles DP1–DP9: `06` §B.

## 4. Initial target user
NST CS students (years 2–4) with a JS/TS project on GitHub and an upcoming evaluation, interview, or feature deadline. Expansion order: coding clubs → hackathon participants → other colleges. Segment analysis: `14` §2.

## 5. Core user journey
Paste URL → staged processing → overview (verified facts, starting points) → open file → **select code → explanation + Verified relations** → click a caller → Back → follow-up / simpler / deeper / concept → optional check → feedback → delete (or auto-delete after 7 days). Full spec: `05`.

## 6. MVP scope
**Must:** public GitHub import (JS/TS), staged progress with partial success, deterministic overview, file tree, read-only viewer, selection → kind resolution, grounded streamed explanation, Verified relations + Back/Forward, depth control, follow-ups, concept chips, feedback, deletion/retention, rate limits, spend cap.
**Should (Week 3, pick 1–2):** AI project summary, starting points, Trace this value, local call diagram, Check yourself.
**Excluded:** accounts, private repos, other languages, code generation, whole-repo diagrams, embeddings/vector DB, gamification, payments. Detail: `04`.

## 7. Technical architecture overview
- **Shape:** one TypeScript modular monolith on a **Replit Reserved VM**: Fastify API + in-process job runner + React/Vite SPA; PostgreSQL (with pg_trgm).
- **Repository processing:** GitHub metadata → tarball (one request) → safe extraction and filtering → **ts-morph** (TypeScript compiler API, `allowJs`) → symbols + `imports`/`calls` edges (+ unresolved reasons) → Postgres. Definitions and references computed on demand. Limits: 1,500 analysable files, 300 KB per file, 50 MB tarball.
- **AI workflow:** selection → enclosing symbol → graph-based context pack (≤ ~6k tokens, redacted) → Claude API (fast tier by default) with a structured output schema → **reference verifier** strips any file/line not in the pack → stream to UI → cache.
- **Key ADRs:** monolith (ADR-01), ts-morph over Tree-sitter (ADR-03), no accounts (ADR-04), no vector DB (ADR-05), Reserved VM (ADR-08). Detail: `07`, `08`, `09`, `10`.

## 8. Competitive positioning
Repo-aware AI explanation is **commoditised**: ChatGPT and Claude GitHub connectors, Copilot, Cursor, DeepWiki, Google Code Wiki. Learning modes exist too: ChatGPT Study Mode, Claude Learning style. KYC's differentiation hypothesis is the **combination**: the learner's own repo + relationships computed by analysis and verifiable at a click + learning anchored to the selection + zero setup. **Remaining uncertainty:** whether this beats a student's usual assistant in practice. If E-S2 says no, we change direction (`02` §15). Detail: `03`.

## 9. Brand positioning
**Tagline:** *Understand the code you build.*
**Statement:** For CS students whose projects work but who can't fully explain them, Know Your Code is a code-understanding workspace that teaches from your own repository. Unlike general AI assistants, every relationship it shows is computed from your code and linked to the exact line, and you choose how deep to go.
Tone: patient senior engineer; no hype, no fear framing. Detail: `13`.

## 10. Launch strategy
Research-led launch on campus: interviewees → lab demo tables → coding-club sessions → short demo clips → hackathon communities. Monetisation deferred. Five launch experiments (E-L1–E-L5). Detail: `14`.

## 11. Success metrics
Activation (first complete explanation within 10 min) · time to first explanation · import success · 👍 rate and "Incorrect" rate · 7-day return · cost per session · **learning gain (pre/post rubric)** · **comparative usefulness vs usual assistant** · **independent comprehension without the tool**. Definitions: `01` §11; dashboard: `14` §11.

## 12. Three-week execution plan
| Week | Milestone | Critical dependencies |
|---|---|---|
| 1 Foundation | Deployed skeleton; import → tree → viewer → selection resolves; 12 interviews | T-1 analyser spike; T-2 viewer spike |
| 2 Core learning | Grounded explanations + relations + follow-ups/concepts; eval #1; 8–10 user sessions | Context pack + verifier (T-3) |
| 3 Ship | Fixes, 1–2 Should features, landing, launch, demo kit, deck update | Week-2 evidence |
Capacity is tight (≈ 52 of ≈ 60 person-days planned). Should features are the release valve. Detail: `12`.

## 13. Major risks
| Risk | Mitigation |
|---|---|
| No perceived advantage over Claude/ChatGPT (R-01) | Head-to-head test in W2; sharpen or pivot by decision rules |
| Plausible-but-wrong explanations (R-02) | Grounding rules, verifier, labels, human-scored eval |
| Dynamic JS patterns missed (R-03) | Show unresolved edges honestly; Express heuristic |
| Private repos / privacy barrier (R-05) | Public-only clarity, deletion, samples; measure in E-L1 |
| Team over-scopes (R-09) | MoSCoW; no Should work before Must exit test |
| Deadline mismatch (R-10) | Confirm D-01 now |

## 14. Decisions required before development
| ID | Decision | Default if unresolved |
|---|---|---|
| D-01 | Real Construct 2.0 deadline and checkpoints | Plan as 21 days |
| D-05 | Concrete model IDs and current prices | Choose after T-3 on the eval set |
| D-07 | Which Should features in W3 | Decide at the W2 exit using test evidence |
| D-09 | Express route heuristic | Build only if T-4 passes |
| — | Replit plan with Reserved VM + PostgreSQL available and affordable | Confirm in W1; fallback Render/Fly + managed Postgres |
| — | Who holds each role (PL/FE/BE/AI/DQ) | Assign on Day 1 |
| — | AI provider data-use terms acceptable for students' code | Review before external users |

### Decision register (Phase 1 analysis of the brief)
| Item | Classification |
|---|---|
| Learning-first; optional checks; no gating | **Confirmed decision** (from brief) |
| Public GitHub import; JS/TS initial scope | Brief hypothesis → **decided** (D-02, D-03) |
| Target = CS students, NST first | Brief hypothesis → **decided for launch**, validate A1/A5 |
| "Understand the Code You Build" tagline | Brief hypothesis → **recommended** over alternatives (`13` §3) |
| Three-week timeline | **Assumption** (D-01 open) |
| Differentiation hypotheses A–G (brief §3.2) | Partly commoditised; **sharpened** to verifiable relations + anchored learning (`03`) |
| Pitch deck said Tree-sitter, Python, "ship" | **Contradiction** with these docs → update deck (`99`) |
| Team role assignments | **Missing** → role-based plan |

## 15. Recommended immediate actions (in order)
1. Confirm the deadline and submission format (D-01); re-date `12`.
2. Assign roles; create the GitHub repo and Replit project; deploy a hello-world with `/health`.
3. Send the screener and book 12 problem interviews (`02`).
4. Start spike T-1 (ts-morph on 5 corpus repos) and T-2 (CodeMirror selection) in parallel.
5. Pick and license-check the 10 corpus repos; hand-label C1 and C3.
6. Draft the shared system prompt and context pack; run T-3 on 10 selections.
7. Update the pitch deck: tagline, ts-morph, JS/TS only, honest competitor framing.

## Document map
| # | Document | Owns |
|---|---|---|
| 01 | PRD | Requirements, metrics, risks, decisions (**source of truth**) |
| 02 | User research | Validation plan and decision rules |
| 03 | Competitive analysis | Verified landscape, positioning, research register |
| 04 | MVP scope | MoSCoW, thin slice, exit test |
| 05 | User flow | Steps, states, error catalogue |
| 06 | Design system | Principles, screens, tokens, components |
| 07 | Architecture | Stack, modules, pipelines, security, ADRs |
| 08 | Ingestion & analysis | Filters, limits, symbols, edges, limitations |
| 09 | AI design | Context, prompts, schemas, verification, cost |
| 10 | API & DB | Endpoints, errors, schema, contracts |
| 11 | Tests & evaluation | Software tests, AI eval, learning eval, release criteria |
| 12 | Sprint & deploy | Tasks, dependencies, checklist |
| 13 | Brand | Positioning, messaging, tone, identity |
| 14 | GTM | Segment, channels, experiments, dashboard |
| 99 | Consistency audit | Cross-document checks and open conflicts |
