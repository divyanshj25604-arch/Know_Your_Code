# 20 — Product Direction Realignment Report

Date: 2026-11-12. Status: **implemented, uncommitted, not deployed.** Authority: `product-direction/ORIGINAL-PRD.md`
(wins over `18`/`19` where they conflict), brand kit `08`, engineering decisions `00`.

## 1. What changed

| Area                | Before                                                     | Now                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing             | Tagline, "Try with your repo"                              | Tagline, supporting line, CTA **"Try with your own repo"**, a labelled example explanation (one highlighted line, one citation)                                       |
| Import              | One URL field and samples                                  | Split onboarding: **From GitHub** (URL, validation, private-repo note) and **From a ZIP file** (drop zone, browse, replace/remove, upload); one import at a time   |
| Analysis progress   | Four stages with descriptions                              | Same real stages, each with the tasks it performs; tasks tick only when their stage is done; files set aside are counted after filtering                            |
| Project orientation | Overview, cards, module list                               | **Interactive architecture map first** (modules, verified module imports, packages called); select to inspect, select again to open the module in Explore          |
| Explore             | File tree, code, explanation                               | **Code + "What this file does" (left) / graph (centre, largest) / explanation (right)**, files as a drawer (`T`), compact toolbar                                    |
| Graphs              | List-style architecture map, step list for flows           | SVG graph canvas: architecture drill-down, file dependencies, function relationships, request flows; pan, zoom, fit, filter, find, selection, hover, drill, back    |
| Notes               | Bookmarks only                                             | **Graph annotations**: notes on modules, files, functions, relationships and flow steps, persisted server-side, shown as badges on nodes                           |
| Confidence          | Verified / Verified (pattern) / Explained / Unknown        | Kit wording: **Verified** (parser), **Likely** (pattern or model reading with citations), **Not sure** (with the reason); glyph + word + border style               |

## 2. Requirement map (PRD → implementation)

| PRD requirement                                           | Where                                                                                                   | Status                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Stage 1 landing, main message, CTA                        | `client/src/pages/Landing.tsx`                                                                          | Done                                    |
| Stage 2 import states, GitHub + ZIP                       | `pages/Start.tsx`, `components/ZipDrop.tsx`, `server/src/http/uploadRoutes.ts`, `ingestion/zip.ts`      | Done (private repos: see §8)            |
| Stage 3 analysis progress, partial analysis               | `components/StageProgress.tsx`, `pages/Processing.tsx`                                                  | Done (stage-level, not task-level, data) |
| Stage 4 orientation with architecture map                 | `components/explore/ProjectMap.tsx`, `modes/ProjectMode.tsx`                                            | Done                                    |
| Stage 5 explore: code viewer, file relationships          | `pages/Workspace.tsx` (`ExploreBody`), `explore/FileExplanation.tsx`, `explore/GraphPanel.tsx`          | Done                                    |
| Stage 6 / §10.3 request-flow graph                        | `explore/graphModel.ts` `buildFlow`, walkthrough under the graph                                        | Done                                    |
| §10.1 architecture map with drill-down                    | `buildApplication` → `buildModule` → `buildFile`                                                        | Done                                    |
| §10.4 function relationship graph                         | `buildFunction` (callers ← function → callees, unresolved)                                              | Done                                    |
| §10.5 interaction rules                                   | `graph/GraphCanvas.tsx`                                                                                 | Done                                    |
| §9 Explain This Line, citations, confidence               | Existing explanation pipeline, reached from graph nodes and edges                                       | Reused; AI wording only relabelled      |
| §11.3 persistent context                                  | Trail, saved positions, graph level kept across selections                                              | Done                                    |
| Learn, Validate preserved                                 | Unchanged apart from wording                                                                            | Done                                    |
| Experiment hidden                                         | Not exposed anywhere                                                                                    | Done                                    |

## 3. Graph data: what is stored, what is derived, what is not available

| Relationship                               | Source                                               | Shown as                                                    |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| Module uses module (import count)          | `module_dependencies`                                | Verified edge "imports ×n"                                  |
| Module contains files                      | `module_files`                                       | Drill-down level                                            |
| File imports file                          | `edges` type `imports`                               | Verified, or Likely when pattern-only                       |
| File calls / uses / renders file           | `calls`/`references` edges grouped by file (new `GET /snapshots/:id/file-graph`) | Count and first line kept; JSX references read "renders" |
| Function calls function, uses, route       | `calls`, `references`, `route_handler`               | Function graph and file level (new `GET /snapshots/:id/file-outline`) |
| Calls into npm packages                    | `calls` with `target_external`                       | Package nodes                                               |
| Database access                            | Not stored                                           | **Likely**: a verified call into a known DB package (name list in `graphModel.ts`), never asserted as fact |
| Unresolved calls                           | `calls` with null target and a reason                | **Not sure** node with the reason; never a guessed edge     |
| Request flow steps                         | flows tables (existing)                              | Ordered top-to-bottom graph; parent by depth                |
| Frontend → API links                       | Only where the analyser recognised a client call     | Flow "Client call" steps; otherwise absent                  |

## 4. Graph ↔ code synchronisation

- **Graph → code.** Selecting a file opens it. Selecting a function, flow step or relationship navigates the trail to its exact line and range. The code viewer highlights the declaration, and the explanation panel loads that function's verified connections. "Explain with AI" or "Explain this connection" runs the existing explanation pipeline on that function or evidence line. Citations in the answer open the cited line, and the graph keeps its level and position.
- **Code → graph.** The open file, or the innermost declaration around the cursor, selects the matching node. If that node isn't visible, the graph pans to it without re-zooming. The architecture file level follows the open file. The Dependencies and Functions views centre on the code location unless the user has pinned a node.

## 5. Notes

Notes are a new `annotations` table (migration 016) with owner-only routes:
- `GET` and `POST /api/v1/repositories/:id/annotations`;
- `PATCH` and `DELETE /api/v1/annotations/:id`.

Each note is keyed by a stable target: a module key, a file path, a symbol key, `from|kind|to` for a relationship, or `METHOD route#index` for a flow step.

Notes behave like the other learning rows:
- they survive code retention and move with an anonymous-work claim;
- they are deleted with the repository.

Shared links don't show notes. CORS now allows `PATCH`. Bookmarks are unchanged.

## 6. Imports

- **GitHub:** unchanged backend. Validation runs before any request, and errors are specific. A private or missing repository gets the public-only message.
- **ZIP:** `POST /api/v1/uploads?name=` takes raw bytes, with the same authentication, rate limits and size cap as GitHub imports. The central directory is checked before anything is queued. The archive is held in `snapshot_uploads` until the snapshot reaches a terminal state. Uploads go through the same import job, extraction rules, redaction and analysis, and never call GitHub.
- **ZIP rejections:**
  - `INVALID_ARCHIVE` (400): corrupt, encrypted or ZIP64 archives;
  - `REPO_TOO_LARGE` (413): over the size or entry limits.
- **ZIP safety:** path traversal and symlinks are refused, a decompression-bomb guard applies, and CRC checksums are verified.
- **Client:** checks the `.zip` extension and refuses empty files, and disables both forms while an import runs.

## 7. Verification

| Check                                                       | Result                                     |
| ----------------------------------------------------------- | ------------------------------------------ |
| Client typecheck, ESLint, Prettier                          | Clean (only the known `groq-llm.test.ts` formatting issue, untouched) |
| Client unit tests                                           | 69/69 (adds layout, graph builders, canvas keyboard tests) |
| Server tests (private database)                             | 377/377 (adds ZIP reader, upload, file graph, annotations) |
| Core tests / desktop node tests                             | 138/138 / 6/6                              |
| Deterministic E2E                                           | **37/37** (adds `explore-graph.spec.ts`: drill-down, code↔graph, flow graph, notes across reload, ZIP import and errors) |
| Client production build, desktop frontend build             | OK; no inlined fonts                       |

**Visual review.** Run against the deterministic server, at 1440×900 and 1280×800 (390×844 checked for overflow).

Problems found and fixed:
- **Project map:** a long chain graph shrank to about 40% scale. The canvas now picks its direction to fit and never fits below 70%, and the map has the full width.
- **Flow view:** the walkthrough crowded the graph and clipped its tabs.
- **Code column:** too narrow; the split is now 30/45/25.
- **Dimming:** too strong.
- **Search box:** "Find in graph" wrapped onto its own row.
- **Landing page:** a pre-existing 400 on every visit (`landing_view` isn't an allowed analytics event). The client call is removed.

**Test changes** (copy only, no assertion removed):
- CTA text;
- "✦ Explained" → "◐ Likely" and "Unknown" → "Not sure";
- the keyboard-only test presses `T` to open the Files drawer.

## 8. Known limitations and blocked items

- **Private repositories** stay out of MVP scope, by decision (S2/S4 in `00`). There is no token input; the import screen explains this and offers ZIP.
- **Analysis progress** is real but stage-level. Tasks within a stage tick together because the server reports stages, not tasks.
- **Database steps** come only from calls into known database packages, and are labelled Likely. ORM model methods called on imported models (such as `User.findOne`) show as Not sure.
- **Large modules:** the file level shows the 36 most connected files and a file's 28 most connected declarations; the rest are reached with Find or Files. File outlines cap symbol edges at 400.
- **Fixed panes:** there is no draggable pane resizing. Below 1280px the explanation is a side drawer, and below 768px panes stack.
- **Logo:** still a text wordmark; there is no brand logo asset in the repository (see `19`).
- **Reference sketches:** only two exist (no analysis-progress sketch).
- **Not committed, pushed or deployed.**
