# 02 · User Research and Validation Plan

| Version | 1.0 | Status | Ready to execute · **no research has been conducted yet** |
|---|---|---|---|

**Purpose.** Test the riskiest assumptions in `01` §2.6 (A1–A6) with a small campus sample before and during the build.

**Scope.** Problem validation (does the pain exist?), solution validation (does KYC relieve it better than current tools?), and learning-outcome measurement. Every result recorded here must be real; nothing in this document is pre-filled.

---

## 1. Research objectives
1. **O1:** Establish how often target students struggle to explain, trace, or modify their own project code, and what they do when that happens (A1).
2. **O2:** Map current workflows for understanding unfamiliar code, including AI tools used and where they fall short (input for A3).
3. **O3:** Learn whether students will bring a repository to a new tool, and what blocks them (A2, A5).
4. **O4:** Measure whether a KYC session improves independent comprehension (A4), and how that compares with the student's usual assistant (A3).

## 2. Primary research questions
- RQ1: In the last 3 months, when did the participant last fail to explain or change part of their own code? What happened next?
- RQ2: Which parts are hardest: architecture, a specific function, a concept, or data flow?
- RQ3: What tools did they use, in what order, and what made them stop?
- RQ4: Would they paste a repo URL into a new site? What would they need to know first?
- RQ5: After a KYC session, can they explain the function, its inputs' origin, and one dependency without help?
- RQ6: On matched tasks, do they understand more, and trust more, with KYC or with their usual assistant?

## 3. Participant criteria
| Criterion | Include | Exclude |
|---|---|---|
| Programme | CS/IT undergrads, years 1–4 (target: 2–4) | Non-programmers |
| Artefact | Has ≥ 1 project they contributed to, ideally JS/TS on GitHub | No project at all (problem interviews may still include up to 2 for contrast) |
| Mix | ≥ 1/3 who used AI heavily to build; ≥ 1/3 team-project contributors; ≥ 2 who consider themselves strong | All one profile |
| Relationship | Avoid close friends of the team for at least half the sample | — |

**Sample size.** Problem interviews: 12–15 (themes typically saturate at this scale for a single segment; we'll stop early if no new themes emerge in 3 consecutive interviews). Usability and comparison sessions: 8–10. Survey: aim for 60+ for directional percentages only.

## 4. Recruitment
- Post in NST batch groups and coding-club channels: *"20-min chat about how you understand code in your projects. No pitch. Snacks/coffee on us."* Don't mention the product in problem interviews.
- Screener (Google Form, 6 questions): year; languages used; whether they have a GitHub project (link optional); tools used to understand code; last time they got stuck understanding their own code (free text); availability.
- Select by the criteria in §3 and record why each participant was chosen.
- **Consent:** verbal and written consent for notes and recording; explain that their repo is only used with permission, and deleted after the session if they ask.

## 5–9. Problem interview guide (30 min, semi-structured, non-leading)
Rules: ask about **specific past events**, not hypotheticals. Never say "Would you use a tool that…". Interviewer plus note-taker. Record exact quotes.

**Warm-up (3 min)**
1. Tell me about a project you've built recently. What does it do?
2. How was it built: alone, with a team, with AI tools, from a tutorial?

**Actual past experiences (10 min)**
3. Think of the last time you had to explain part of that project to someone. What happened?
4. Was there a part you couldn't explain? What did you do in that moment?
5. Tell me about the last time something broke in a part you didn't write or don't fully understand. Walk me through the steps you took.

**Existing workflows (7 min)**
6. When you open a file you don't understand, what do you do first? Then what?
7. Which tools did you use the last time? *(probe: ChatGPT, Claude, Copilot, Cursor, docs, YouTube, teammate)*
8. What did that tool get right? Where did it leave you stuck?

**AI-assisted development (5 min)**
9. Roughly what share of your last project's code was written or heavily suggested by AI? How do you feel about explaining that code?
10. Have you ever accepted AI code you didn't understand? What happened later?

**Comprehension difficulties (5 min)**
11. Which is hardest: knowing how files connect, understanding one function, unfamiliar concepts, or tracing data? Can you give an example?
12. If you could understand one thing about your project better tomorrow, what would it be?
13. *(Close)* Would you be willing to try something with your repo in a later session? *(Measures A2 without pitching.)*

**Synthesis tags:** `pain:explain`, `pain:trace`, `pain:connect`, `pain:concept`, `pain:modify`, `tool:<name>`, `stop-reason:<x>`, `trigger:<viva|interview|bug|feature>`, `privacy`, `repo:public|private`, `lang:<x>`.

## 10. Repository-based usability test (45 min, Week 2–3)
**Setup:** participant's own public JS/TS repo (or a corpus repo if theirs is unsupported). Screen and audio recorded with consent. Think-aloud protocol.

**Pre-test (5 min, no tool):** facilitator picks one non-trivial function the participant did *not* write, or doesn't remember writing. Participant answers four questions, scored with the rubric in `11` §6:
Q1 What does it do? · Q2 Where do its inputs come from? · Q3 What depends on it or what does it call? · Q4 What happens if input X is missing or invalid?

**Tasks (25 min, with KYC):**
- T1: Import your repo and open the overview. *(Measure: time, errors, confusion points)*
- T2: Find and understand the function from the pre-test.
- T3: Find one place that calls it, then come back.
- T4: Learn one concept you weren't sure about.
- T5 (optional, unprompted): does the participant use "Check yourself"? Record whether they do.

**Post-test (5 min, tool closed):** a parallel form of Q1–Q4 on the same function, plus one transfer question on a *related* function.
**Debrief (10 min):** What was most and least useful? What would you have done without this? What felt untrustworthy? Then the satisfaction question (M-12).

## 11. Competitor comparison experiment (E-S2)
- **Design:** within-subjects, counterbalanced. Each participant studies two comparable functions from a corpus repo: one with KYC, one with their usual assistant (ChatGPT, Claude, or Copilot Chat, with repo access if they normally use it). Order and function assignment are randomised.
- **Measures:** rubric score on Q1–Q4 for each function (tool closed); time; trust rating (1–5) for each tool's claims; errors found in each tool's output (facilitator verifies).
- **Fairness:** the participant uses the assistant the way they normally do. The facilitator gives no tips for either tool.
- **Interpretation:** n ≈ 8–10 is directional, not statistically conclusive. Report raw scores, not percentages of "winners" alone.

## 12. Feedback collection
In product: 👍/👎 with reasons (FR-FBK-01) and an optional "Tell us more" text box. After a session: a 3-question form (most useful, least useful, disappointment question). A weekly "office hour" at a campus spot for walk-in testing.

## 13. Synthesis process
1. Within 24 h of each session: notes into a shared sheet, one row per observation, tagged.
2. After every 4 interviews: affinity-map the tags; count participants per pain (not mentions).
3. Produce a one-page **evidence update** per week: what changed in confidence for A1–A6, plus quotes with participant IDs (P01…). No names in shared docs.

## 14. Assumption validation matrix
| Assumption | Method | Evidence that supports it | Evidence that refutes it |
|---|---|---|---|
| A1 pain frequency | Interviews Q3–5 | ≥ 8 of 12 describe a concrete episode in the last 3 months | ≤ 4 of 12 do |
| A2 will bring repo | Interview Q13; landing smoke test | ≥ 60% agree to a session with their repo; landing import rate tracked | Majority refuse for privacy/private repo |
| A3 better than assistant | E-S2 | KYC rubric ≥ assistant on most participants and higher trust ratings | Assistant equal or better on most |
| A4 learning gain | §10 pre/post | Majority improve on ≥ 2 of 4 questions without the tool | No improvement over pre-test |
| A5 JS/TS + public | Screener | ≥ 50% have a public or publishable JS/TS repo | Mostly Python/Java/private |
| A6 cost | Telemetry | Cost per session within the budget set in `09` §14 | Exceeds by > 2× |

## 15. Decision rules
| Outcome | Rule | Action |
|---|---|---|
| **Proceed** | A1 supported **and** (A3 or A4 supported) | Continue the plan in `12` |
| **Change direction** | A1 supported but A3 refuted (assistants equal or better) | Shift emphasis to what tested better (e.g. visual tracing, checks); re-test within 1 week |
| **Change segment/language** | A5 refuted (mostly Python or private repos) | Re-plan analyser scope (`07` ADR-03 revisit) or add a GitHub App post-competition |
| **Stop / rethink** | A1 refuted (pain is rare) | Return to problem discovery; do not keep building features |

The thresholds are judgement calls for a small sample. They exist so the team decides **before** seeing results, not to claim statistical significance.

## 16. Two-week campus execution plan
| When | Activity | Output |
|---|---|---|
| Days 1–2 | Screener out; recruit 15 | Participant list |
| Days 2–6 | 12 problem interviews | Evidence update #1 (A1, A2, A5) |
| Day 7 | Synthesis; go/change/stop on the problem | Decision note in `01` §13 |
| Days 10–16 | 8–10 usability and comparison sessions on the Week-2 build | Evidence update #2 (A3, A4) |
| Day 17 | Synthesis; feeds Week-3 fixes | Prioritised fix list |

## Assumptions · Risks · Open questions
- Risk: social-desirability bias (friends being nice). Mitigation: half non-friends; behavioural measures over opinions.
- Risk: facilitator bias in E-S2. Mitigation: scripted prompts; scoring by a second team member blind to condition where feasible.
- Open: will the department allow sessions in labs? Who holds consent records?

**Related:** `01` §2.6, §11 · `11` §6 (rubric) · `14` §9 (launch experiments)
