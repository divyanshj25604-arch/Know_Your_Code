# 03 · Competitive Analysis

| Version | 1.0 | Status | Research snapshot as of **22 Oct 2026**; re-verify before external use |
|---|---|---|---|

**Purpose.** Establish what already exists, so KYC builds only what adds value, and so we never claim a differentiator a competitor already offers.

**Method.** Official product pages and documentation first; reputable press second. Every claim carries a source (Appendix A). Labels: **Observed** = stated in an official or reputable source. **Interpretation** = our strategic judgement.

---

## 1. Headline findings
1. **Repository-aware AI explanation is commoditised.** ChatGPT and Claude both connect to GitHub repositories and answer questions about code. Cursor indexes whole codebases. DeepWiki and Google Code Wiki generate repository wikis with chat and code links. *(Observed)*
2. **Learning-oriented AI modes also exist.** ChatGPT Study Mode and Claude's Learning style use Socratic guidance, and Claude Code has Explanatory and Learning output styles. *(Observed)*
3. **The gap is the combination, not any single capability.** We found no product that pairs (a) the learner's *own* repository, (b) relationships *computed* by static analysis and shown as verifiable links beside the code, and (c) learning-mode pedagogy anchored to a specific code selection, in a zero-setup browser workspace for students. *(Interpretation; absence is "not verified", not proven.)*
4. **Code-understanding startups have struggled.** CodeSee announced it was shutting down, citing the time needed to cover more codebases and languages, before being acquired by GitKraken in May 2024. Sourcegraph discontinued Cody Free and Pro in July 2025. *(Observed)* Lesson: keep scope narrow and prove value before breadth.

---

## 2. Competitor profiles

### 2.1 General-purpose AI assistants

**ChatGPT (OpenAI)**
- *Observed:* GitHub can be connected so ChatGPT retrieves permitted repository content (code, READMEs, docs) on demand; availability in standard chat, deep research, or agent mode depends on plan. Study Mode (launched 29 Jul 2025) uses Socratic questioning and hints, and can be toggled on or off.
- Target: everyone. Core use: Q&A and drafting. Source grounding: citations in deep research reports.
- Strength: ubiquity; students already use it. Limitation (interpretation): understanding happens in a chat separate from the code; relationships are described in prose rather than navigable; Study Mode isn't tied to a code selection.
- Overlap: **High** on explanation and follow-ups.

**Claude (Anthropic)**
- *Observed:* GitHub integration lets users add repositories to chats and Projects, choose files, and "Sync now". Repositories must fit within the context window. Learning style available in Claude.ai since Aug 2025.
- Overlap: **High** on explanation and pedagogy style. Limitation (interpretation): whole-repo context is bounded by the context window; no persistent navigable code view.

### 2.2 AI coding assistants

**GitHub Copilot**
- *Observed:* Plans include Copilot Free and Copilot Student (free for verified students, with limited chat and agent usage). Copilot Chat explains selected code in the IDE.
- Target: developers in IDEs. Overlap: **High** on "explain selection". Limitation (interpretation): optimised for producing code; requires IDE setup; no learning scaffolding by default.

**Cursor**
- *Observed:* Indexes codebases for semantic search; `@codebase` context in chat; Hobby (free, limited) and Pro ($20/mo) plans.
- Overlap: **Medium-high** on repo Q&A. Limitation (interpretation): heavy tool aimed at building; free tier limited; not designed for learning.

**Claude Code (Explanatory/Learning output styles)**
- *Observed:* Output styles include Explanatory (educational "Insights") and Learning (asks the user to write small pieces, using `TODO(human)` markers).
- Overlap: **Medium** on pedagogy. Limitation (interpretation): CLI or agent workflow aimed at writing code, not reading an existing project visually.

### 2.3 AI repository-understanding tools

**DeepWiki (Cognition)**
- *Observed:* Generates wiki-style documentation for GitHub repositories, with Q&A; free for public repos; swap `github.com` for `deepwiki.com` in a URL.
- Overlap: **High** on "understand a repo". Limitation (interpretation): documents the repository rather than teaching the learner; no depth adaptation or checks.

**Google Code Wiki**
- *Observed:* Public preview launched 13 Nov 2025 at codewiki.google. Regenerates documentation after code changes; Gemini chat; sections and answers hyperlink to code files and definitions; public repos only, with a CLI extension in development for private repos.
- Overlap: **High.** Strong incumbent backing. Limitation (interpretation): documentation-first, not learner-first.

### 2.4 Code visualisation and dependency tools

**CodeSee (now GitKraken)**
- *Observed:* Codebase maps, interactive code tours. Announced shutdown (Feb 2024), then acquired by GitKraken (May 2024) and folded into its DevEx platform.
- Overlap: **Medium** on visual relationships. Lesson: visualisation alone struggled to sustain a standalone business.

**Sourcegraph (Code Search; Cody legacy)**
- *Observed:* Cody Free and Pro discontinued 23 Jul 2025; Sourcegraph is now enterprise-focused; Amp spun off Dec 2025.
- Overlap: **Low** for students (enterprise-priced). Relevance: shows that precise code intelligence is valued, but sold to companies.

### 2.5 Interactive programming education
Platforms such as Codecademy, freeCodeCamp, Scrimba, and CS50's AI tutor teach with **curriculum examples**, not the learner's own project. *(Interpretation; specific features not individually verified for this snapshot.)* Overlap: **Low** on artefact; **high** on the student's time and attention.

### 2.6 Developer onboarding tools
Swimm, Unblocked, and similar products target company onboarding with private-repo integrations and team pricing. *(Not verified in this snapshot; listed for completeness.)* Overlap: **Low** for the MVP segment.

---

## 3. Capability matrix
Legend: ✅ Available · ◐ Partially · ? Not verified · — Not applicable

| Capability | ChatGPT | Claude | Copilot | Cursor | DeepWiki | Code Wiki | KYC MVP |
|---|---|---|---|---|---|---|---|
| Import own GitHub repo | ✅ | ✅ | ◐ (IDE/local) | ◐ (local) | ✅ public | ✅ public | ✅ public |
| Explain selected code in context | ◐ (paste or ask) | ◐ | ✅ | ✅ | ◐ (chat) | ◐ (chat) | ✅ |
| Navigable code viewer in product | — | ◐ (file picker) | ✅ (IDE) | ✅ (IDE) | ? | ✅ links | ✅ |
| Relations computed by static analysis, shown as links | ? | ? | ◐ (IDE go-to-def, not in explanations) | ◐ | ? | ✅ links to definitions | ✅ (core) |
| Verified vs. AI-interpreted labelling | ? | ? | ? | ? | ? | ? | ✅ |
| Learning / Socratic mode | ✅ Study Mode | ✅ Learning style | ? | ? | ? | ? | ✅ (anchored to selection) |
| Concept teaching using user's code | ◐ (if prompted) | ◐ | ◐ | ◐ | ? | ? | ✅ |
| Optional understanding checks on own code | ◐ (if prompted) | ◐ | ? | ? | ? | ? | ◐ (Should) |
| Zero-install, free for students | ✅ (limits) | ✅ (limits) | ✅ Student | ◐ Hobby | ✅ | ✅ | ✅ |

"?" means we could not verify the capability. It does **not** mean the product lacks it.

---

## 4. Strategic analysis

### 4.1 Jobs-to-be-done comparison
| Job | Best current option | Where KYC could be better (hypothesis) |
|---|---|---|
| "Tell me what this repo does" | DeepWiki / Code Wiki | Not a battle worth fighting; KYC gives a short overview and moves on |
| "Explain this function" | Copilot / Cursor / ChatGPT | Explanation plus verified relations in one view; adapts depth |
| "Where does this value come from?" | IDE go-to-definition plus manual tracing | One-click call-site tracing with argument text (FR-DEP-03) |
| "Teach me the concept I'm missing, here" | Study Mode or Learning style (with pasting) | Concept taught on the selected code with a link back |
| "Am I ready to explain this?" | Ask an assistant to quiz you | Optional check generated from *this* code, citing lines |

### 4.2 Substitution and switching costs
- **Substitutes are free and habitual.** Switching cost *to* KYC is low (paste a URL); switching cost *away* is also low. Retention must come from repeat value per session, not lock-in.
- **Threat:** any incumbent could add a "learning workspace". Code Wiki is the closest in form.

### 4.3 SWOT (KYC)
- **Strengths:** narrow learner focus; deterministic analysis for JS/TS; campus access for research; learning-first stance.
- **Weaknesses:** tiny team; public repos only; JS/TS only; no brand.
- **Opportunities:** students' trust gap with AI output; educators wanting AI use that builds skill; hackathon communities.
- **Threats:** incumbents adding learning features; free tiers getting better; model costs.

### 4.4 Why would a student use KYC instead of Claude or ChatGPT with their repo?
An honest answer, as a hypothesis to test in E-S2:
1. **They can check it.** Callers, callees, and definitions are computed from the code and clickable. An AI can't invent a caller that doesn't exist, because the link only renders if the analyser found it.
2. **They stay in the code.** Explanation, relations, and navigation sit next to the line they selected, with Back to return. There's no copy-paste and no re-explaining of context.
3. **It teaches instead of just answering.** Depth control, concept chips taught on their code, and optional checks support the high-learning AI-use patterns found in the Anthropic RCT.

If E-S2 shows assistants perform equally well on comprehension and trust, points 1–3 are not a sufficient wedge, and `02` §15 triggers a change of direction.

### 4.5 Not worth building (commoditised)
Generic repo summaries or wikis; free-form chat over the whole repo as a headline feature; autocomplete or code generation; repo-wide semantic search with embeddings; multi-language breadth. We use these only where they directly support the learning loop.

## 5. Recommended positioning statement
> **For CS students whose projects work but who can't fully explain them, Know Your Code is a code-understanding workspace that teaches from your own repository. Unlike general AI assistants, every relationship it shows is computed from your code and linked to the exact line, and you choose how deep to go.**

## Assumptions · Risks · Open questions
- Capabilities change fast; re-verify the matrix before the final pitch.
- Open: does Code Wiki's chat cite line-level references for arbitrary selections? (Unverified; test manually.)
- Open: can students on Copilot Student use repo-wide context sufficiently? (Test in E-S2 with Copilot users.)

---

## Appendix A · Research register
| # | Claim | Source (URL) | Date | Accessed | Confidence | Relevance | Uncertainty |
|---|---|---|---|---|---|---|---|
| 1 | ChatGPT retrieves permitted GitHub repo content on demand; availability varies by plan and surface | help.openai.com/articles/11145903 | Updated 2026 | 22 Oct 2026 | High (official) | Core substitute | Plan-specific availability |
| 2 | ChatGPT Study Mode launched 29 Jul 2025; Socratic, toggleable | campustechnology.com/Articles/2025/07/30/… ; venturebeat.com (Study Mode) | Jul 2025 | 22 Oct 2026 | High | Pedagogy competitor | Feature may have evolved |
| 3 | Claude GitHub integration: add repos to chats/Projects, configure files, "Sync now", must fit context window | claude.com/docs/connectors/github ; support.claude.com/en/articles/10167454 | 2026 | 22 Oct 2026 | High (official) | Core substitute | Beta |
| 4 | Claude Learning style for all users; Claude Code Explanatory/Learning output styles | engadget.com (Aug 2025); code.claude.com/docs/en/output-styles | Aug 2025 | 22 Oct 2026 | High | Pedagogy competitor | — |
| 5 | Copilot Free and Copilot Student plans; Student free for verified students | docs.github.com/en/enterprise-cloud@latest/copilot/get-started/plans | 2026 | 22 Oct 2026 | High (official) | Students' default tool | Allowances change |
| 6 | Cursor plans: Hobby free (limited), Pro $20/mo; codebase indexing | cursor.com/en/pricing | 2026 | 22 Oct 2026 | High (official) | Substitute | Usage limits change |
| 7 | DeepWiki generates wiki docs for public repos with Q&A | huggingface.co/blog/lynn-mikami/deepwiki ; docs.rootly.com/ai/connectors/deepwiki | 2025–26 | 22 Oct 2026 | Medium-high | Repo understanding | Feature depth |
| 8 | Google Code Wiki public preview 13 Nov 2025; regenerates docs; links to code; Gemini chat | alternativeto.net (Nov 2025); devops.com; itsfoss.com/news/google-code-wiki | Nov–Dec 2025 | 22 Oct 2026 | Medium-high | Closest form-factor | Preview status |
| 9 | CodeSee shutdown announcement, then acquired by GitKraken May 2024 | gitkraken.com/blog/gitkraken-launches-devex-platform-acquires-codesee ; alternativeto.net (May 2024) | 2024 | 22 Oct 2026 | High | Market lesson | — |
| 10 | Sourcegraph discontinued Cody Free/Pro 23 Jul 2025 | sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans | Jun 2025 | 22 Oct 2026 | High (official) | Market lesson | — |
| 11 | 84% of developers use/plan AI tools; 16.3% find AI code hard to understand; 20% less confident | survey.stackoverflow.co/2025 | Jul 2025 | 22 Oct 2026 | High | Problem evidence | Developers, not only students |
| 12 | ~58% of developer time on comprehension | ink.library.smu.edu.sg/sis_research/3779 | 2018 | 22 Oct 2026 | High | Problem evidence | Professionals; 2018 |
| 13 | AI-assisted learners scored 17% lower; conceptual-question users 65–86% vs delegators 24–39% | anthropic.com/research/AI-assistance-coding-skills | 29 Jan 2026 | 22 Oct 2026 | High (primary) | Pedagogy design | Narrow task |
| 14 | India added 5.2M GitHub developers in 2025 | github.blog Octoverse 2025 | Oct 2025 | 22 Oct 2026 | High | Market size context | — |
| 15 | GitHub REST: 60 req/h unauthenticated, 5,000/h authenticated; recursive tree limit 100,000 entries / 7 MB | docs.github.com/en/rest/overview/rate-limits-for-the-rest-api ; docs.github.com/en/rest/git/trees | 2026 | 22 Oct 2026 | High (official) | Ingestion design | — |
| 16 | ts-morph `findReferences`, `getDefinitionNodes`, `getImplementations` | ts-morph.com/navigation/finding-references ; ts-morph.com/details/identifiers | 2026 | 22 Oct 2026 | High (official) | Analyser choice | Performance at scale (spike T-1) |
| 17 | tree-sitter-typescript ships separate TS and TSX grammars | github.com/tree-sitter/tree-sitter-typescript | 2026 | 22 Oct 2026 | High | Alternative analyser | — |
| 18 | Replit Autoscale scales to zero; Reserved VM is an always-on dedicated server | docs.replit.com/features/publishing/deployment-types | 2026 | 22 Oct 2026 | High (official) | Hosting | Pricing not verified |
| 19 | Claude API priced per million tokens; Haiku 4.5 at $1/$5; Sonnet 5 intro $2/$10 until 31 Aug 2026, then $3/$15 | platform.claude.com/docs/en/about-claude/pricing (+ secondary) | 2026 | 22 Oct 2026 | Medium-high | Cost model | Current 5.5-generation rates: **verify before budgeting** |

**Related:** `01` §2 · `04` · `13` §2 · `14` §2
