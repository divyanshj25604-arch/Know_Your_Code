# 14 · Go-to-Market and Launch Strategy

| Version | 1.0 | Status | Draft; targets the segment in `01` §4.1; messaging from `13` |
|---|---|---|---|

**Purpose.** A launch plan a five-person student team can actually execute, tied to validating the thesis rather than collecting page views.

---

## 1. Launch objectives
| Phase | Objective | Type | Success looks like |
|---|---|---|---|
| Pre-launch (W1) | Confirm the problem exists for our segment | Research | `02` A1 decision made |
| Initial testing (W2) | Prove the thin slice helps real students on their own repos | Validation | A3/A4 evidence update |
| Public launch (W3) | Get qualified students to activate without hand-holding | Adoption | Activation and return rates measured on ≥ 50 activated owners (a learning goal, not a growth claim) |
| Post-launch | Decide what to build next from evidence | Iteration | Ranked backlog; decision log |
| Monetisation | **Deferred** | — | Revisit after retention evidence (§10) |

## 2. Initial launch segment
### 2.1 Segment assessment
Ratings are team hypotheses (H/M/L) to be updated by `02`.

| Segment | Severity | Frequency | Workarounds | Will adopt dedicated tool? | Willingness to pay | Research access | Competition | Implementation needs | Time to value |
|---|---|---|---|---|---|---|---|---|---|
| **NST CS students with JS/TS projects** | M–H (evaluations, interviews) | Episodic, around deadlines | ChatGPT, teammates | Unknown (A2) | L | **H** (on campus) | High (free assistants) | MVP as specified | Minutes |
| Student developer communities (other colleges) | M | Episodic | Same | Unknown | L | M | High | Same | Minutes |
| Hackathon participants | M (handover, judging Q&A) | Bursty | Teammates | M | L | M (events) | Medium | Same; repos messier | Minutes |
| Coding clubs | M | Weekly sessions | Mentors | M (as a teaching aid) | L | H | Medium | Same + a facilitator guide | Minutes |
| Open-source first-timers | M | Ongoing | READMEs, DeepWiki | M | L | L | **High** (DeepWiki, Code Wiki) | Larger repos | Hours |
| Junior devs onboarding | H | Ongoing | Seniors, docs | M | M–H (employer pays) | L | High (Copilot, Cursor) | Private repos, security | Hours |
| Interview preparers | H (stakes) | Short windows | Mock interviews | M | M | M | Medium | Same | Minutes |

### 2.2 Recommendation
**Start with NST CS students who have a JS/TS project and an upcoming evaluation or interview,** then expand to coding clubs (which bring a repeatable group setting) and hackathon participants. Reasons: direct research access; real repos already exist; deadlines create urgency; no sales cycle; and every session doubles as research. Open-source contributors and junior developers wait for private-repo support and larger-repo limits.

## 3. User acquisition strategy (prioritised)
| Priority | Channel | Why it fits | Tactic | Owner (role) |
|---|---|---|---|---|
| 1 | **Direct outreach to research participants and their friends** | Highest intent; immediate feedback | Every interviewee gets beta access; ask each for 2 classmates with projects | PL |
| 2 | **Campus demo tables / lab drop-ins** | Shows value in 2 minutes on *their* repo | "Bring your repo, understand one function in 5 minutes" at labs during project weeks | PL, DQ |
| 3 | **Coding clubs and project mentors** | Group adoption; credibility | A 20-min club session: each member explores their own project; facilitator guide | PL |
| 4 | **Short demo clips (LinkedIn + Instagram/YouTube Shorts)** | Makes the "aha" visible; supports channels 1–3 | 30-s clips: select → explain → click caller → back, on popular open-source repos | DQ |
| 5 | **Hackathon communities** (incl. Construct cohort) | Natural moment: understanding a teammate's code | Offer at the end of hackathons for handover/demo prep | PL |
| Later | GitHub README badge, Product Hunt, Reddit, Discords | Broader reach, less qualified | After retention signal | — |

Not now: paid ads, influencers, cold email blasts. They bring volume without fit, and they cost money we don't have.

## 4. Launch positioning
Lead with a **concrete scenario**, not with AI:
> *Riya's MERN project works. Her evaluator points at `authenticate()` and asks where the user ID comes from. She opens Know Your Code, selects `req.user.id`, sees that it's set by the JWT middleware in `middleware/auth.js:14` (verified), learns what JWT verification does using her own code, and explains it in her own words.*
Rules: no "AI is rotting your brain" framing; no "ace your viva" promises; always show one unresolved relation in demos (honesty is the brand).

## 5. Landing-page strategy
| Section | Content |
|---|---|
| Headline | Understand the code you build. |
| Supporting message | Paste a GitHub repo. Select any line. See what it does, how it connects, and how we know. |
| Primary CTA | Try with your repo · secondary: Try a sample |
| Problem framing | "Your project works. Could you walk someone through it?" + one sourced stat (e.g. developers spend ~58% of their time understanding code, Xia et al. 2018), with source shown |
| Product demonstration | 20-s silent loop with captions |
| How it works | 1 Paste repo · 2 Select code · 3 Learn and trace |
| Core benefits | The four benefits from `13` §4 |
| Differentiation | "Verified from your code" vs "Explained by AI", shown visually |
| Trust and privacy | Public repos only · deleted after 7 days or on request · AI provider named · no code generation |
| FAQ | `13` §4 FAQ |
| Footer | Team, Construct 2.0, GitHub repo link, contact |

No unsupported claims about learning improvement until `11` §6 results exist. After tests, add only real, attributed quotes, with permission.

## 6. Content strategy (small and repeatable: 2 pieces/week in W3, then weekly)
| Format | Example | Why it attracts the right users | Demonstrates |
|---|---|---|---|
| "Understand this in 30 s" | A confusing function from a popular OSS JS repo | Curiosity; shareable | Select-to-explain |
| "Trace the request" | Click from route → controller → service → DB call | Debugging pain | Verified relations + Back |
| "What does this architecture look like?" | Overview + starting points of a known repo | Orientation pain | Overview facts |
| "Understanding AI-generated code" | Take code produced by an assistant; explore it | Topical, non-fear framing | Learning-first use of AI output |
| "Debug by understanding" | A bug caused by a missing `await` or a `null` result | Practical | Edge cases + concepts |
| "Concept in your code" | `useEffect` explained on a real component | Beginners | Concept chips |
Only use repos with permissive licences, and credit the authors.

## 7. Product-led growth
| Mechanism | User benefit | MVP? |
|---|---|---|
| Bring another repo | Learn from a different project | Yes (no limit beyond rate limits) |
| Return to explore another part of the same repo | Continue learning | Yes ("Continue with…" for 7 days) |
| Invite a teammate (share a public repo URL plus a KYC link) | Understand each other's code | Light: a "Copy link to this file:line" button (works because repos are public) |
| Share an explanation publicly | Show understanding | **No.** Privacy and accuracy risk; revisit later |
No streaks, leaderboards, or referral rewards. They don't serve understanding (PP7).

## 8. Activation and retention
- **Activation event:** first *complete* explanation (M-02).
- **Time-to-value target:** ≤ 3 minutes from landing to first explanation for a typical repo (NFR-USE-01).
- **First successful learning interaction:** explanation → a relation click or follow-up within the same session (shows engagement beyond reading).
- **Likely abandonment reasons and responses:**
  - private repo → sample repo plus an explanation;
  - non-JS/TS → capture language interest;
  - slow import → stage progress plus a sample to explore while waiting;
  - wrong explanation → 👎 with reason plus visible verified relations;
  - "I don't know what to select" → starting points plus the empty-state hint.
- **Return drivers:** upcoming evaluations; new features in their own project; an optional end-of-session reminder ("Want a link to continue? Enter email", opt-in only, Could).

## 9. Launch experiments
| ID | Hypothesis | Audience | Method | Duration | Success metric | Cost | Decision rule | Next action |
|---|---|---|---|---|---|---|---|---|
| E-L1 | Students will import their own repo when invited after a demo | NST lab visitors | Demo table; count imports of own repos vs samples | 3 sessions | % of visitors importing their own repo | ₹0–500 (snacks) | If own-repo < 30%, privacy/private-repo barrier is real → prioritise messaging or GitHub App research | Adjust landing copy |
| E-L2 | Club sessions produce more return users than individual outreach | 2 clubs vs DM outreach | Compare 7-day return (M-07) | 1 week | M-07 by channel | ₹0 | Double down on the higher channel | Re-allocate PL time |
| E-L3 | Scenario-led headline beats feature-led headline | Landing visitors | A/B: "Understand the code you build" vs "Explain any line of your GitHub repo" | Until ~100 visitors per arm | CTA → import rate | ₹0 | Directional only at this size; pick the winner if the gap is large and consistent | Update `13` |
| E-L4 | Demo clips drive qualified traffic | LinkedIn/Shorts audiences | UTM-tagged links on 4 clips | 1 week | Imports per clip (not views) | ₹0 | Continue formats with imports > 0; drop the rest | Content plan |
| E-L5 | "Trace this value" is the most compelling feature | Usability participants | Observe first feature used and the stated "aha" | W2–W3 sessions | Count of participants naming it | ₹0 | Lead demos with the top-named feature | Demo script |
No benchmark conversion rates are assumed; we compare arms and channels against each other.

## 10. Monetisation strategy
| Model | Fit | Trade-off |
|---|---|---|
| Free individual use | Now | Costs fall on us; capped daily |
| Freemium (limits on explanations; paid for private repos/higher limits) | Plausible later | Students' willingness to pay is likely low (hypothesis) |
| Student plans | Possible | Price sensitivity in India; payment friction |
| Team plans (hackathon/project teams) | Possible | Requires collaboration features |
| Institutional licensing (colleges, bootcamps) | Plausible later | Sales cycle; needs evidence of learning outcomes |
| Developer-team subscriptions (onboarding) | Plausible later | Requires private repos and security work |

**Recommendation: defer monetisation.** Testing it now would distort validation (paywalls reduce usage data) and add payment work that does not test A3/A4. Gate for revisiting: M-07 return rate and M-10 independent comprehension show real value; then test willingness to pay through interviews and a "notify me about Pro" waitlist button (no payment integration).

## 11. Launch metrics dashboard
Built as SQL views over `events`, `snapshots`, `explanations`, `feedback`, `llm_calls`.
| Metric | Calculation |
|---|---|
| Visitors | distinct owners with `landing_view` per day |
| Repository imports | count of `POST /repositories` accepted per day (`import_submitted`) |
| Successful imports | snapshots reaching `ready`/`ready_partial` ÷ imports submitted |
| First explanations | owners whose first `explanation_complete` happened that day |
| Activation rate (M-02) | first explanations within 10 min of first import ÷ new owners who imported |
| Repeat learning sessions | owners with ≥ 2 sessions (30-min inactivity gap) in 7 days ÷ activated owners |
| User feedback | 👍 ÷ (👍+👎); top 👎 reasons |
| Learning outcomes | from moderated tests only (`11` §6), reported separately |
| Cost per session | Σ `llm_calls.cost_usd` grouped by session ÷ sessions |
| Retention | % of activated owners active on day 2–7 (M-07) |
**Allowed client events:** `landing_view`, `landing_cta`, `sample_picked`, `import_submitted`, `workspace_opened`, `selection_explain`, `explanation_complete`, `relation_clicked`, `back_used`, `depth_changed`, `concept_opened`, `followup_sent`, `check_started`, `check_skipped`, `feedback_given`, `repo_deleted`.

## 12. Launch timeline (aligned with `12`)
| When | Phase | Activities |
|---|---|---|
| W1 (Days 1–7) | Pre-launch research | Screener, 12 interviews, waitlist sign-ups from interviewees |
| W2 (Days 8–14) | Private beta | 8–10 moderated sessions; 15–20 invited beta users; fix top issues daily |
| W3 (Days 15–18) | Initial public release | Landing live; 2 lab demo tables; 1–2 club sessions; 2 clips per week |
| W3 (Days 19–21) | Demo + learning | Dashboard review; evidence update #3; demo with real numbers |
| After competition | Post-launch learning | Weekly evidence reviews; decide on Python vs private repos by evidence |

## 13. Long-term growth opportunities (ranked)
| Rank | Opportunity | Evidence today | User value | Complexity | Gate |
|---|---|---|---|---|---|
| 1 | Better dependency exploration (route heuristics, value tracing, flows) | Strong fit with the trace pain (hypothesis) | High | Medium | Usage of relations/trace features |
| 2 | Private repos via GitHub App | Likely common blocker (A2/A5 pending) | High | Medium-high (security) | ≥ 30% blocked by private repos |
| 3 | Additional languages (Python first) | Depends on screener | High for those users | High (new analyser) | ≥ 30% non-JS/TS demand |
| 4 | Team-based code learning (handover mode) | Plausible from team-project pain | Medium-high | Medium | Interview evidence |
| 5 | Advanced learning pathways (concept path from repo) | Speculative | Medium | Medium | Concept chip usage high |
| 6 | Open-source exploration | Crowded (DeepWiki, Code Wiki) | Medium | Medium (scale) | Clear differentiation |
| 7 | Developer onboarding (B2B) | Speculative | High (paid) | High | Private repos + security + outcomes evidence |

## Assumptions · Risks · Open questions
- Risk: launch turnout depends on exam calendars. Align demo tables with project weeks (PL to check the academic calendar).
- Open: can we partner with a faculty member to run a sanctioned class session? That would boost both research and credibility.

**Related:** `01` §11 · `02` · `12` · `13`
