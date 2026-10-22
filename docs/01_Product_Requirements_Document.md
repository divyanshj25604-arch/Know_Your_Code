# 01 · Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Product | Know Your Code (KYC) |
| Team | Destruct · NST, Rishihood University, Sonipat |
| Version | 1.0 |
| Status | Draft for team review. This document is the **source of truth** for requirements. |
| Last updated | 22 Oct 2026 |
| Owners (roles) | Product lead (approves changes), Tech lead (feasibility sign-off) |

**Purpose.** Define what Know Your Code must do, for whom, and how we will know it works.

**Scope.** This document covers the MVP built for Construct 2.0 and the decisions that shape it. Architecture lives in `07`, experience in `05`/`06`, scope trade-offs in `04`. Those documents implement this one. They must not redefine it.

---

## 1. Executive summary

**What it is.** Know Your Code is a browser workspace. A student pastes a public GitHub repository URL, browses the real code, selects any function or expression, and gets an explanation grounded in that repository. Every explanation shows where values come from, what calls the code, and what it calls. Each of those links is computed by static analysis, not guessed by an AI. The student can then ask follow-ups, request a simpler or deeper version, learn the underlying concept using their own code as the example, and, if they choose, check their understanding.

**Problem.** Students increasingly ship projects whose code they cannot fully explain, trace, or safely modify. This happens because of AI assistance, tutorials, and teammates writing parts they never read. This is a **hypothesis under validation** (§2.5). External evidence suggests it is plausible, but we have not yet measured it in our users.

**Primary user.** An undergraduate CS student with a working JavaScript/TypeScript project (personal, course, or hackathon) who cannot confidently explain how its parts connect.

**Value proposition.** *Understand the code you build.* KYC turns your own repository into an interactive lesson. Explanations are anchored to your files and lines, and relationships are verified by code analysis.

**MVP (one sentence).** Public GitHub import (JS/TS) → file tree and code viewer → select code → grounded explanation with verified definitions, callers, and callees → follow-up, simpler/deeper, and concept intents → optional understanding check → feedback, with no accounts.

---

## 2. Problem definition

### 2.1 Problem statement
Students who build software with AI assistants, tutorials, or teammates often have **working code without a working mental model** of it. They struggle to explain it, trace data through it, debug it, or change it without breaking something.

### 2.2 Pain points (hypothesised; validate in `02`)
| ID | Pain point | Moment it hurts |
|---|---|---|
| P1 | Can't explain what a function does or why it exists | Viva, interview, code review |
| P2 | Can't trace where a value (e.g. `req.params.id`) originates | Debugging, modifying |
| P3 | Don't know which files connect to which | Adding a feature, onboarding to a teammate's code |
| P4 | Unfamiliar concepts block comprehension (async/await, middleware, ORM calls) | Reading any non-trivial file |
| P5 | Fear that a change will break something elsewhere | Modifying |

### 2.3 Existing workarounds
Students paste snippets into ChatGPT or Claude, connect repos to general assistants, use IDE assistants (Copilot Chat, Cursor), read generated wikis (DeepWiki, Google Code Wiki), ask the teammate who wrote it, or watch generic tutorials. See `03` for verified capabilities.

### 2.4 Why existing workflows may be insufficient (hypotheses, not claims)
- **H-W1:** General assistants *can* read repositories (ChatGPT and Claude both offer GitHub connectors; see `03`). But their answers arrive as prose in a chat that is separate from the code. Relationships are generated rather than verifiable, which makes it hard for a learner to check claims.
- **H-W2:** Learning modes exist (ChatGPT Study Mode; Claude Learning style) but are not anchored to a code selection inside the user's repository.
- **H-W3:** Repo wikis document the *repository*. They don't teach the *person* or adapt depth to them.
- **H-W4:** IDE assistants are optimised for *producing* code. Many students read code on GitHub or in a browser rather than setting up an agentic IDE for comprehension. *(Unverified; test in `02`.)*

### 2.5 Evidence register
| Type | Evidence | Status |
|---|---|---|
| External research | 84% of developers use or plan to use AI tools; 16.3% say it's hard to understand how or why AI code works; 20% feel less confident in their own problem-solving (Stack Overflow Developer Survey 2025) | Verified. Source: survey.stackoverflow.co/2025 |
| External research | Developers spend ~58% of time on program comprehension; juniors spend more than seniors (Xia et al., IEEE TSE 2018) | Verified. Professional devs, not students. |
| External research | In an RCT, AI-assisted learners scored 17% lower on comprehension. Delegators scored 24–39%; learners who asked conceptual questions scored 65–86% (Anthropic, Jan 2026) | Verified. Narrow task (new library, immediate quiz). |
| User-reported | None collected yet | **Gap.** `02` plan must run before Week 1 ends. |
| Team hypothesis | NST students experience P1–P5 often enough to try a dedicated tool | Unvalidated |

### 2.6 Unvalidated assumptions (ranked by risk)
| ID | Assumption | Validation (see `02`) |
|---|---|---|
| A1 | Target students experience P1–P3 at least monthly | Problem interviews, n ≥ 12 |
| A2 | They will paste a public repo URL into a new tool | Smoke test: import rate on landing page |
| A3 | Grounded, verifiable relationships make explanations more useful than a general assistant's | Head-to-head comparison test (E-S2) |
| A4 | Understanding improves measurably after one session | Pre/post comprehension task |
| A5 | Most target repos are JS/TS and public (or can be made public) | Survey + repo collection |
| A6 | Cost per session is sustainable on free usage | Cost telemetry in Week 2 |

---

## 3. Product vision

- **Vision.** Anyone who works with code can understand it well enough to reason about it and change it independently.
- **Mission (MVP horizon).** Help CS students understand the projects they built, starting with JS/TS on GitHub.
- **Core value proposition.** Your repository becomes the textbook: explanations anchored to your lines, relationships you can verify, and concepts taught through your own code.
- **Positioning.** For CS students whose projects work but who can't fully explain them, KYC is a code-understanding workspace that teaches from your own repository. Unlike general AI assistants, every relationship it shows is computed from your code and linked to the exact line, and learning stays in your hands. (Positioning rationale: `13`.)
- **Intended outcome.** After a session, the user can explain a selected function, name where its inputs come from and what depends on it, and reason about one failure case without help.

---

## 4. Target audience

### 4.1 Primary persona: "The Builder Who Can't Explain"
- **Who:** 2nd–4th-year CS undergraduate, 19–22, at NST or a similar programme. Has 1–3 JS/TS projects on GitHub (MERN/Next.js/Express typical), built with Copilot, Cursor, Claude, ChatGPT, tutorials, or teammates.
- **Context:** Upcoming project evaluation, internship interview, or a feature to add before a deadline.
- **Jobs to be done:**
  - *When* I'm asked how part of my project works, *I want to* understand it well enough to explain it in my own words, *so that* I'm confident and honest about my work.
  - *When* I need to change a feature, *I want to* see what it touches, *so that* I don't break something else.
  - *When* I meet an unfamiliar concept in my code, *I want to* learn it through the code in front of me, *so that* it sticks.
- **Desired outcomes:** explain, trace, modify, and debug independently.
- **Adoption barriers:** privacy worries about pasting code; "ChatGPT already does this"; private repositories; non-JS/TS stacks; low trust in AI accuracy.

### 4.2 Secondary personas (not MVP targets; segment analysis in `14` §2)
- **Team member inheriting a teammate's code.** Same workflow, different motivation. Likely served by the MVP without extra features.
- **Beginner learning through projects.** Needs simpler explanations. Served by the depth controls.
- **Open-source first-time contributor.** Larger repos; deferred until the repo-size limits are proven.
- **Junior developer onboarding at work.** Needs private repos and security review. Deferred.

---

## 5. Product principles (operational decision rules)

| # | Principle | Decision rule | Example |
|---|---|---|---|
| PP1 | **Learning before testing** | No screen may require answering a question before showing an explanation. Checks only start from an explicit user action. | "Check yourself" is a button, never a gate. |
| PP2 | **Codebase context over isolated snippets** | Every explanation request must include at least the enclosing symbol and its resolved relations when they exist. If none exist, the UI says so. | Explaining `getUserById` includes its callers. |
| PP3 | **Grounded in actual source** | Any file/line the AI mentions must exist in the snapshot. Unverifiable references are stripped and flagged (see `09` §10). | A link to `auth.js:42` only renders if that line exists. |
| PP4 | **User controls the learning path** | The user chooses depth, next topic, and whether to check. The system may *suggest* next steps; it never auto-advances. | "Explore next" chips are optional. |
| PP5 | **Honest uncertainty** | Facts from static analysis are labelled *Verified*. AI interpretations are labelled *Explained*. Unknowns say "Can't determine from code" and give the reason. | Dynamic `require(variable)` shows as unresolved. |
| PP6 | **Progressive disclosure** | Default explanation ≤ ~150 words plus relations. Depth, steps, and concepts are opt-in expansions. | Short summary first; "Go deeper" second. |
| PP7 | **Simplicity over features** | A feature enters the MVP only if it is needed to prove A3 or A4 (§2.6). | Accounts excluded. |
| PP8 | **Independent understanding over passive consumption** | Each explanation ends with one optional "Try explaining…" or "Predict…" prompt. The product never generates code for the user to paste in the MVP. | No "fix it for me" button. |

---

## 6. Functional requirements

Priority: **M** = Must, **S** = Should, **C** = Could (rationale in `04`). Flow-step references point to `05`.

### 6.1 Repository import
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-IMP-01 | Accept a public GitHub URL (`github.com/{owner}/{repo}` with optional `/tree/{ref}`) | Zero-setup start | M | Valid URLs accepted. Invalid URL, non-GitHub host, or private/missing repo each show a distinct, specific message within 3 s. | — | 3–4 |
| FR-IMP-02 | Resolve default branch and commit SHA; index that snapshot | Stable, cacheable view | M | Snapshot records the commit SHA. Re-importing the same SHA reuses the existing index. | FR-IMP-01 | 4 |
| FR-IMP-03 | Enforce size limits (see `08` §3) | Reliability, cost | M | Over-limit repos are rejected before parsing, with the limit and the reason shown. | FR-IMP-02 | 4 |
| FR-IMP-04 | Show processing progress by stage | Trust while waiting | M | UI shows stages (Fetching → Filtering → Analysing → Summarising) with live status. Failure names the stage. | FR-IMP-02 | 5–6 |
| FR-IMP-05 | Partial success: index what parses; list skipped files with reasons | Usable despite odd files | M | A repo with one unparseable file still opens. The skipped list is visible in the overview. | FR-ANL | 6 |

### 6.2 Repository overview
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-OVR-01 | Deterministic facts: languages, file counts, frameworks detected from `package.json`, entry points | Orientation without AI risk | M | Every fact is derived from files and labelled *Verified*. | FR-IMP | 7 |
| FR-OVR-02 | AI-written project summary (what the app does; main modules) with file links | Mental map | S | ≤ 200 words. Every file link resolves. A "Why do we think this?" toggle lists the files used. | FR-OVR-01, AI | 7 |
| FR-OVR-03 | "Suggested starting points" (entry file, route files, most-referenced symbols) | Where to begin | S | ≥ 3 suggestions, each opening the correct file and line. Computed from graph degree, not AI. | FR-ANL-03 | 7 |

### 6.3 Navigation and viewing
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-NAV-01 | File tree with search by filename | Find files | M | Opens any file in ≤ 2 clicks. Filter narrows the tree as you type. | FR-IMP | 8 |
| FR-NAV-02 | Read-only syntax-highlighted viewer with line numbers | Read real code | M | JS/TS/JSX/TSX highlight correctly. Files up to the viewing limit render without freezing (`08` §3). | FR-NAV-01 | 8 |
| FR-NAV-03 | Deep links to `file:line` | Shareable context, AI links | M | Opening a link scrolls to the line and highlights it. | FR-NAV-02 | 8, 11 |

### 6.4 Selection and contextual explanation
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-SEL-01 | Select any text range, or click an identifier, to open "Explain" | Ask about exactly what confuses you | M | Mouse drag, double-click, and keyboard selection (Shift+arrows) all work. An "Explain" affordance appears near the selection and via shortcut. | FR-NAV-02 | 9 |
| FR-SEL-02 | Resolve the selection to a code identity: enclosing symbol, kind (variable, function, call, import, block) | Right explanation type | M | Correct kind for each case in the `11` test corpus. Falls back to "block" when ambiguous. | FR-ANL-02 | 9 |
| FR-EXP-01 | Generate a grounded explanation structured per `06` §F | Understand | M | Streams. Sections adapt to selection kind. All file/line links verified (PP3). | FR-SEL-02, AI | 10 |
| FR-EXP-02 | Show **Verified relations** panel: definition, callers, callees, imports | Trust and navigation | M | Relations come from the graph only. Each is clickable. Unresolved relations show a reason. | FR-ANL-03 | 10–11 |
| FR-EXP-03 | Depth control: Simpler / Default / Deeper | Fits skill level | M | Regenerates at the chosen depth. Depth persists for the session. | FR-EXP-01 | 10 |
| FR-EXP-04 | Label *Verified* vs *Explained* content | Honest uncertainty | M | Every relation and claim in the UI carries the correct label (spot-check in `11`). | FR-EXP-01 | 10 |

### 6.5 Dependency exploration
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-DEP-01 | Navigate to a relation without losing the origin (breadcrumb trail plus Back) | Trace without getting lost | M | Breadcrumb shows the path. Back restores the previous file, scroll position, and explanation. | FR-EXP-02 | 11 |
| FR-DEP-02 | Local call-neighbourhood diagram (1 hop each way) for a function | See connections | S | Rendered from graph data. ≤ 15 nodes. Each node opens code. | FR-ANL-03 | 11 |
| FR-DEP-03 | "Trace this value" for a parameter: show call sites and the argument expression at each | Answer "where does this come from?" | S | Lists each call site with its argument text. Handles destructured params; anything else is marked unresolved. | FR-ANL-03 | 11 |

### 6.6 Follow-up and conceptual learning
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-FUP-01 | Ask follow-up questions in a thread attached to the selection | Clarify | M | Answers use the same grounded context plus a lexical search for terms in the question. Thread persists while the snapshot exists. | FR-EXP-01 | 12 |
| FR-CON-01 | Concept chips extracted from the selection (e.g. "async/await", "Express middleware") | Learn the missing idea | M | 1–4 chips per explanation. Clicking one teaches the concept using *this* code as the example, then links back to the selection. | FR-EXP-01 | 13 |
| FR-CON-02 | "Explore next" suggestions (related symbols or questions) | Guided curiosity | S | 2–3 suggestions. Symbol suggestions come from the graph; question suggestions are AI-generated. | FR-EXP-01 | 12 |

### 6.7 Optional assessment
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-CHK-01 | "Check yourself" generates one question about the current selection: predict output, trace a value, or explain why | Verify understanding when the user wants to | S | Only appears after an explanation and only starts on click. The question is answerable from the shown code. Feedback cites the lines. | FR-EXP-01 | 14 |
| FR-CHK-02 | Free-text "Explain it back" with AI feedback against the grounded explanation | Practise explaining | C | Feedback names one correct point, one gap, and the lines to revisit. Never a score out of 100. | FR-CHK-01 | 14 |

### 6.8 Errors, feedback, deletion
| ID | Requirement | User value | P | Acceptance criteria | Depends | Flow |
|---|---|---|---|---|---|---|
| FR-ERR-01 | Every failure state has a cause and a recovery action (`05` §17) | Recover without confusion | M | All error codes in `10` map to a user message and an action. | All | 17 |
| FR-FBK-01 | Thumbs up/down plus optional reason on each explanation | Measure usefulness; find errors | M | Stored with explanation ID. Reasons include "Incorrect", "Too complex", "Too basic", "Not what I asked". | FR-EXP-01 | 10 |
| FR-DEL-01 | Delete a repository and all derived data on demand; auto-delete after the retention window | Privacy | M | Deletion removes files, symbols, explanations, threads, and checks within 60 s. Auto-delete after 7 days (decision D-08). | FR-IMP | 16 |

### 6.9 Analysis requirements (enable the above; detail in `08`)
| ID | Requirement | P |
|---|---|---|
| FR-ANL-01 | Filter files: include `.js .jsx .ts .tsx .mjs .cjs` for analysis; show other text files read-only; exclude vendored, build, and binary files | M |
| FR-ANL-02 | Extract symbols: functions, methods, classes, variables, imports/exports, with ranges | M |
| FR-ANL-03 | Build the reference graph: definitions, references, calls, imports; record unresolved edges with a reason | M |

---

## 7. Non-functional requirements

Targets are **initial**. Each states its basis and is re-set after the measurements in `11` §5.

| ID | Area | Requirement | Basis |
|---|---|---|---|
| NFR-PERF-01 | Import | ≤ 90 s from submit to workspace for a repo at the limit; ≤ 30 s for a typical student repo (≤ 150 analysable files) | Must finish inside a live demo and a short user test. Validate in spike T-1. |
| NFR-PERF-02 | Explanation | First streamed token p50 ≤ 4 s; complete p90 ≤ 20 s | Streaming keeps users engaged. Model latency is the dominant cost. Re-baseline after measurement. |
| NFR-PERF-03 | Navigation | Opening a file or relation ≤ 500 ms (p90) after the index is loaded | Served from the DB/index with no AI involved. |
| NFR-REL-01 | Availability | Demo-day uptime; health check and restart on failure | Single-instance MVP; see `07` §12 |
| NFR-REL-02 | AI failure | Model timeout or error shows a retry option; verified relations still render | Deterministic layer is independent of the AI |
| NFR-SEC-01 | Security | Treat repository content as untrusted (prompt injection, malicious archives); see `07` §10 | Untrusted input reaches both server and model |
| NFR-PRV-01 | Privacy | Public repos only; no secrets sent to the model (redaction); 7-day retention; delete on demand; disclose the model provider | Students' trust concerns (barrier list, §4.1) |
| NFR-A11Y-01 | Accessibility | WCAG 2.2 AA contrast; full keyboard operation of select → explain → navigate; screen-reader labels on panels | Inclusive by default; keyboard is critical for code tools |
| NFR-USE-01 | Usability | A first-time user reaches a first explanation without instructions in ≤ 3 minutes in a moderated test | This is the activation definition (§11) |
| NFR-MNT-01 | Maintainability | Single TypeScript codebase; typed API contracts shared between client and server; prompts versioned in the repo | Small team; reduces drift |
| NFR-COST-01 | Cost | Track tokens and cost per explanation and per session; cache identical requests; hard daily spend cap | A6; prevents surprise bills |
| NFR-SCL-01 | Scale | Support ~20 concurrent users and ~200 imports per week | Matches launch goals (`14`). Beyond that is out of scope. |

---

## 8. User stories

| ID | Story | Acceptance |
|---|---|---|
| US-01 | As a student, I want to paste my repo link and start immediately, so I don't waste time on setup. | No sign-up. Workspace opens per NFR-PERF-01. |
| US-02 | As a student, I want to select a confusing line and see what it does in my project, so I can explain it. | FR-EXP-01, FR-EXP-02 pass. |
| US-03 | As a student, I want to see where a parameter's value comes from, so I can trace a bug. | FR-DEP-03 lists call sites with arguments. |
| US-04 | As a beginner, I want a simpler explanation without feeling judged, so I can follow along. | "Simpler" works with no penalty or score. |
| US-05 | As a student, I want to learn the concept behind unfamiliar syntax using my own code, so it sticks. | FR-CON-01 example uses the selected code. |
| US-06 | As a student, I want to jump to a caller and come back, so I don't lose my place. | FR-DEP-01 restores state. |
| US-07 | As a student preparing for an evaluation, I want to check myself on a function I just studied, so I know I'm ready. | FR-CHK-01, optional only. |
| US-08 | As a privacy-conscious user, I want to delete my repository's data, so I control my code. | FR-DEL-01. |
| US-09 | As a skeptical user, I want to know which parts are verified versus AI-interpreted, so I can decide what to trust. | FR-EXP-04. |

---

## 9. Primary user journey (summary; full flow in `05`)
Landing → paste URL → validation → processing with stages → overview with verified facts, optional summary, and starting points → open file → select code → explanation and verified relations → navigate to a caller → back → ask a follow-up → open a concept chip → (optional) check yourself → feedback → delete or leave (auto-delete after 7 days).

**Failure and recovery:** invalid URL → inline fix hint; private repo → explain the public-only rule plus a tip to make a copy public or use a sample repo; too large → show limits plus a suggestion to try a sub-project (Could); parse failures → partial index plus skipped list; AI timeout → retry while relations stay visible; rate-limited → queue message plus ETA.

---

## 10. MVP definition

**Included:** FR-IMP-01..05, FR-OVR-01, FR-NAV-01..03, FR-SEL-01..02, FR-EXP-01..04, FR-DEP-01, FR-FUP-01, FR-CON-01, FR-ERR-01, FR-FBK-01, FR-DEL-01, FR-ANL-01..03.
**Included if Week-3 capacity allows (Should):** FR-OVR-02, FR-OVR-03, FR-DEP-02, FR-DEP-03, FR-CON-02, FR-CHK-01.
**Excluded from MVP:** accounts, saved learning history across devices, private repos/OAuth, languages other than JS/TS, code generation or editing, team features, progress dashboards, payments, monorepo sub-project selection.
**Deferred (post-competition, evidence-gated):** Python support, private repos via GitHub App, spaced revision, educator features. Rationale for each: `04`.

---

## 11. Metrics and evaluation

| ID | Metric | Definition / calculation | Why |
|---|---|---|---|
| M-01 | Import success rate | successful snapshots ÷ import attempts with a valid URL | Reliability of the first step |
| M-02 | Activation | % of new anonymous owners who receive ≥ 1 complete explanation within 10 min of first import | Earliest point of real value |
| M-03 | Time to first explanation | median(time first explanation completed − import submitted) | Time-to-value |
| M-04 | Explanation usefulness | 👍 ÷ (👍 + 👎) per explanation; also % rated | Direct quality signal |
| M-05 | Reported error rate | explanations with 👎 reason "Incorrect" ÷ rated explanations | Accuracy risk |
| M-06 | Depth of engagement | median explanations + follow-ups per session (session = activity with gaps < 30 min) | Exploration versus a single look |
| M-07 | Return rate (7-day) | owners active on ≥ 2 distinct days within 7 days of first import ÷ activated owners | Repeat value |
| M-08 | Learning outcome | Mean rubric gain (post − pre) on the comprehension task in moderated tests (`11` §6) | Tests A4 directly |
| M-09 | Comparative usefulness | % of participants preferring KYC over their usual assistant on matched tasks, plus rubric scores for both | Tests A3 |
| M-10 | Independent comprehension | % of participants who correctly explain function, input origin, and one dependency **without the tool** after the session | Core promise |
| M-11 | Cost per session | (input tokens × input rate + output tokens × output rate) summed per session | Sustainability (A6) |
| M-12 | Satisfaction | Post-test: "How disappointed would you be if you could no longer use KYC?" (very / somewhat / not) | Directional product–market signal at small n |

No targets are set for M-08 to M-10 until a baseline exists. Decision thresholds for go/change/stop live in `02` §15.

---

## 12. Risks and assumptions

| ID | Risk | Type | L | I | Mitigation |
|---|---|---|---|---|---|
| R-01 | Users see no advantage over Claude/ChatGPT | Product | H | H | Head-to-head test in Week 2 (E-S2). Sharpen positioning around verifiable relations and pedagogy. |
| R-02 | AI explanations contain plausible errors | AI | H | H | Grounding rules, link verification, *Verified*/*Explained* labels, eval set (`11`) |
| R-03 | Static analysis misses dynamic patterns (Express routing strings, DI, `require(var)`) | Technical | H | M | Show unresolved edges honestly. Add targeted heuristics for Express routes (S). |
| R-04 | Import too slow or memory-heavy for some repos | Technical | M | M | Limits, spike T-1, skip oversized files |
| R-05 | Students won't paste repos (privacy) or repos are private | Adoption | M | H | Public-only clarity, deletion, sample repos, measure via A2 |
| R-06 | Prompt injection in repo files | Security | M | M | Delimiting, instruction hierarchy, output validation (`09` §16) |
| R-07 | Secrets in repos sent to the model | Privacy | M | H | Redaction pass; never send `.env`-like files |
| R-08 | LLM cost or rate limits during demo | Execution | M | H | Caching, daily cap, pre-warmed demo repo, fallback model |
| R-09 | Team spreads effort across too many features | Execution | H | H | MoSCoW in `04`; Should features only after Must features pass acceptance |
| R-10 | Deadline differs from the 3-week assumption | Execution | M | H | D-01: confirm; replan `12` |

---

## 13. Open questions and decision log

| ID | Decision / question | Status | How it gets resolved |
|---|---|---|---|
| D-01 | Actual Construct 2.0 submission deadline and checkpoints | **Open** | Confirm from official guidelines this week; adjust `12` |
| D-02 | Initial language scope: JS + TS (one analyser covers both) | Decided | ADR-03 in `07` |
| D-03 | Public repos only for MVP | Decided | Revisit if > 30% of interviewees can't use a public repo |
| D-04 | No user accounts; anonymous owner cookie | Decided | Revisit if return-rate (M-07) measurement is blocked |
| D-05 | Model provider: Anthropic Claude API, with model IDs set in config | Decided (tentative) | Re-evaluate on cost/latency after spike T-3 |
| D-06 | Tagline: "Understand the code you build." | Decided | `13` comparison; pitch deck must be updated (see `99`) |
| D-07 | Optional checks in MVP? | Should; build in Week 3 if Must features pass | Week-2 review |
| D-08 | Retention window: 7 days | Decided (tentative) | Revisit after privacy questions in interviews |
| D-09 | Express route string mapping heuristic | Open | Spike in Week 1 on 3 corpus repos |
| D-10 | Analytics tool vs. own events table | Decided: own `events` table | Fewer vendors, no third-party trackers |

## Related documents
`00` master blueprint · `02` research · `03` competition · `04` scope · `05` flow · `06` design · `07` architecture · `08` analysis · `09` AI · `10` API/DB · `11` testing · `12` sprint · `13` brand · `14` GTM · `99` consistency audit

## Sources
Stack Overflow Developer Survey 2025 — https://survey.stackoverflow.co/2025/ (accessed 22 Oct 2026) · Xia et al., "Measuring Program Comprehension", IEEE TSE 44 (2018) — https://ink.library.smu.edu.sg/sis_research/3779 · Anthropic, "How AI assistance impacts the formation of coding skills" (29 Jan 2026) — https://www.anthropic.com/research/AI-assistance-coding-skills
