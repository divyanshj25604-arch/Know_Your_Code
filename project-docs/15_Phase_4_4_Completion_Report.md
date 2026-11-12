# 15 — Phase 4.4 Completion Report: Entropy-Based Secret Detection

> **Date:** 2026-11-12 · **Branch:** `V1_KYC` · **Scope:** P4.4. **Decision: deferred, not implemented.** The feature depends on private-repository support, which is outside the current MVP scope.

## 1. Scope verification

| Source | What it says |
| --- | --- |
| [00_Engineering_Decision_Document.md](00_Engineering_Decision_Document.md), section 7, P4.4 | "Entropy-based secret detection … Unlocks: Private repos … MVP: **No (until private repos)**" |
| Same document, section 8, "Defer" | "Private repositories, GitLab and Bitbucket, until S2 and S4 are closed." |
| Component table, `privacy/redact.ts` | "Extend … add entropy-based detection … **Before private repos**" |
| Risk S4 | Regex-only redaction: Medium severity; the trigger is private repos |
| Code: `server/src/ingestion/github.ts:99,122` | Import accepts only public GitHub repositories. A private repository is refused with `REPO_NOT_FOUND_OR_PRIVATE`, both when the API reports `private: true` and when GitHub answers 404 |
| Code: `server/src/http/authRoutes.ts` | Accounts carry no GitHub credentials; there is no OAuth flow that could grant access to private code |
| Product copy (Landing, Start, repository menu) | "Public repositories only" |

**Conclusion.** Private repositories are not part of the MVP, and nothing in the code can import one. The scope is not ambiguous: every source agrees. Following the instruction not to expand the MVP to justify this feature, P4.4 is **deferred**, and no detection code was added.

## 2. What protects secrets today (unchanged, verified in earlier phases)

- **Pattern-based redaction:** `packages/core/src/privacy/redact.ts` has 11 rules: private keys, AWS, GitHub tokens and PATs, Slack, Anthropic, OpenAI-style, Google API, Stripe, URL credentials, and secret-named assignments. They run on every file before storage and again on anything sent to a model; line structure is preserved.
- **Secret-looking files** (`.env*`, key files) are never stored (`client/src/lib/skip.ts` copy: "may contain secrets; never stored"). E2E fixtures prove that a `.env` file and a `ghp_` token in source are not stored or sent.
- **Bounded retrieval:** only bounded context packs, never whole repositories, reach the provider.
- **Copy no longer overclaims.** P4.5 changed it to say that redaction is pattern-based and cannot catch every secret.

## 3. Readiness for when private repositories are approved

Implement P4.4 **before** enabling private imports, inside `redact.ts`, so storage and AI transfer both stay behind the one function:

1. **Shannon entropy on candidates only.** Score string literals and assignment values of 20 or more characters, with thresholds around ≥ 4.0 bits/char for base64-like and ≥ 3.0 for hex-like values. Never score whole lines.
2. **Ordinary data is excluded:**
   - lockfiles and `integrity` / `sha512-` fields;
   - git SHAs (40 hex characters in commit contexts);
   - UUIDs, data URIs, minified assets, and test fixtures whose paths are allowlisted;
   - a configurable exclusion list per repository (globs plus value fingerprints).
3. **Each finding records** path, line, rule (pattern or entropy), severity and confidence. It stores a **hash** of the value, never the value, so dismissals can match it without retaining the secret.
4. **Dismissal** is per repository and per finding fingerprint, and is stored in the learning layer.
5. **Tests** cover a known secret corpus (all current patterns plus entropy-only cases), common false positives (hashes, UUIDs, base64 images, lockfiles), redaction before AI retrieval, exclusions, and file/line references. Also measure the false-positive rate on the sample repositories (the EDD acceptance criterion).

## 4. Acceptance criteria

| Criterion | Status | Notes |
| --- | --- | --- |
| Scope verified against the EDD and the code | **PASS** | Section 1 |
| Decision and dependency documented | **PASS** | This report; the EDD P4.4 status is updated |
| No unnecessary implementation added | **PASS** | No code changes for P4.4 |
| Entropy detection, redaction of findings, false-positive tests, AI retrieval cannot expose detected secrets | **NOT DONE** | Deferred by scope. Blocked on a product decision to support private repositories |
