# 08 · Repository Ingestion and Code Analysis

| Version | 1.0 | Status | Draft; implements FR-IMP, FR-ANL, FR-SEL-02, FR-DEP; module design in `07` §4–5 |
|---|---|---|---|

**Purpose.** Define the code-understanding foundation: what we fetch, what we analyse, what we can prove, and what we can't.

---

## 1. Repository source and access
- **Input:** `https://github.com/{owner}/{repo}` optionally followed by `/tree/{ref}`. Regex: `^https?://(www\.)?github\.com/([A-Za-z0-9-]{1,39})/([A-Za-z0-9._-]{1,100})(/tree/([^?#]+))?/?$`.
- **Metadata:** `GET https://api.github.com/repos/{owner}/{repo}` using a server-side fine-grained read-only token (authenticated limit 5,000 requests/hour versus 60/hour unauthenticated, per GitHub docs). Read `private`, `default_branch`, `size` (KB).
- **Ref → SHA:** `GET /repos/{owner}/{repo}/commits/{ref}` → `sha`.
- **Content:** `GET /repos/{owner}/{repo}/tarball/{sha}` (redirects to codeload). One request per import instead of one per file. The Git Trees API (`?recursive=1`) is a fallback for listing only; it truncates beyond 100,000 entries or 7 MB.
- **Private repos:** not supported (D-03).

## 2. File inclusion and exclusion
| Rule | Pattern | Treatment |
|---|---|---|
| Analysable | `*.js *.jsx *.mjs *.cjs *.ts *.tsx` | Parsed, viewable, indexed |
| Viewable only | `*.json *.md *.css *.scss *.html *.yml *.yaml *.prisma *.sql *.env.example` and other UTF-8 text ≤ 300 KB | Viewable, lexical search; not parsed |
| Excluded dirs | `node_modules/ dist/ build/ out/ .next/ coverage/ .git/ vendor/ .turbo/ .vercel/ .cache/` | Dropped |
| Excluded files | `*.min.js`, `*.map`, `*.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, binaries, images, fonts | Dropped |
| Generated code | Header contains `@generated` or `DO NOT EDIT`, or the path matches `__generated__/` | Viewable, flagged "generated", not parsed by default |
| Secrets | `.env`, `.env.*` (except `.example`), `*.pem`, `*.key`, `id_rsa*` | **Never stored or shown** |
| Symlinks, absolute or `..` paths | — | Ignored (security) |

## 3. Size limits (initial; tune after spike T-1)
| Limit | Value | Basis |
|---|---|---|
| Compressed tarball | 50 MB | Bounds download time and memory |
| GitHub-reported size pre-check | 200 MB | Early reject before downloading |
| Analysable files | 1,500 | Typical student projects are far smaller; keeps ts-morph within memory (verify T-1) |
| Analysable file size | 300 KB | Larger files are usually generated or bundled |
| Viewable file size | 1 MB (first 2,000 lines shown above that) | Viewer performance |
| Total stored text | 30 MB per snapshot | DB growth bound |

## 4. Parsing strategy and AST representation
- **Tool:** ts-morph `Project` with an in-memory file system:
```ts
const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve,
                     target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
                     moduleResolution: ts.ModuleResolutionKind.Bundler,
                     baseUrl: tsconfigBaseUrl ?? undefined, paths: tsconfigPaths ?? undefined },
  skipAddingFilesFromTsConfig: true,
});
```
- Read `tsconfig.json`/`jsconfig.json` if present for `baseUrl` and `paths` aliases (e.g. `@/components`). Monorepos: use the root config only (sub-project selection deferred).
- The AST is **not persisted**. We persist derived symbols and edges, and rebuild the Project on demand from stored files (cached in an LRU of 5 Projects).

### What each layer can establish
| Layer | What it gives | Example | Limits |
|---|---|---|---|
| Syntax parsing | Structure of each file | "Line 12 is an arrow function assigned to `login`" | No meaning across files |
| Symbol extraction | Named declarations and ranges | `login` (function, auth.js:12–30) | Anonymous functions are named by context or `<anonymous>` |
| Static dependency analysis | Definitions, references, imports, direct calls resolved by the compiler | `login` calls `findUser` (users.js:4) | Dynamic dispatch, string-based routing, DI, `require(variable)` |
| Runtime behaviour | Actual values and paths taken | "In production `id` is a UUID" | **Not available** — we never run code |
| AI interpretation | Purpose, intent, explanations | "This validates credentials before issuing a token" | May be wrong; labelled *Explained* |

## 5. Symbol extraction
Extract for each analysable file:
| Kind | Source nodes |
|---|---|
| `function` | FunctionDeclaration; VariableDeclaration with ArrowFunction/FunctionExpression initialiser; exported default function |
| `method` | MethodDeclaration; object-literal methods/properties with function values (named `obj.key`) |
| `class` | ClassDeclaration/Expression |
| `variable` | Top-level and function-level VariableDeclarations (non-function) |
| `parameter` | Parameters (including destructured bindings, recorded individually) |
| `import` | ImportDeclaration, `require()` call with string literal |
| `export` | ExportDeclaration / export modifiers |
| `component` | Function returning JSX (heuristic: `.jsx/.tsx` + JSX in body) → kind `function` with `tags: ["react-component"]` |

Each symbol: `id, snapshot_id, file_id, name, qualified_name, kind, tags[], start_line, start_col, end_line, end_col, parent_symbol_id, exported (bool), signature (text, ≤ 200 chars)`.

## 6. Selection → code identity resolution (FR-SEL-02)
Given `{path, startLine, startCol, endLine, endCol}`:
1. Find the smallest symbol whose range contains the selection (`ORDER BY (end_line - start_line)` limit 1 among containers).
2. Get the ts-morph node at the selection start (`getDescendantAtPos`) and classify:
   - single Identifier → `identifier` (or `reference` if its definition is in another file)
   - CallExpression fully covered → `call`
   - ImportDeclaration → `import`
   - range equals a function symbol's range or name → `function`
   - multiple statements → `block`
3. If the selection spans more than one top-level declaration → `block` with `enclosing_symbol = null` and a flag that tells the UI to say so.

## 7. Relationship (edge) extraction
| Edge type | How | Stored as |
|---|---|---|
| `imports` | Import/`require` with literal → resolved source file (compiler resolution with paths); external packages recorded as `external:<pkg>` | file → file / external |
| `calls` | For each CallExpression inside a symbol: `getExpression().getSymbol()?.getDeclarations()` → target symbol | symbol → symbol |
| `references` | `findReferencesAsNodes()` on exported and top-level symbols (bounded: ≤ 200 references per symbol) | symbol → location |
| `defines` | Identifier → declaration via `getDefinitionNodes()` (computed **on demand** at selection time, not precomputed for every identifier) | runtime only |
| `unresolved` | Call or import where resolution fails | edge with `target_symbol_id NULL`, `reason` ∈ {`dynamic_import`, `computed_member`, `external_package`, `parse_error`, `no_declaration`} |

**Why on-demand for `defines`:** precomputing every identifier would multiply rows and import time; selection-time lookup on a cached Project is fast.

### Express route heuristic (Could; D-09)
Pattern `X.(get|post|put|patch|delete|use)('<path>', ...handlers)` where `X` resolves to an Express app or router import. For each handler identifier, add an edge `route_handler` with metadata `{method, path}`. This connects "where is `/api/login` handled?" to code. Marked *Verified (pattern)* in the UI, with a tooltip explaining it's pattern-based.

## 8. Cross-file navigation
Relations API returns, for a symbol: `definedIn`, `calledBy[]` (top 20 by same-file first, then path proximity), `calls[]`, `imports[]`, `unresolved[]`. Each item has `{symbolId?, path, line, label, provenance: 'verified'|'pattern'}`.

## 9. Dependency graph construction
- Nodes: symbols (and files for import edges). Edges as §7.
- Persisted in `edges(snapshot_id, type, source_symbol_id, source_file_id, target_symbol_id, target_file_id, target_external, line, reason, meta)`.
- 1-hop neighbourhood for diagrams: a union of `calls` in and out of a symbol, capped at 15 nodes.

## 10. Indexing
- B-tree: `symbols(snapshot_id, file_id, start_line)`, `edges(snapshot_id, source_symbol_id)`, `edges(snapshot_id, target_symbol_id)`.
- Trigram GIN index on `files.content` per snapshot for lexical search (follow-ups).
- Overview facts cached in `snapshots.overview` (JSONB).

## 11. Incremental updates and caching
- **No incremental re-indexing in the MVP.** A new commit SHA means a new snapshot. Re-importing the same SHA reuses the snapshot (idempotent).
- Explanations are cached by `(snapshot_sha, selection, kind, depth, prompt_version)`.

## 12. Unsupported syntax, parse failures, dynamic limitations
- The TypeScript parser tolerates syntax errors; nodes still exist and diagnostics are recorded. Files with fatal failures are listed as skipped.
- Unsupported in the MVP: Vue/Svelte single-file components (viewable only), Flow-specific syntax beyond what the TSX parser accepts, decorators metadata semantics, CommonJS `module.exports = function` patterns with heavy mutation (partially resolved).
- **Always shown as limitations in UI copy:** dynamic `import()`/`require()` with non-literals; computed property calls (`obj[name]()`); callbacks passed as values (higher-order functions resolve to the parameter, not the runtime target); dependency injection containers; event emitters; runtime config.

## 13. Example input → output
**Input files**
```js
// src/routes/auth.js
const router = require('express').Router();
const { login } = require('../controllers/authController');
router.post('/login', login);
module.exports = router;

// src/controllers/authController.js
const { findUserByEmail } = require('../services/userService');
async function login(req, res) {
  const user = await findUserByEmail(req.body.email);
  if (!user) return res.status(401).json({ error: 'Invalid' });
  res.json({ id: user.id });
}
module.exports = { login };
```
**Output (excerpt)**
```json
{
  "symbols": [
    {"id":"s1","name":"login","kind":"function","path":"src/controllers/authController.js","start_line":2,"end_line":6,"exported":true,"signature":"async function login(req, res)"},
    {"id":"s2","name":"findUserByEmail","kind":"function","path":"src/services/userService.js","start_line":3,"end_line":8,"exported":true}
  ],
  "edges": [
    {"type":"imports","source_file":"src/routes/auth.js","target_file":"src/controllers/authController.js","line":2},
    {"type":"imports","source_file":"src/routes/auth.js","target_external":"express","line":1,"reason":"external_package"},
    {"type":"calls","source_symbol":"s1","target_symbol":"s2","line":3},
    {"type":"route_handler","source_file":"src/routes/auth.js","target_symbol":"s1","line":3,"meta":{"method":"POST","path":"/login"}},
    {"type":"calls","source_symbol":"s1","target_symbol":null,"line":4,"reason":"external_package","meta":{"callee_text":"res.status(...).json"}}
  ]
}
```
**What we can say (Verified):** `login` is registered for `POST /login` (pattern); it calls `findUserByEmail`; it reads `req.body.email`.
**What we cannot say from code alone:** what `req.body.email` contains at runtime; whether body-parsing middleware is configured *before* this route (it depends on registration order in another file, which can be traced but is not guaranteed).

## 14. Tests against representative repositories
Corpus (permissively licensed public repos or team-owned repos; final list in `11` §3):
| # | Shape | Tests |
|---|---|---|
| C1 | Express + Mongoose CRUD (CommonJS) | `require` resolution; route heuristic |
| C2 | Express + Prisma (ESM, TS) | ESM imports; path aliases |
| C3 | React + Vite SPA (JSX) | Component detection; hooks calls |
| C4 | Next.js app router (TSX) | File-based routing is **not** resolvable as calls → expect unresolved; aliases `@/` |
| C5 | MERN monorepo (client/ + server/) | Two roots; root-config limitation |
| C6 | Node CLI utility (small) | Baseline correctness |
| C7 | Repo with a syntax error file | Partial index |
| C8 | Repo with `.env` committed | Secret exclusion |
| C9 | Oversized repo | Limit rejection |
| C10 | Team's own hackathon project | Real-world mix |

Ground truth: for C1–C3 and C6, a team member hand-labels 20 call edges and 10 definitions each. Accuracy is measured as precision and recall (`11` §4).

## Recommended smallest reliable pipeline (MVP)
Tarball → filter → ts-morph Project → symbols + `imports`/`calls` edges (+ unresolved reasons) → on-demand definitions and references → Postgres. Express route heuristic only if spike T-4 passes. No embeddings, no incremental indexing, no runtime analysis.

## Assumptions · Risks · Open questions
- Risk: ts-morph memory on the upper limit. Mitigation: worker thread; lower the limits if T-1 fails.
- Open: should `references` be precomputed for all top-level symbols (faster callers list) or on demand? Default: precompute `calls` (gives callers via reverse edges); compute `references` on demand.

**Related:** `07` §5–6 · `09` §4 · `10` (tables) · `11` §3–4
