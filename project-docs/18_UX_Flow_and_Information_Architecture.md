# 18 — UX Flow and Information Architecture

> **Date:** 2026-11-12 · **Branch:** `V1_KYC` · **Status:** implemented in the client (see `19_UX_Implementation_Report.md`). Visual review has not happened yet; it is the next step.
>
> **Inputs:**
>
> - Brand: `08_Brand_Identity_Requirements.md`.
> - Earlier frontend audit: `06_Frontend_and_Product_Experience_Audit.md`.
> - Phase 1–4 completion reports.
> - The client code as it was at `b7ca10b`.

## 1. Who it is for and what they are trying to do

| Persona | Situation | Main job ("When … I want to … so I can …") |
| --- | --- | --- |
| **New joiner** (junior to mid-level developer) | Starting on an unfamiliar codebase | When I join a project, I want a guided route through its code, so I can contribute without asking about everything |
| **Owner-learner** (student or bootcamp graduate; built the code with AI help) | Has a repository they cannot fully explain | When I ship code I did not fully write, I want to understand each part, so I can defend and change it myself |
| **Investigator** (experienced developer) | Has a specific question about the code | When something confuses me, I want to trace it with evidence, so I can trust the answer without reading everything |

All three need the same four things, in this order:

1. **Orient:** what is this?
2. **Learn:** walk me through it.
3. **Investigate:** let me look myself.
4. **Prove:** do I really understand it?

That order is the four modes: Project, Learn, Explore, Validate.

## 2. Audit findings that shaped the design (ranked by user impact)

| # | Problem (before) | Impact | Decision |
| --- | --- | --- | --- |
| 1 | After an import, the user landed in **Explore**, on a file tree beside a copy of the overview. Learning paths, tours and flows were hidden in other modes. | First-run users never see the learning product | Imports land on **Project**. Its first block is a single **recommended next step** |
| 2 | Nothing recommended what to do next. Project mode was a long list of equal-weight sections. | High cognitive load (Hick's law); unclear purpose | One primary action per view. The project page is ordered by the questions the user asks, with an on-page index |
| 3 | Learn mode started as an empty Explore clone. Paths and tours were only reachable through the Project page or a small "Guided tour" button. | The heart of the product was undiscoverable | Learn has a permanent **guide column**: a Learn home (continue, paths, tour), then the active lesson or tour beside the code |
| 4 | Paths, tours and flow walkthroughs were rendered as banners that pushed the code down. | Lesson and code competed for height. The lesson was lost while reading code | The guide becomes a column: lesson on the left, code in the centre, explanation on the right. Below 1280px it stacks above the code with a capped height |
| 5 | The overview was shown in Project mode **and** in Explore's empty state | Repeated information; two places to read the same thing | Only Project has the overview. Explore's empty state is a **start-investigating** panel: entry points, flows and bookmarks |
| 6 | No project switcher. Returning users had to go back to the landing page. | Context loss | The top bar has a **project switcher** (your repositories, open another, delete data, privacy) |
| 7 | Visual language did not follow the brand (light-first, teal primary, purple "explained", no Manrope, fonts never loaded) | Untrustworthy, generic look | Brand tokens implemented (section 6). Dark is the default |
| 8 | Validate was a flat list. Results sat above the checkpoints. Nothing showed progress. | Felt like an exam log, not a checkpoint | Two columns: the checkpoints to try, plus a progress summary with attempt history |
| 9 | Onboarding had a landing page, a URL form, then raw stage names | Users did not know what analysis does or what they would get | A three-step onboarding indicator (Choose, Analyse, Your project). Each stage explains itself; the user is told what they will get |
| 10 | Status was shown by colour (green "verified", purple "explained") | Fails "not by colour alone" | Provenance shown by glyph, word and border style; semantic colours are kept for interface status |

## 3. Information architecture

```
Landing (/)                       product intro · your repositories (returning) · open a repository
└─ Start (/start)                 step 1: choose a repository (URL or sample) · what happens next · privacy
   └─ Processing (/r/:id/processing)  step 2: live analysis stages, each explained · cancel
      └─ Workspace (/r/:id/:mode)     step 3: the project, in four modes under one persistent top bar
         ├─ Project   overview · recommended next step · architecture · request flows · learning paths · concepts · bookmarks
         ├─ Learn     guide column (Learn home → path or tour) · code · explanation
         ├─ Explore   files (or flow walkthrough) · code · explanation
         └─ Validate  checkpoints from what you explained · progress and attempt history
```

- `/r/:id` with no mode opens **Project**. With a `?path=` deep link it opens **Explore** (old share and deep links still work).
- The navigation depth is at most two: mode, then one panel. There are no nested routes inside a mode.

## 4. Navigation model

**Top bar (persistent in the workspace):**

- product name (home);
- project switcher (repository, status flag);
- the four modes, as links with `aria-current`;
- theme toggle.

The desktop shell adds its account bar above the top bar.

**Workspace bar (Learn and Explore):**

- Files button (opens the drawer);
- the trail (back, forward, breadcrumbs);
- mode-specific actions: Explore freely, Return to learning, Guided tour;
- save status;
- Explanation button (opens the bottom sheet on phones).

**Three-pane rule:**

| Column | Holds |
| --- | --- |
| Left | The *guide* (Learn home, path, tour, flow walkthrough), or the file tree when no guide is active. When a guide is shown, files move to a drawer. |
| Centre | Always the code |
| Right | Always the explanation |

So a code reference, wherever it is clicked, opens in the centre and is highlighted the same way.

**Context preservation:**

- Learn and Explore are separate server-saved trails (P2.1). Exploring never moves the learning position.
- "Return to learning" is the primary action in Explore whenever a learning position exists.
- Opening anything from Project (a module file, concept example, bookmark or flow) goes to Explore. Starting a path, a tour or a "where to start" item goes to Learn.

## 5. Journeys implemented

| Journey | Steps in the product |
| --- | --- |
| **A. First run** | Landing explains the product and the four modes, then "Try with your repo" or "Try a sample". Start (step 1) has a URL with instant validation, samples, and "what happens next". Processing (step 2) shows stages with an explanation of each, then opens automatically. Project (step 3) shows the overview plus **one recommended next step**: start the first learning path, or take the guided tour if there are no paths. |
| **B. Returning** | Landing shows "Your repositories" first. The desktop restores the session through its gate. Project's next step becomes "Continue learning at …" when a saved position exists. The project switcher is available everywhere. |
| **C. Learning-first** | Project → path → Learn. The lesson is on the left, the code it cites opens in the centre, and the explanation is on the right. Missions mark a place in the code, checks are graded, and progress is saved. Previous and Next move through items; Close returns to the Learn home. |
| **D. Independent exploration** | Explore: file tree (`/` filters), code, select and press `E`, explanation with verified connections and evidence chips, bookmark. "Return to learning" brings back the exact stop. |
| **E. Validation** | Validate lists every explained stop as a checkpoint. Each one offers a quick question or an answer in your own words, with structured feedback, rubric points and evidence chips. Progress and every attempt are shown alongside. Retry by starting another question; continue by opening the code. |

## 6. Design system

- **Tokens** (`client/src/styles/tokens.css`), in three layers:
  - Primitives `--kyc-*` (fixed brand hex values);
  - Roles (`--kyc-bg`, `--kyc-surface`, `--kyc-surface-raised`, `--kyc-text`, `--kyc-text-muted`, `--kyc-border`, `--kyc-border-control`, `--kyc-focus`, `--kyc-citation`, `--kyc-primary`, and the semantic status roles);
  - Component tokens (`--kyc-button-*`, `--kyc-chip-*`, `--kyc-code-*`, `--kyc-syntax-*`).
  - Light theme: `[data-theme='light']`. Components use roles only.
- **Theme:** dark by default. Light is opt-in from the toggle, and the choice is stored per browser.
- **Type:** fonts are self-hosted from the `@fontsource-variable` packages, so the CSP keeps `font-src 'self'`.

  | Use | Font |
  | --- | --- |
  | Headings | Manrope |
  | Interface text | Inter |
  | Code, paths, citations and eyebrows | JetBrains Mono |

  The scale follows the kit (Proposed): H1 40/44 is reduced to 32/40 inside the app.
- **Spacing and shape:**
  - 4px spacing scale;
  - radii of 6px for controls, 8px for containers, and pills for tags only;
  - no shadows: elevation is surface colour plus a border;
  - the focus ring is 2px Highlighter with a 2px offset on dark, and 2px Ink on light (Highlighter on Paper is 1.5:1, below the 3:1 a focus indicator needs).
- **Colour discipline:**
  - Highlighter is used only for the single primary action, the selected code line and focus.
  - Citation Teal is used only for evidence: file:line chips, paths in relations and step references.
  - Semantic colours are for interface status only.
- **Shared patterns:**

  | Pattern | Description |
  | --- | --- |
  | `PageHeader` | eyebrow, title, lede |
  | `Steps` | onboarding indicator |
  | `EmptyState` | title, one sentence, one action |
  | `ProgressMeter` | text plus bar, with the value always in words |
  | `StatusGlyph` | glyph plus word |
  | `ProvenanceTag` | glyph, word, border style |
  | `LineRefChip` | teal, mono, opens in the viewer |
  | `Section` | Manrope H2 with an anchor id |

## 7. Key interaction decisions and trade-offs

- **One primary action per view.**
  - Mode tabs are not yellow; the active mode is shown by weight and an underline.
  - In Project, only the recommended step is primary. In Learn, only the current item's action is primary. In Explore, only "Return to learning" (when present) or the floating "Explain" is primary.
- **Progressive disclosure:** module files, skipped files, step-by-step and edge cases stay collapsed. The overview leads with the summary and stack. Raw counts are secondary.
- **Recognition over recall:**
  - The empty states list the real starting points instead of saying "pick a file".
  - Keyboard hints (`/`, `E`, `T`, Alt+arrows) are shown where they apply.
- **No new features.** Everything on screen is backed by an existing endpoint:
  - The recommended step uses `paths`, `tour` and the saved position.
  - The project switcher uses `my/snapshots`.
  - Web sign-up is not added: the web app keeps anonymous sessions, and the desktop keeps its sign-in gate.
- **Trade-off:** in Learn, the file tree is a drawer, not a column, because the lesson needs the left column. Files are one click (or `T`) away.
- **Trade-off:** the brand's logo SVGs and icon set are not in the repository and may not be redrawn (08 §D). The product name is set in text, and the interface uses typographic glyphs (✓ ◐ ○ ✕ →) rather than an invented icon set.
