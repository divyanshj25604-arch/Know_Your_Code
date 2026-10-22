# 13 · Brand Strategy and Product Positioning

| Version | 1.0 | Status | Draft; product promise defined in `01` §3; claims must stay within `01` §2.5 evidence |
|---|---|---|---|

**Purpose.** A consistent brand that communicates learning, technical credibility, and confidence, without overpromising.

---

## 1. Brand foundation
| Element | Definition |
|---|---|
| Purpose | Help people become genuinely capable with the code they work with. |
| Mission | Turn every student's own repository into the best textbook they'll ever have. |
| Vision | Nobody ships code they can't explain. |
| Brand promise | *We show you how your code works, and we show you how we know.* |
| Core values | **Honesty** (verified vs explained, limits stated) · **Respect** (no judgement, no gatekeeping) · **Agency** (you choose the path) · **Craft** (precise, careful, calm) |
| Personality | A patient senior engineer: precise, warm, unhurried, slightly understated. Never hype, never snark. |
| Brand principles | Show evidence · Plain words first · Learning is invited · Calm over flashy |
| Positioning | See §3 (recommended direction A) |
| Value proposition | Understand your own project: explanations anchored to your lines, relationships you can verify, concepts taught through your code. |
| Reasons to believe | (1) Relations computed by static analysis and linked to exact lines. (2) Every AI claim labelled *Explained*, and every file reference checked before it's shown. (3) Learning-first design informed by published research on how AI use affects skill formation (Anthropic RCT, 2026). (4) Public repos only, deleted after 7 days or on request. |

## 2. Audience and positioning
- **Primary audience:** CS undergraduates with working JS/TS projects they can't fully explain (`01` §4.1).
- **Secondary:** students inheriting teammates' code; self-taught beginners learning through projects.
- **User problem:** "My project works, but I couldn't walk you through it."
- **Desired outcome:** "I can explain it, trace it, and change it myself."
- **Category:** *Code-understanding workspace for learners.* (We avoid "AI tutor", which is crowded and sounds like homework help, and "code wiki", which is documentation, not learning.)
- **Differentiation:** verifiable relationships + learning anchored to your selection + zero setup (`03` §4.4).
- **Competitive alternatives:** ChatGPT/Claude with repo access, Copilot Chat, Cursor, DeepWiki, Google Code Wiki, asking a teammate.

## 3. Three positioning directions
| | A · "Understand the code you build." | B · "Turn your repository into a learning environment." | C · "From AI-generated code to independent understanding." |
|---|---|---|---|
| Core idea | Ownership + comprehension | Product mechanism | Transformation from AI dependence |
| Strength | Short, memorable, inclusive (AI-built, tutorial-built, or teammate-built code all fit); speaks to the user's identity as a builder | Explains what the product does | Timely; emotionally sharp |
| Weakness | Doesn't say *how* | Long, abstract; "learning environment" sounds like an LMS | Implies AI code is bad (fear framing); excludes non-AI cases; risks sounding like an anti-cheating tool |
| Fit with learning-first philosophy | High | Medium | Medium-low |
| Defensibility of claims | High | High | Medium (implies a transformation we haven't measured) |

**Recommendation: A, "Understand the code you build."** Use B's idea as the supporting line, and use C only as a *story* (one scenario among several), never as the headline.

> **Note:** the Ideathon pitch deck used "Understand the code you ship." "Build" is preferred: students *build* projects; "ship" implies production releases and fits our audience less well. Update the deck (`99`).

**Positioning statement:** For CS students whose projects work but who can't fully explain them, Know Your Code is a code-understanding workspace that teaches from your own repository. Unlike general AI assistants, every relationship it shows is computed from your code and linked to the exact line, and you choose how deep to go.

## 4. Messaging hierarchy
- **One-line description:** Know Your Code explains your own GitHub project, line by line, with links you can check.
- **Short pitch (30 s):** Paste your repo. Select any line you don't understand. Know Your Code explains it in plain words and shows you exactly what calls it, what it calls, and where its data comes from, all verified from your code rather than guessed. Go simpler or deeper, learn the concept behind it, and check yourself when you're ready.
- **Landing headline:** Understand the code you build.
- **Supporting headline:** Paste a GitHub repo. Select any line. See what it does, how it connects, and how we know.
- **Product description (≈ 80 words):** Know Your Code is a free workspace for learning from your own projects. It analyses your JavaScript or TypeScript repository, then lets you select any function, variable, or line to get an explanation grounded in your code. Connections between files are computed directly from the code and linked to exact lines, so you can verify them yourself. Adjust the depth, learn the concepts you're missing using your own code, and test yourself only if you want to.
- **Core benefits:**
  1. *See how it connects.* Callers, callees, and definitions, one click away.
  2. *Trust what you read.* Verified links; AI interpretations clearly labelled.
  3. *Learn at your level.* Simpler or deeper, whenever you want.
  4. *Learn the concept, here.* Concepts explained using your own code.
- **Feature explanations:** Verified relations · Select-to-explain · Depth control · Concept chips · Follow-up questions · Check yourself (optional) · Delete anytime.
- **Proof points (only what we can show):** live demo; the verified/explained labels in the UI; the privacy policy; and, **after testing**, real participant quotes and measured pre/post results. *Do not claim learning gains before `11` §6 produces them.*
- **FAQ (landing):**
  - *Is this cheating?* No. KYC doesn't write code for you. It helps you understand code you already have.
  - *Which languages?* JavaScript and TypeScript today.
  - *Private repos?* Not yet; public only.
  - *What happens to my code?* It's analysed on our server, relevant snippets are sent to our AI provider to generate explanations, and everything is deleted after 7 days or when you click Delete.
  - *Can the AI be wrong?* Yes. That's why connections are verified from the code itself, and anything interpreted by AI is labelled.
  - *Is it free?* Yes during the beta, with daily limits.

## 5. Tone of voice
| Context | Do | Don't |
|---|---|---|
| Beginners | "This line waits for the database to reply before moving on (**await**)." | "Trivially, the promise resolves…" |
| Experienced devs | Offer Deeper: types, edge cases, design trade-offs, concisely | Pad with basics they didn't ask for |
| Uncertainty | "The code here doesn't show where `config` is set. It's probably loaded at startup; check `index.js`." | "Config is set in index.js." (when unverified) |
| Errors | "We couldn't open that repo because it's private. We can only read public repos right now." | "Error 404." / "Oops! Something went wrong 😅" |
| Talking about AI | "Explained by AI · may be imperfect" · "Verified from your code" | "Our AI understands your code perfectly." |

**Words to prefer:** understand, see, trace, check, learn, your code, verified, explain.
**Claims and words to avoid:** "100% accurate", "never wrong", "understands your entire codebase", "replaces mentors/TAs", "ace your viva", "beat the interviewer", "learn to code without learning", "AI-powered" as a headline (state the benefit instead), and any fear framing ("AI is rotting your brain").

## 6. Visual identity direction
- **Colour:** neutral slate base; one **teal** accent (calm, technical, distinct from GitHub green and VS Code blue); semantic **green ✓ = Verified** and **violet ✦ = Explained**, always with icon and label. Tokens in `06` §H.
- **Typography:** Inter (UI) + JetBrains Mono (code). Headlines in Inter Semibold with tight tracking.
- **Logo characteristics:** a wordmark "know your code" in lowercase with a monospace accent on "code"; a mark combining a cursor/selection bracket with a check, i.e. *selected and verified*. Must work at 16 px (favicon) and in one colour.
- **Interface styling:** quiet surfaces, generous line height, no gradients behind code, no glowing "AI" effects.
- **Illustrations and diagrams:** diagrams drawn from real graph data (nodes = functions, edges = calls) in the product's own style; no stock "robot" imagery.
- **Code visual language:** real snippets from sample repos in marketing, with line numbers and the selection highlight as the signature visual motif.

## 7. Brand consistency across touchpoints
| Touchpoint | How the positioning shows up |
|---|---|
| Product UI | Verified/Explained tags; "Select any code to learn what it does" empty state; no gating |
| Landing page | Headline A; 20-s loop of select → explain → click caller → back |
| GitHub repo (our own) | README opens with the one-liner; "How we know" section on static analysis vs AI; limitations listed |
| Documentation | Plain-language "How it works" + "What we can't tell from code" |
| Social media | Short "Understand this in 30 s" clips from real open-source code; no fear framing |
| Product demos | Always show one *unresolved* relation, which demonstrates honesty |
| Competition pitch | Same tagline; same three benefits; evidence slides limited to sourced data and our own test results |

## Assumptions · Risks · Open questions
- Risk: "verified" could be read as "the explanation is guaranteed correct". Mitigation: tooltip text says "Verified = this connection exists in your code."
- Open: final logo. Make it a Week-3 Could task with the design role, if any time remains.

**Related:** `01` §3 · `03` §5 · `06` §H · `14`
