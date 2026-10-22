# 99 · Consistency Audit

| Version | 1.0 | Status | Completed 22 Oct 2026 after drafting 00–14 |
|---|---|---|---|

**Purpose.** Record cross-document checks (Phase 7 of the brief), what was fixed, and what remains open.

## 1. Checks performed
| # | Check | Result |
|---|---|---|
| 1 | PRD MVP (`01` §10) matches MoSCoW (`04` §2) | ✅ After fix: added F-23 "Suggested starting points" to `04` to match FR-OVR-03 (Should) |
| 2 | User flow (`05`) matches design screens (`06` §D) | ✅ 10 screens map to steps 1–17; no flow step requires a check before an explanation |
| 3 | Architecture supports the journey | ✅ Every flow step has an endpoint (`10` §2) and a module (`07` §4) |
| 4 | AI design matches architecture | ✅ Two-tier model env vars, verifier, cache key, cost ledger appear identically in `07` §9 and `09` |
| 5 | API matches data model | ✅ Entities match. After fix: "thread" is defined as messages grouped by explanation (`07` §7 updated; no `threads` table) |
| 6 | Error codes consistent | ✅ After fix: `05` §17 catalogue now covers every code in `10` §3 |
| 7 | Test plan validates requirements | ✅ Traceability excerpt in `11` §7; release criteria reference `01` NFRs |
| 8 | Competitive positioning reflects research | ✅ `03`, `13`, and `00` all avoid claiming assistants can't read repos; differentiation stated as a combination hypothesis |
| 9 | Brand promise matches the product | ✅ "Verified" is used only for analyser-derived relations; no learning-gain claims before tests |
| 10 | Launch targets the selected segment | ✅ `14` §2 recommends the same segment as `01` §4.1 |
| 11 | Sprint fits the stated deadline | ⚠️ Fits a **21-day assumption** with ~13% buffer; D-01 unresolved |
| 12 | No feature promised in marketing but absent from the plan | ✅ Landing and FAQ mention only Must features plus "Check yourself" marked optional; if Check yourself is not built in W3, remove it from landing copy |
| 13 | Same constants everywhere | ✅ 7-day retention; 1,500 files / 300 KB / 50 MB; JS/TS only; rate limits 5/60/120 per hour; ≤ 15 diagram nodes; 30-min session gap |
| 14 | Terminology | ✅ Owner, Repository, Snapshot, File, Symbol, Edge, Selection, Explanation, Message, Check attempt used consistently |

## 2. Unresolved conflicts and open items
| ID | Conflict / gap | Affected docs | Owner (role) | Resolution path |
|---|---|---|---|---|
| C-01 | **Pitch deck vs docs.** The Ideathon deck says "Tree-sitter", lists "JS/TS + Python" in Week 1, and uses the tagline "Understand the code you ship". These docs decide ts-morph, JS/TS only, and "Understand the code you build". | Deck, `07`, `08`, `13` | PL | Update the deck (task W3-09, or sooner if the deck is resubmitted) |
| C-02 | Deck claim "Every claim cites file + line" is stronger than the design: the verifier ensures every *rendered reference* is valid, but not every sentence carries a reference. | Deck, `09` §10 | PL | Rephrase to "Every link is checked against your code" |
| C-03 | Deadline unknown (D-01) | `12`, `14` §12 | PL | Confirm and re-date |
| C-04 | Model IDs and current prices unverified for the latest generation | `09` §3, §14 | AI | Verify on the official pricing page during T-3 |
| C-05 | CodeMirror 6 capabilities assumed (selection events, decorations, bundle size) but not verified against docs in this research pass | `07` ADR-10 | FE | Spike T-2 confirms or switches to Monaco |
| C-06 | Replit plan cost and Reserved VM memory sizes not verified | `07` §2, `12` checklist | BE | Check the Replit pricing page in W1 |
| C-07 | Capability "?" cells in the competitive matrix | `03` §3 | PL | Hands-on checks of Code Wiki and DeepWiki before the final pitch |

## 3. Re-audit triggers
Re-run this audit whenever: a D-xx decision changes; an ADR is revisited; the Should feature set is finalised (D-07); or evidence updates change a hypothesis to refuted.
