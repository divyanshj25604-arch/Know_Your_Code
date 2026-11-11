# Know Your Code — Brand Identity Requirements

*Recorded 2026-11-12 · source: `KnowYourCode-Brand-Kit-v1.0.pdf` (29 pages, November 2026, "v1.0 — for team review")*

**Status: authoritative product requirement, not yet implemented.** The brand kit defines how KnowYourCode looks, sounds and behaves. Every product-facing UI decision must follow it. This document records the requirement and audits the current client against it. It does **not** claim the brand is implemented: as of this date the shipped UI predates the kit and conflicts with it in several places (section C). A dedicated brand implementation pass is required (section E). It is scheduled separately from the engineering roadmap and needs approval before it starts.

The PDF is the source; this file is a faithful summary for engineers. Where they differ, the PDF wins. The kit tags each specification **Measured** (from the approved logo drawing, the brief or a repeatable calculation), **Inferred** or **Proposed** (awaiting team approval). Those tags are preserved below where they matter.

## A. Constraints every UI change must respect

**Name and voice**

- Product name: **KnowYourCode** (camel case) in the wordmark; **"Know Your Code"** in running text. "KYC" is never the spoken or written product name.
- Tagline: "Understand the code you ship." Supporting line: "Your repository becomes your textbook."
- Voice: a patient senior developer sitting beside you. Knowledgeable, never intimidating, never condescending; never shames anyone for using AI.
- Seven voice principles (Measured): explain before evaluating; be specific; use plain language; show evidence; admit uncertainty; encourage exploration; never shame AI use.
- Prefer "trace, follow, walk through, map", "this line / this function / your repo", "here's what we found", "based on file:line".
- Avoid "simply, just, obviously, easy, basic", "revolutionary, next-gen, supercharge, unlock", "the AI thinks", "magic", brain metaphors, and blame words about the student. Sentence case for headings and buttons. UI sentences under 20 words. Second person, active voice, contractions.
- Errors: what happened → why (cite the file or the limit) → one clear action. No error codes as headlines, no blame, no exclamation marks.
- Uncertainty is always explicit: **Verified** (parser), **Likely** (model, with citations), **Not sure** (say what is missing).

**Colour (hex values are fixed; ratios are WCAG 2.1, calculated)**

| Role | Token | Hex | Use | Never |
| --- | --- | --- | --- | --- |
| Ink Deep | `--kyc-ink-deep` | `#0B1120` | App canvas (dark-first) | Text, borders |
| Ink | `--kyc-ink` | `#0F172A` | Cards, panels, code blocks; light-mode text | Separation from Ink Deep by colour alone (1.05:1) |
| Ink Raised | `--kyc-ink-raised` | `#1E293B` | Hover rows, decorative borders | Input borders or any boundary users must see |
| Paper | `--kyc-paper` | `#FAF7F0` | Text on Ink; light-mode canvas | Large filled areas in dark mode |
| Slate Muted | `--kyc-slate-muted` | `#94A3B8` | Captions, line numbers, input borders on dark | Light backgrounds (use `#475569`) |
| Highlighter | `--kyc-highlighter` | `#FACC15` | **Selected code line, one primary action per view**, focus rings | Text on Paper, warnings, large backgrounds, more than one highlight per view |
| Citation Teal | `--kyc-citation-teal` | `#2DD4BF` | **Evidence only**: file paths, line citations, technical annotations | Success, decoration, body text, on Paper |
| Teal (light) | `--kyc-citation-teal-light` | `#0D9488` | Light-mode rules and graphics only (3.50:1) | Normal-size text |
| Semantic | `--kyc-success/warning/error/info` | `#22C55E` `#FB923C` `#F87171` `#60A5FA` | **Interface status only** | Brand decoration; yellow never means warning, teal never means success, red is not a brand colour |

Proportions in the product UI (Proposed): 78 Ink / 18 Paper and neutrals / 2 Highlighter / 2 Teal. Accessibility overrides aesthetics: combinations marked "prohibited" in the kit's contrast table (for example Highlighter or Citation Teal on Paper, Slate Muted on Paper) are never used for text or meaningful UI.

**Typography (all SIL OFL 1.1)**

- **Manrope**: display and headings (700–800).
- **Inter**: body text and UI (400–600; 16/24 default; never below 14px in the product).
- **JetBrains Mono**: code, citations, line numbers, technical labels and eyebrows.
- Fallbacks: `Manrope, system-ui, sans-serif` · `Inter, system-ui, sans-serif` · `'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace`.
- Web scale (Proposed): Display 56/60, H1 40/44, H2 30/36, H3 22/28, H4 18/24, Body 16/24, Body small 14/20, Caption 12/16, Eyebrow 12/16 (+0.14em), Code 14/22.

**Evidence-first visual distinction**

- Highlighter yellow = the selected code line (full-width fill, Ink Deep text, syntax colours off) and the single primary action.
- Citation Teal = evidence (citation markers, chips, file:line references), never ordinary links. Ordinary links are Inter, Paper, underlined.
- Confidence is shown by glyph, word and border style, never by colour alone, and never with semantic colours.

**Logo**

- Use only the supplied SVG files, scaled proportionally. Never redraw, recolour, stretch, rotate, outline, add effects to, or animate the mark.
- Use the full KYC monogram only at 24px letter height or more, always with "KnowYourCode" nearby on first contact. Use the K mark below that and in square formats (favicon, avatar, app icon).
- **Never put the monogram on sign-in, verification or identity screens** (it reads as "Know Your Customer"). This matters for any future account UI built on Phase 1 authentication.
- Clear space 2s on all sides; minimum sizes as listed on p.08.

**Design tokens**

- Implement the `kyc-tokens.css` structure from p.26–27: a primitive palette (`--kyc-ink-deep` …), roles (`--kyc-bg`, `--kyc-surface`, `--kyc-text`, `--kyc-text-muted`, `--kyc-border`, `--kyc-border-control`, `--kyc-focus`, `--kyc-citation`), component tokens (`--kyc-button-*`, `--kyc-chip-*`, `--kyc-code-*`, `--kyc-syntax-*`) and the `[data-theme="light"]` overrides.
- Components reference roles and component tokens, never raw hex values.
- Radii: 6px controls, 8px containers, pill only for tags. No shadows: elevation is surface colour plus a border. Focus ring on every interactive element: 2px Highlighter, 2px offset.

## B. Existing UI elements that already follow the brand

| Element | Evidence |
| --- | --- |
| Running-text product name "Know Your Code" | `client/index.html` title; page copy |
| Inter for UI and JetBrains Mono for code are named in the font stacks | `client/src/styles/tokens.css` (`--font-ui`, `--font-code`) |
| Components use CSS custom properties, not scattered hex (one literal `#fff` in `base.css`) | `client/src/styles/base.css` |
| 4px spacing scale and 6px control radius match the kit | `tokens.css` `--s1…--s8`, `--radius-control` |
| Visible focus ring with 2px width and 2px offset (colour differs, see C) | `base.css:17` |
| Evidence-first product behaviour: every explanation cites file and line; provenance labels distinguish verified relations from model output | `ExplanationPanel`, `RelationList` |
| Voice: specific, plain and non-judgemental error copy with a next action | `packages/contracts/src/errors.ts` `ERROR_MESSAGES` |
| Dark mode exists and is accessible (WCAG AA per `tokens.css` header) | `tokens.css` |

## C. Existing UI elements that conflict with the brand

| # | Conflict | Current | Brand requirement | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Light-first default palette | `--bg: #ffffff`, GitHub-style greys | Dark-first: Ink Deep canvas, Ink surfaces, Paper text | `tokens.css:2–15` |
| 2 | Primary action colour is teal | `.btn-primary` uses `--accent` (`#0f766e` light, `#2dd4bf` dark) | Primary action is Highlighter `#FACC15` with Ink Deep text, max one per view; teal is evidence only | `base.css:124` |
| 3 | Selected code is teal-tinted | `--highlight: rgba(15,118,110,.14)` with a teal inset bar | Highlighter fill, Ink Deep text, syntax colours off | `CodeViewer.tsx:89–91` |
| 4 | Focus ring colour | `outline: 2px solid var(--accent)` (teal) | 2px Highlighter | `base.css:17` |
| 5 | Status colours | verified `#1a7f37`/`#3fb950`, warning `#7d4e00`/`#d29922`, danger `#cf222e`/`#f85149` | Success `#22C55E`, Warning `#FB923C`, Error `#F87171`, Info `#60A5FA`, status only | `tokens.css` |
| 6 | "Explained" provenance uses purple | `--explained: #6639ba` / `#a371f7` | No purple in the palette; confidence by glyph + word + border, not colour | `tokens.css` |
| 7 | Syntax palette | GitHub-like (`#ff7b72`, `#a5d6ff`, …) | Kit syntax palette on Ink (`#C4B5FD`, `#93C5FD`, `#F9A8D4`, `#A5B4FC`, `#CBD5E1`, comments `#94A3B8` italic); yellow, teal, green, orange and red kept out of syntax | `tokens.css` syntax block |
| 8 | No display typeface | Headings use Inter | Manrope for display and headings | `tokens.css` (no Manrope) |
| 9 | Fonts are named but never loaded | No `@font-face` or font files; the CSP allows only `font-src 'self'` | Self-host Manrope, Inter and JetBrains Mono (Google Fonts would also need CSP changes) | `base.css`, `server/src/http/security.ts` CSP |
| 10 | Token names and structure | `--bg`, `--accent`, `--surface-1`… | `--kyc-*` primitives → roles → component tokens | `tokens.css` |
| 11 | Card radius | `--radius-card: 10px` | Containers 8px | `tokens.css` |

## D. Missing brand assets (none of these may be invented)

None of the kit's files are in the repository. The manifest (p.28) lists them as existing deliverables of the brand work. They must be added from the approved source files, never redrawn:

- Logo SVGs: `kyc-lockup-horizontal-{ink,paper,1c-paper,1c-ink}.svg`, stacked lockups, monogram, K mark (`kyc-icon-k-*.svg`), wordmark.
- Favicon (`kyc-favicon.svg`, plus 16/32/48 PNG and `.ico`), app icon (`kyc-app-icon.svg`, 1024px; needed by the desktop shell, P4.1), avatar.
- Icon library: `icons/*.svg` (12 icons, 24px grid, 1.5px stroke, 45° chamfers).
- `kyc-tokens.css` as delivered.
- Font files for self-hosting (Manrope, Inter, JetBrains Mono).

The client currently ships no favicon at all (`client/index.html` has no icon link).

## E. Design-token implementation gaps and work for the dedicated brand pass

Proposed as one separate, approved task. It is not part of Phase 1 and not yet scheduled in section 7 of `00_Engineering_Decision_Document.md`.

1. Import `kyc-tokens.css` (primitives, roles, component tokens, light overrides). Map the existing `--bg/--text/--accent/...` roles onto `--kyc-*` roles, then migrate components and delete the old tokens.
2. Make dark the default theme, and keep a light theme that follows the light-mode rules (Ink text plus teal rule for citations).
3. Re-colour the primary button, selected line, focus ring and the code viewer's mark and target decorations to Highlighter. Reserve teal for citations, chips and file:line references.
4. Replace status colours with the four semantic colours. Remove the purple "explained" colour; show confidence with glyph, word and border (Verified / Likely / Not sure).
5. Add Manrope for headings and the type scale. Self-host the three font families and adjust the CSP only if a hosted option is chosen.
6. Adopt the kit's syntax palette in CodeMirror (`CodeViewer.tsx` highlight style).
7. Add the supplied logo, favicon and icon assets. Use the horizontal lockup in the shell header. Keep the monogram off any future sign-in or account screens.
8. Copy pass against the voice rules.
9. Re-run the axe accessibility E2E (`e2e/a11y.spec.ts`) in both themes, and contrast-check every new pairing against the kit's table.

Open items the kit itself marks as needing team approval (p.28): typeface trio, light-mode logo, clear space and minimum sizes, syntax palette, light-mode citations, primary-button hover `#FDE047`, colour proportions, app icon and favicon treatment. Treat these as Proposed until approved.
