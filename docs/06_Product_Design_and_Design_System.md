# 06 · Product Design and Design System

| Version | 1.0 | Status | Draft; shared contract for product, design, and engineering |
|---|---|---|---|

**Purpose.** Define how Know Your Code should feel and behave, so every screen and future feature follows one philosophy.
**Scope.** Experience philosophy, principles, information architecture, screen specifications, explanation design, visual system, components, and handoff rules. Requirements come from `01`; flows from `05`.

---

## A. Product design philosophy

**The feeling we're aiming for:** *a patient senior engineer sitting beside you, pointing at your own code.* Calm, precise, never condescending, and never in a hurry to hand you the answer.

| Question | Our answer |
|---|---|
| What should it feel like? | A reading room, not a chat app. The code is the centre of attention; the AI is an annotator in the margin. |
| What should users understand at each stage? | Import: *what happens to my code*. Overview: *what this project is made of*. Workspace: *what this line does, and how I know*. |
| How do we minimise overload? | One question at a time: the user's selection. Everything else is collapsed until asked for. |
| How do we present complexity progressively? | Summary → steps → connections → concepts → edge cases, each opened by the user (§G). |
| Beginners vs experts? | The same layout for both; only depth changes. No "Are you a beginner?" questionnaire. Depth is a one-click control that remembers your choice. |
| How do we encourage exploration? | Every explanation ends with clickable next steps from the real code graph (callers, definitions), so curiosity is one click away. |
| How do we prevent passive dependence? | Optional "Predict / Explain it back" prompts; no code generation; explanations point to lines you should read rather than replacing them. |
| How do we preserve agency? | The user chooses what to select, how deep to go, and whether to be checked. Suggestions never auto-play. |
| How do we communicate uncertainty? | Two labels only, **Verified** and **Explained**, plus a plain "Can't tell from the code" when needed. No percentages or confidence scores. |

---

## B. Design principles

### DP1 · Code is the canvas
1. **Name:** Code is the canvas.
2. **Explanation:** The user's source code is always the largest, most stable element on screen.
3. **Why:** Learning transfers when attention stays on the artefact the learner must later explain.
4. **Rules:** viewer ≥ 50% width on desktop; explanations never cover the selected lines; opening a relation navigates the viewer rather than opening a modal.
5. **Correct:** clicking a caller scrolls the viewer to it and highlights the call.
6. **Incorrect:** a chat window where code appears only as pasted blocks.
7. **Trade-off:** less room for long explanations, which pushes us toward concise text.
8. **Evaluate:** in usability tests, users can say which line an explanation refers to without searching.

### DP2 · Show the evidence
1. **Name:** Show the evidence.
2. **Explanation:** Every claim about structure links to the code that proves it.
3. **Why:** Students distrust AI output; verifiable links build earned trust (`03` §4.4).
4. **Rules:** relations come from the graph only and render with a ✓ *Verified* tag; AI text labels file references as links only after verification; no fact without a source location.
5. **Correct:** "Called by `loginRoute` (routes/auth.js:18) ✓".
6. **Incorrect:** "This is probably called by the login route." with no link.
7. **Trade-off:** dynamic code yields fewer relations; we show "unresolved" honestly rather than fill the gap.
8. **Evaluate:** 100% of rendered links resolve (automated check in `11`).

### DP3 · One question at a time
1. **Name:** One question at a time.
2. **Explanation:** The interface responds to the current selection only.
3. **Why:** Novices overload quickly; a focused panel keeps working memory free.
4. **Rules:** a single explanation panel; a new selection replaces the panel (history kept in breadcrumbs); no multiple simultaneous streams.
5. **Correct:** selecting a new function replaces the panel and pushes the old one to history.
6. **Incorrect:** tabs of five open explanations.
7. **Trade-off:** comparing two functions side by side needs Back/Forward.
8. **Evaluate:** observed confusion events about "which explanation is this?" = 0.

### DP4 · Depth on demand
1. **Name:** Depth on demand.
2. **Explanation:** Start short; let the user pull more.
3. **Why:** Serves beginners and experts with one design.
4. **Rules:** default ≤ ~150 words; sections beyond "What it does" collapsed unless relevant; Simpler/Deeper always visible.
5. **Correct:** a 3-sentence summary with "Step by step ▸" collapsed beneath it.
6. **Incorrect:** a 600-word essay on first click.
7. **Trade-off:** experts click once more.
8. **Evaluate:** median scroll depth and expansion rates; complaints of "too long" or "too basic" in feedback reasons.

### DP5 · Learning is invited, never imposed
1. **Name:** Invited, never imposed.
2. **Explanation:** Checks and prompts are optional affordances.
3. **Why:** Product decision PP1; forced quizzes drive users back to answer machines.
4. **Rules:** no gating; "Check yourself" appears after an explanation completes; Skip is always visible; no grades stored or shown as scores.
5. **Correct:** "Want to check yourself? (30 s)" as a secondary button.
6. **Incorrect:** "Answer this question to see the explanation."
7. **Trade-off:** lower check usage; we measure unprompted uptake instead.
8. **Evaluate:** zero screens where an explanation is blocked behind a question (design review checklist).

### DP6 · Honest about uncertainty
1. **Name:** Honest about uncertainty.
2. **Explanation:** Distinguish what the code proves from what the AI interprets.
3. **Why:** Overconfident errors are worse than admitted gaps for learners.
4. **Rules:** two labels (Verified, Explained); "Can't tell from the code because …" phrasing; unresolved relations greyed out with a reason.
5. **Correct:** "`require(pluginName)`: can't resolve; the module name is decided at runtime."
6. **Incorrect:** a fabricated import target.
7. **Trade-off:** some answers feel less complete.
8. **Evaluate:** an "appropriate uncertainty" rubric item in AI evaluation (`11` §4).

### DP7 · Never lose your place
1. **Name:** Never lose your place.
2. **Explanation:** Navigation is reversible and visible.
3. **Why:** Tracing across files is where learners get lost.
4. **Rules:** breadcrumb of visited symbols; Back/Forward (Alt+←/→); restore scroll and selection; the origin stays one click away.
5. **Correct:** a breadcrumb trail `login() › findUser() › prisma.user.findUnique`.
6. **Incorrect:** opening the definition in a new browser tab.
7. **Trade-off:** client state complexity.
8. **Evaluate:** usability task T3 completion without help.

### DP8 · Plain words first, precise words second
1. **Name:** Plain words first.
2. **Explanation:** Lead with plain language, then introduce the technical term.
3. **Why:** Students need both the idea and the vocabulary used in vivas and interviews.
4. **Rules:** first use of a term → plain description + term in bold + concept chip; avoid unexplained acronyms.
5. **Correct:** "It waits for the database to reply (**await**) before continuing."
6. **Incorrect:** "Awaits the promise resolution of the ORM query."
7. **Trade-off:** slightly longer text at default depth.
8. **Evaluate:** "too complex" feedback rate; beginner-comprehension rubric item.

### DP9 · Calm by default
1. **Name:** Calm by default.
2. **Explanation:** Restrained visuals; motion and colour carry meaning only.
3. **Why:** Long reading sessions; code needs visual quiet.
4. **Rules:** one accent colour; no celebratory animations; motion ≤ 200 ms and disabled under `prefers-reduced-motion`.
5. **Correct:** a subtle highlight fade on the navigated line.
6. **Incorrect:** confetti after a check.
7. **Trade-off:** less "delight" in demos; we accept this.
8. **Evaluate:** design review against the token list (§H) — no off-token colours.

---

## C. Information architecture
```
Landing (/)
└─ Import (/start)
   └─ Processing (/r/:snapshotId/processing)
      └─ Workspace (/r/:snapshotId)
         ├─ Overview (default view of workspace, ?view=overview)
         ├─ File view (?path=src/routes/auth.js&line=18)
         │   ├─ Explanation panel (selection-bound)
         │   │   ├─ Verified relations
         │   │   ├─ Explanation sections
         │   │   ├─ Concepts · Explore next
         │   │   ├─ Follow-up thread
         │   │   └─ Check yourself (optional)
         │   └─ Local diagram (Should; toggle inside the relations section)
         └─ Repo menu: Delete my data · About privacy
```
No global nav beyond logo → landing, the repo name, and the repo menu. No settings page in the MVP (the depth preference is stored locally).

---

## D. Core interface specification

| Screen | Purpose | User goal | Hierarchy (top → bottom) | Primary action | Secondary | Feedback | Accessibility | Responsive |
|---|---|---|---|---|---|---|---|---|
| 1 Landing | Explain value in 10 s | Decide to try | Headline → subhead → demo loop → CTA → How it works (3 steps) → Privacy → FAQ | Try with your repo | Try a sample | — | Demo has captions and a pause control | Single column on mobile |
| 2 Import | Start safely | Paste repo | URL field → privacy notes → samples | Analyse repository | Sample repos | Inline validation | Labelled input; errors via `aria-live` | Full width |
| 3 Processing | Build trust while waiting | Know progress | Repo name → stage checklist with counts → tip of the day (how to use selection) | — | Cancel | Stage ticks, counts | Status in `aria-live=polite` | Same |
| 4 Overview | Orientation | Where to start | Verified facts → starting points → AI summary (Explained) → skipped files | Open a starting point | Browse tree | Summary streams | Headings structure | Tree collapses to drawer |
| 5 Workspace | Learn from code | Understand a selection | Tree │ Viewer │ Panel | Explain selection | Navigate relations | Highlight, stream | Full keyboard map (§E) | See §E |
| 6 Explanation panel | Annotate selection | Understand + next step | Selection label → Verified relations → What it does → (collapsed sections) → Concepts → Explore next → Thread → Feedback | Read / expand | Simpler/Deeper, Ask | Streaming caret | Each section a landmark region | Becomes bottom sheet on mobile |
| 7 Dependency view | Trace connections | Follow a relation | Breadcrumb → relation lists (Defined in, Called by, Calls, Imports) → local diagram (Should) | Open relation | Back | Line flash on arrival | Lists navigable by arrows | Lists only on mobile |
| 8 Concept | Fill a gap | Learn the idea here | Concept name → plain explanation → "In your code" (highlighted lines) → optional "spot it" → Back to code | Back to your code | Deeper | — | Highlights also described in text | Same |
| 9 Check (optional) | Self-verify | Am I ready? | Question → options or text box → Submit/Skip → feedback with line links | Submit | Skip | Correct/needs review (text, not colour only) | Radio group semantics | Same |
| 10 Errors/empty | Recover | Fix and continue | Plain cause → what you can do → action button | Action | Help link | — | Focus moves to the message | Same |

---

## E. Interactive code workspace

**Layout decision: three panels on desktop, with a collapsible tree.**
- *Why three?* Tree (where am I) + code (what am I reading) + panel (what does it mean) map directly onto the three questions learners ask. A two-panel chat-plus-code layout hides navigation; a single column hides context.
- *Beginner concern:* three panels can overwhelm. Mitigation: the tree auto-collapses after a file is opened (toggle with `T`); the panel is empty until a selection, showing a one-line hint: "Select any code to learn what it does."
- **Widths (desktop ≥ 1280 px):** tree 240 px (collapsible) │ viewer flex ≥ 50% │ panel 400–480 px (resizable). **Tablet 768–1279:** tree as overlay drawer; viewer + panel. **Mobile < 768:** viewer full width; panel as a bottom sheet at 40%/90% heights; reading-focused, with import supported.

**Selection behaviours**
| User selects | Resolved kind | Panel shows first | Relations shown |
|---|---|---|---|
| A variable/identifier | `identifier` | What it holds, where it's assigned | Definition; references (count + list) |
| A function name or body | `function` | What it does, inputs → outputs | Defined in; Called by; Calls |
| A block (multiple statements) | `block` | Step-by-step of the block | Symbols used in block → definitions |
| A function call | `call` | What the called function does, in this call | Callee definition (or "external: express"); argument mapping |
| An import | `import` | What is imported and why it's used here | Target module/file; usages in this file |
| A reference to another file's symbol | `reference` | Short summary of the target | "Go to definition" as primary relation |

**Navigating without losing context:** a relation click → viewer jumps → breadcrumb push → panel switches to the target's *relations* (not a new AI explanation, which avoids cost and noise) with an "Explain this" button. Back restores the full previous state.

**Keyboard map:** `E` explain selection/symbol at cursor · `Alt+←/→` back/forward · `T` toggle tree · `/` filter files · `[` / `]` previous/next relation · `S` simpler · `D` deeper · `Esc` close sheet/focus viewer.

---

## F. Explanation design
Canonical section set. **Show only sections with content for the selection kind.**

| # | Section | Shown when | Source |
|---|---|---|---|
| 1 | **What it does** | Always | AI (Explained) |
| 2 | Why it exists (its role in the app) | function, block, import | AI using callers' context |
| 3 | Step by step | block, function > 5 lines (collapsed by default) | AI, line-referenced |
| 4 | **Where inputs come from** | function with params, identifier | Graph (Verified) + AI narration |
| 5 | **What it calls / depends on** | function, block, call | Graph (Verified) |
| 6 | Effect on the rest of the app | function with callers | Graph (callers) + AI |
| 7 | Concepts | Detected concepts (1–4 chips) | AI detection, taught on demand |
| 8 | Edge cases to think about | When the code shows null/undefined checks or async/IO (collapsed) | AI, must cite lines |
| 9 | Explore next | Always (2–3 items) | Graph symbols + AI questions |

Formatting rules: line references as chips (`L18–22`) that highlight on hover; code identifiers in mono; no headings longer than 4 words; ≤ 3 sentences per paragraph at default depth.

---

## G. Progressive learning
Levels the user moves between, with no questionnaire:
1. **Simple:** analogy + plain words; no jargon without a chip. (Depth = Simpler)
2. **Default:** what, why, inputs/outputs, relations.
3. **Step-by-step:** expand section 3.
4. **Deeper technical:** design rationale, edge cases, types. (Depth = Deeper)
5. **Concepts:** chip → concept page anchored on the user's code.
6. **Cross-file:** relations → navigate → explain the target.

The depth choice is remembered per browser. If a user presses Simpler twice in a session, default to Simpler for new explanations and show "Showing simpler explanations · change".

---

## H. Design system

### Visual direction
- **Light and dark themes, following the system setting, with a toggle.** We don't pick dark because "it's code". Many students read in bright labs and on low-quality screens where light themes are more legible; developer preference is split. Both themes meet WCAG 2.2 AA.
- **Character:** neutral slate surfaces; a single **teal** brand accent; semantic colours reserved for meaning (Verified, Explained, error).

### Colour roles (tokens)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #FFFFFF | #0F1419 | Page |
| `--surface-1` | #F6F8FA | #161B22 | Panels |
| `--surface-2` | #EEF1F4 | #1F262E | Hover, inputs |
| `--border` | #D5DBE1 | #30363D | Dividers |
| `--text` | #1B1F24 | #E6EDF3 | Body |
| `--text-muted` | #57606A | #9DA7B1 | Secondary (≥ 4.5:1 on bg) |
| `--accent` | #0F766E | #2DD4BF | Primary actions, focus |
| `--verified` | #1A7F37 + ✓ icon | #3FB950 + ✓ | Verified tag |
| `--explained` | #6639BA + ✦ icon | #A371F7 + ✦ | AI-interpreted tag |
| `--warning` | #9A6700 | #D29922 | Unresolved, limits |
| `--danger` | #CF222E | #F85149 | Errors, delete |
| `--highlight` | rgba(15,118,110,.14) | rgba(45,212,191,.18) | Selected/navigated lines |

Colour is never the only signal: tags always include an icon and a word.

### Typography
- UI: **Inter** (fallback: system-ui, Segoe UI, Roboto). Code: **JetBrains Mono** (fallback: ui-monospace, Menlo, Consolas). Both are open-licensed.
- Scale (rem, 16 px base): 0.75 caption · 0.875 small/UI · 1.0 body · 1.125 panel titles · 1.5 page titles · 2.25 landing hero. Code: 0.875 rem, line height 1.6.
- Line length in the panel: 60–75 characters.

### Spacing, grid, layout
4-px base; tokens `--s1`…`--s8` = 4, 8, 12, 16, 24, 32, 48, 64. Landing: 12-column grid, max width 1200 px. Workspace: full-bleed flex. Radius: 6 px (controls), 10 px (cards/panels). Borders: 1 px `--border`. Surface hierarchy: bg → surface-1 (panels) → surface-2 (interactive); avoid shadows except the bottom sheet and menus.

### Interactive and system states
| State | Rule |
|---|---|
| Hover | Background `--surface-2` |
| Focus | 2 px `--accent` outline, 2 px offset, never removed |
| Active/selected | `--highlight` background + left marker in viewer gutter |
| Disabled | 40% opacity + `aria-disabled`; tooltip explains why |
| Loading | Skeleton blocks for content; streaming caret for AI text; stage list for jobs; no indefinite spinners > 2 s without text |
| Error | Inline message: icon + cause + action; never only a toast |
| Empty | One sentence + one action |

### Accessibility standards
WCAG 2.2 AA; all functionality keyboard-operable; visible focus; `aria-live` for streaming status (polite) and errors (assertive); respects `prefers-reduced-motion` and `prefers-color-scheme`; target size ≥ 24×24 px; code viewer exposes line numbers and selection to assistive technology.

---

## I. Component inventory (MVP)
| Component | Purpose | Inputs / outputs | States | Interaction rules | A11y |
|---|---|---|---|---|---|
| `RepoUrlInput` | Capture URL | value → `onSubmit(url)` | idle, invalid, submitting | Validate on input; Enter submits | Label, error `aria-describedby` |
| `SampleRepoList` | Quick start | samples → `onPick` | default | — | List of buttons |
| `StageProgress` | Job status | stages[] | pending, running, done, failed | Updates via polling | `aria-live` |
| `FileTree` | Navigate | tree, activePath → `onOpen(path)` | collapsed, expanded, filtered | Arrow keys; type-ahead | `role=tree` |
| `CodeViewer` | Read and select | file, highlights → `onSelect(range)` | loading, ready, truncated | Read-only; selection emits a range | Line numbers announced |
| `SelectionAction` | Trigger explain | range → `onExplain` | hidden, visible | Appears near selection; `E` shortcut | Button with label |
| `ExplanationPanel` | Show explanation | explanationStream, relations | empty, streaming, complete, error | Sections collapse/expand | Landmarks per section |
| `RelationList` | Verified relations | relations[] → `onNavigate` | resolved, unresolved | Click navigates; unresolved shows reason | List semantics |
| `ProvenanceTag` | Verified/Explained label | kind | verified, explained | Tooltip explains meaning | Text + icon |
| `LineRefChip` | Link to lines | path, start, end | default, hover | Hover highlights, click navigates | Link text includes file + lines |
| `DepthControl` | Simpler/Default/Deeper | value → `onChange` | 3 states | Persists locally | Radio group |
| `ConceptChip` | Open concept | concept → `onOpen` | default, visited | — | Button |
| `FollowUpThread` | Q&A | messages, `onAsk` | idle, sending, streaming, error | Enter sends; Shift+Enter new line | Log region |
| `CheckCard` (Should) | Optional check | question → `onSubmit/onSkip` | question, submitted, feedback | Skip always visible | Radio/textarea semantics |
| `Breadcrumbs` | Navigation history | history[] → `onJump` | — | Alt+←/→ | `nav` landmark |
| `FeedbackBar` | 👍/👎 + reason | `onRate` | unrated, rated | Reason menu after 👎 | Labelled buttons |
| `ErrorState` | Recover | code → message/action | — | Focus on mount | `role=alert` |
| `LocalCallDiagram` (Should) | 1-hop graph | nodes, edges → `onNavigate` | ready, too-large | ≤ 15 nodes else list | Text alternative = RelationList |

---

## J. Design-to-engineering handoff
- **Naming:** components in PascalCase as above; tokens as CSS custom properties exactly as named; files `components/<Name>/<Name>.tsx`.
- **Layout conventions:** workspace uses CSS grid `grid-template-columns: [tree] auto [viewer] 1fr [panel] minmax(400px, 480px)`; breakpoints 768 / 1280.
- **Interaction contracts:** `CodeViewer.onSelect` emits `{path, startLine, startCol, endLine, endCol}` (1-based lines, 0-based columns), the same shape as the API `Selection` in `10`. Relations navigate via `navigate({path, line})`, which pushes to history.
- **Loading/error handling:** every async component accepts `status: 'idle'|'loading'|'ready'|'error'` and renders the matching state; error codes map to messages from a single `errors.ts` table (copy from `05` §17).
- **Responsive:** panel → bottom sheet below 768 px; tree → drawer below 1280 px.
- **Acceptance per screen:** matches hierarchy (§D), passes keyboard walkthrough (§E map), axe-core shows no serious violations, and both themes pass contrast.

## Assumptions · Risks · Open questions
- Risk: bottom-sheet explanations on mobile may be cramped. Mobile is secondary for the MVP.
- Open: is the local diagram (Should) more helpful than the relation lists for beginners? Test in sessions.
- Open: font loading cost. Self-host subsets.

**Related:** `01` PP1–PP8 · `05` · `09` §6 (explanation schema) · `10` (Selection shape) · `13` §6 (visual identity)
