# 19 — UX Implementation Report: Product Experience and Frontend Redesign

> **Date:** 2026-11-12 · **Branch:** `V1_KYC`, uncommitted
>
> **Scope:** the redesign of the client experience and visual system, specified in [18_UX_Flow_and_Information_Architecture.md](18_UX_Flow_and_Information_Architecture.md).
>
> **Unchanged:** the backend, API contracts, AI architecture, routing library, auth and the desktop shell code.
>
> **Visual quality is not verified.** The application has not been run for a visual review. Only the automated checks below were run (unit, E2E, axe, builds). The visual review is the next step, done together.

## 1. Audit findings (before)

Ranked by user impact. Each is detailed, with its decision, in 18 §2.

1. **Imports landed in Explore**, beside a duplicate of the overview. The learning product (paths, tour, flows) was two clicks away and unannounced.
2. **No recommended next action** anywhere. The Project page had seven equal-weight sections.
3. **Learn started as an Explore clone.** Paths and tours could only be started from Project or from a small button.
4. **Guides were banners that pushed the code down.** Lesson, code and explanation competed for height.
5. **The overview was repeated** in Project and in Explore's empty state.
6. **No project switcher.** Switching repositories meant going home.
7. **The brand was not implemented** (08 §C):
   - light-first;
   - teal primary buttons;
   - a purple "explained" colour;
   - no Manrope;
   - fonts never loaded;
   - a GitHub syntax palette.
8. **Validate was a flat list**, with results above the work and no progress indicator.
9. **Onboarding was thin:** no explanation of what analysis does or what the user will get, and no sense of steps.
10. **Status was shown by colour alone** (green, purple), and an invented `{ }` logo glyph was used.
11. **Smaller defects:**
    - the skip link broke under hash routes (desktop), where `#main` became a route;
    - the delete action sat in a generic "Repository menu";
    - weak empty states ("Nothing to check yet" with no way forward).

## 2. UX decisions (summary; rationale in 18)

| Decision | Principle applied |
| --- | --- |
| Imports and `/r/:id` open **Project**. `?path=` deep links still open Explore | Mental model (orient first); recognition over recall |
| **One recommended next step** per project: continue, start the first path, the tour, or explore. It is the only Highlighter button on the page | Hick's law; one primary action per view (brand) |
| **Three-pane rule:** guide or files on the left, code in the centre, explanation on the right, in every code mode | Consistency; Gestalt (common region); context preservation |
| **Learn always has a guide column:** Learn home, then a path or the tour. Files are a drawer (`T`). | Progressive disclosure; the lesson stays beside the code |
| **Explore's empty state** lists real starting points, flows, bookmarks and keyboard keys, instead of repeating the overview | No repeated information; recognition over recall |
| **Project switcher** in the top bar: your repositories, open another, privacy, delete (confirmed in a dialog) | Visibility; error prevention for destructive actions |
| **Validate as checkpoints plus progress**, two columns. The empty state links to Learn. | Feedback loops; clear next action |
| **Onboarding steps:** Choose, Analyse, Your project. Each stage says what it does, and the page says what comes next. | Visibility of system status; reduced anxiety |
| **Confidence by glyph, word and border**, never colour. Status is always shown as a glyph plus a word. | Accessibility; brand rule |
| **The open Learn guide is remembered** per repository in the browser. Progress and position were already server-side. | Journey B (resume immediately) |

## 3. Screens redesigned

| Screen | Changes |
| --- | --- |
| **Landing** (`pages/Landing.tsx`) | Brand tagline and supporting line. "Continue where you left off" project list for returning users. The four modes explained as numbered cards. Privacy card. |
| **Start** (`pages/Start.tsx`) | Onboarding steps, page header, URL card, sample cards, "What happens next" (fetch, filter, static analysis; nothing is run), privacy. |
| **Processing** (`pages/Processing.tsx`, `StageProgress.tsx`) | Onboarding steps. Every stage has a one-line explanation, and a "What you'll see next" card. Cancel and error recovery are unchanged. |
| **Workspace shell** (`pages/Workspace.tsx`) | Top bar with the product name, project switcher, mode tabs and theme toggle. The document title names the repository and mode. A loading state while the snapshot opens. |
| **Project** (`modes/ProjectMode.tsx`, `Overview.tsx`) | The header shows the repository and its stack. A sticky aside holds the recommended step and an on-page index. Sections, in order: overview (summary, facts, where to start, skipped files), learning paths with progress meters, architecture, request flows, concepts, bookmarks. Each section has a heading, a one-sentence purpose and an empty state. |
| **Learn** | Guide column: the Learn home (where you left off, paths, tour, own pace), the learning path player (progress meter, item list, current item with cited code as evidence cards, mission steps with a hint, check options, result with evidence chips, completion), or the tour (progress, stop list, why each stop matters). The centre's empty state explains what will appear. |
| **Explore** | Starting points (start-investigating) page. The flow walkthrough moves to the guide column (step list with kind, provenance, location and reason). "Return to learning" is the primary action, and "Starting points" returns to the start page. |
| **Validate** (`modes/ValidateMode.tsx`) | Page header, checkpoint cards (label plus file:line, expandable explanation, question actions), and a progress aside (meter, per-question attempts with glyphs). The empty state links to Learn. |
| **Explanation panel** | Eyebrow, three-step empty state, teal citations, dotted "what we can't tell" box, structured check results (rubric with glyphs, verdict with a status border). |
| **Not found** | Purpose sentence, plus "Go home" and "Open a repository". |
| **Desktop gate** | Inherits the new tokens and components (markup unchanged, so its tests are unchanged). |

## 4. Components created or modified

**Created:**

- `ui.tsx`:
  - `PageHeader`;
  - `EmptyState`;
  - `ProgressMeter` (text plus `role="progressbar"`);
  - `OnboardSteps`.
- `hooks/useLearning.ts`:
  - `usePaths` (shared by Project and Learn);
  - `useTour` (cached);
  - `useLearnGuide` (remembered guide).
- In `Workspace.tsx`: `LearnHome` and `ExploreStart`.

**Reworked:**

- `RepoMenu`, now the project switcher;
- `ModeNav` (tabs with `aria-current`);
- `Shell` (header slots, two-state theme toggle);
- `PathPlayer` and `PathList` (cards with progress);
- `TourBar` and `FlowWalkthrough` (guide-column layout);
- `ArchitectureMap`, `FlowList` (plus a compact variant), `Concepts` (example citations as evidence cards), `Bookmarks` (plus a compact variant, empty state, star glyph);
- `CheckSection` (rubric and verdict styling), `ExplanationPanel` (empty state);
- `CodeViewer` (brand theme, selected-line rule);
- `usePrefs.useTheme` (dark-first).

**Styles:**

- `tokens.css` rewritten in three layers.
- `base.css` rewritten:
  - type scale and buttons (primary, quiet, danger, small, large);
  - tags and evidence chips;
  - status, meter, empty and skeleton states;
  - forms, cards, dialog, popover, tabs;
  - onboarding steps, guide column, path and flow lists;
  - responsive grid areas.
- Old token names are gone (no references remain).

## 5. Brand-kit compliance

| Requirement (08) | Status | Notes |
| --- | --- | --- |
| Token structure: primitives → roles → component tokens, `[data-theme='light']` | **PASS** | `client/src/styles/tokens.css`; components use roles only |
| Dark-first | **PASS** | Dark by default. Light only when chosen; an older stored "system" reads as dark |
| Palette hex values | **PASS** | Ink Deep, Ink, Ink Raised, Paper, Slate Muted, Highlighter, Citation Teal, Teal (light), and the four semantic colours, exactly as specified |
| Highlighter only for the primary action, the selected line and focus | **PASS** (by construction) | Mode tabs, the active tree row and the depth control use weight and rules, not yellow. Exception: the transient floating "Explain" button can briefly coexist with "Return to learning" |
| Teal for evidence only | **PASS** | file:line chips, paths, relation locations, citation rules. Ordinary links are Paper and underlined |
| Semantic colours for status only | **PASS** | Save status, stage glyphs, error and result borders |
| Confidence by glyph, word and border, not colour | **PASS** | Verified: solid border; Explained: dashed; Unknown/warn: dotted. The purple colour is removed |
| Typography: Manrope, Inter, JetBrains Mono, self-hosted | **PASS** | `@fontsource-variable/*` (SIL OFL 1.1), bundled. The build never inlines fonts, so `font-src 'self'` holds for web and desktop (caught by the journey E2E's CSP check) |
| Radii 6/8, pills for tags, no shadows | **PASS** | All component shadows were removed |
| Focus ring: 2px Highlighter, 2px offset | **PASS** in dark; **deviation** in light | Light uses an Ink ring because Highlighter on Paper is about 1.5:1, below the 3:1 a focus indicator needs ("accessibility overrides aesthetics", 08 §A) |
| Selected code line: Highlighter fill, Ink Deep text, syntax off | **PASS** | `.cm-kyc-target`. The explanation's range keeps a quiet tint with a rule |
| Syntax palette on Ink | **PASS** (Proposed in the kit) | The light-mode syntax colours are our own darker equivalents (Proposed) |
| Logo, favicon, icons | **BLOCKED** | The assets are not in the repository and must not be redrawn (08 §D). The product name is set in text; the invented `{ }` glyph is removed |
| Uncertainty wording "Verified / Likely / Not sure" | **NOT DONE** | The UI keeps "Verified" and "Explained", and "Unknown" for flow steps. Renaming changes meaning across the UI, tests and docs, so it needs a product decision |
| Full copy pass against the voice rules | **NOT DONE** | New copy follows the rules (sentence case, short, second person, no "simply/just"). Existing explanation and error copy was not re-audited |

## 6. User journeys implemented

| Journey | Status | Evidence |
| --- | --- | --- |
| A. First run: intro → import → progress → overview → recommended action | **PASS** (functional) | `journey.spec.ts` (the full journey now lands on Project); `modes.spec.ts` asserts the `/project` URL and the "Start here" recommendation |
| B. Returning: session restored → projects → where you left off → resume | **PASS** (functional) | Landing project list. The next step becomes "Continue learning". `modes.spec.ts` "Return to learning restores the exact step" (reload included). Desktop session restore is unchanged (`desktop.spec.ts`) |
| C. Learning-first: path → lesson → code → mission/check → feedback → next | **PASS** (functional) | `phase3.spec.ts` P3.7 (the lesson in the guide column, files via the drawer); the tour in P3.4 |
| D. Independent exploration without losing learning context | **PASS** (functional) | `modes.spec.ts`, `phase3.spec.ts` (bookmarks, flows, concepts open in Explore) |
| E. Validation: checkpoints → answer → feedback with evidence → history → retry | **PASS** (functional) | `modes.spec.ts` Validate; `phase3.spec.ts` P3.5 (rubric, results, attempts) |
| Web sign-in or registration | **NOT DONE** (out of scope) | The web app keeps its anonymous sessions ("No sign-up"). Accounts exist in the API and in the desktop gate. A web account UI would be a new feature |

## 7. Functional flows preserved

Every flow that existed before the redesign still works, with the same components and API calls:

- import with staged progress, cancel and failure recovery;
- branching trails with back and forward;
- server-saved Learn and Explore positions;
- deep and share links;
- explain, depth, follow-up, concept teaching, checks and feedback;
- relations navigation;
- bookmarks, tours, learning paths (lessons, missions, checks);
- flow walkthrough with play and narration;
- concepts teaching;
- assessment history;
- delete my data;
- desktop gate, bearer auth and hash routes.

No mock screens or hard-coded data were added: every element is fed by an existing endpoint.

## 8. Responsive and accessibility work

**Breakpoints:**

| Width | Layout |
| --- | --- |
| ≥ 1280px | Three columns |
| 768–1279px | Code plus panel. The guide stacks above the code (at most 40% of the height); files are a drawer |
| < 768px | One column. The top bar wraps (modes on their own row), the panel is a bottom sheet, the guide stacks above the code. Project and Validate collapse to one column with the next step first |

**Accessibility:**

- Semantic landmarks. Tabs are links with `aria-current`; trail steps and path items use `aria-current="step"`.
- Progress bars expose their values. Status is always glyph plus word.
- The switcher closes on Escape and returns focus to its button. The drawer has a scrim and closes on Escape.
- The skip link works under hash routes.
- `prefers-reduced-motion` is respected. Minimum text is 12px, used for captions and eyebrows only.
- axe (WCAG 2.2 AA, serious and critical) runs on landing, start, project, viewer and panel, in both colour-scheme projects. Because dark is now the default, both runs exercise the dark theme. **The light theme is not covered by axe yet.**

## 9. Test results (2026-11-12)

| Check | Result |
| --- | --- |
| Client typecheck (`tsc --noEmit`) | Clean |
| Lint (`eslint client/src e2e`) | Clean |
| Format (`prettier --check client e2e`) | Clean |
| Client unit tests | **61/61** |
| Client production build | OK (fonts emitted as files, none inlined) |
| Desktop frontend build (`build:desktop`) | OK; no `data:` fonts |
| Desktop node tests | 6/6 |
| E2E, deterministic (Playwright) | **32/32**: journey, errors, modes, Phase 3, responsive, axe (both colour-scheme projects), desktop. After the final CSS change, the axe, responsive and journey specs were re-run: 10/10 |

**E2E test changes:**

- *Why they changed:* some tests asserted the old navigation or copy and were updated to the new design. No assertion was removed or loosened; several were strengthened.
- *Navigation helpers:*
  - `helpers.openFile` now reaches the file tree from wherever the user is: it goes to Explore from Project, and opens the drawer in Learn or on narrow screens.
  - New `goExplore` helper.
- *Spec-by-spec:*
  - `modes.spec`: the landing URL is now `/project`. Added an assertion of the "Start here" recommendation.
  - `responsive.spec`: goes to Explore before using the tree. Added a no-horizontal-scroll check on the project page.
  - `journey.spec`:
    - the brand tagline;
    - the project switcher instead of "Repository menu";
    - the keyboard test starts in Explore.
  - `App.test`: the brand tagline, plus an assertion of the supporting line.

**Not re-run (no server or core code changed):** the core and server suites and cargo tests. Their last results are in report 17.

## 10. Remaining limitations

- **Visual review not done in this pass.** It was done during the realignment that followed (see `20` §7), which also superseded this report's Explore layout.
- **Brand assets missing** (logo, favicon, icon set). The app ships no favicon.
- **axe does not cover the light theme**, because dark is the default regardless of OS preference. Add a light-theme axe pass, for example by setting `kyc.theme=light` in `localStorage` before the run.
- **The guide column at 768–1279px** caps the lesson at 40% of the height. Long lessons scroll inside it; this needs review on real tablets.
- **The open guide is remembered per browser** (`localStorage`). Progress itself is server-side, but another device opens the Learn home rather than the same path.
- **Bookmark removal has no confirmation or undo.** It is low-stakes, but it is a destructive action.
- **The "Verified / Likely / Not sure" wording and a full copy pass** are not done (§5).
- **No web account UI.** See §6.

## 11. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Experience audit produced and ranked by impact | **PASS** (§1, 18 §2) |
| `18_UX_Flow_and_Information_Architecture.md` written | **PASS** |
| Brand tokens, typography, surfaces, spacing and interaction states implemented and applied globally | **PASS** (§5; logo assets BLOCKED) |
| Product shell: layout, navigation, project selector, context, responsive, persistent workspace | **PASS** |
| All four modes redesigned and connected | **PASS** |
| First-run and returning-user journeys | **PASS** (functional; web registration out of scope) |
| Empty, loading and error states; keyboard; focus | **PASS** |
| Existing functionality preserved; no tests weakened | **PASS** (E2E 32/32) |
| Typecheck, lint, client tests, E2E, production build, desktop frontend build | **PASS** |
| Visual quality verified in the running app | **NOT DONE** (by instruction: the joint review is the next step) |
| Deployment, push or publish | **NOT DONE** (not requested; forbidden by the brief) |
