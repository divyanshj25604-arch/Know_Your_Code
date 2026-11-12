# 16 — Phase 4.5 Completion Report: Groq Pricing and Privacy Copy

> **Date:** 2026-11-12 · **Branch:** `V1_KYC` (committed; not pushed) · **Scope:** P4.5 (risk S5). No paid or live provider call was made. Provider facts below were read from Groq's own pages on 2026-11-12.

## 1. Audit

The whole repository was searched for provider names, pricing, "free", limits, privacy, retention and model IDs, in client, server, configuration, scripts and tests. Historical audit documents 01–07 were not rewritten: they record the code as it was.

| # | Location (before) | Statement | Classification | Action |
| --- | --- | --- | --- | --- |
| 1 | `client/src/pages/Landing.tsx:78` | "sent to an AI provider (Anthropic's Claude)" | Hard-coded provider: false whenever the server uses Groq or the test provider (S5) | Replaced: the provider name now comes from the server's configuration (`/api/v1/health` → `privacy.aiProvider`) |
| 2 | `client/src/pages/Start.tsx:88` | "sent to Anthropic (Claude)" | Same | Same |
| 3 | `client/src/components/RepoMenu.tsx:35` | "sent to the AI provider (Anthropic)" | Same | Same |
| 4 | Landing, Start, RepoMenu | "Stored for 7 days" | Product policy, but `RETENTION_DAYS` is configurable (1–30) | Uses the configured value (`privacy.retentionDays`) |
| 5 | `ValidateMode.tsx:84`; `packages/contracts/src/errors.ts` `SNAPSHOT_EXPIRED` | "This code was deleted after 7 days" / "This repo's data was deleted after 7 days." | Same | Now "… has been deleted (imported code is kept for a limited time)" |
| 6 | Landing, Start, RepoMenu | "Secrets are removed first" / "before anything is stored or sent" | Overclaim: redaction is pattern-based (P4.4 deferred) | "Common secret formats, such as API keys and tokens, are removed … The check is pattern-based, so do not import code that contains real secrets." |
| 7 | `packages/contracts/src/errors.ts` `BUDGET_EXCEEDED` | "We've hit today's **free** limit" | Unsupported "free" claim | "AI explanations have reached today's limit on this server." |
| 8 | `client/src/components/Shell.tsx:42`, `server/src/server.ts:40` | Test mode "not from Claude" | Provider-specific | "not from an AI model" |
| 9 | `.env.example` | "High-speed Groq API" | Marketing claim, unverified | Neutral description |
| 10 | `.env.example` | "Default models for Groq if not set: llama-3.1-8b-instant, llama-3.3-70b-versatile" | **Outdated**: both were shut down on 2026-08-16 (Groq deprecations page) | Removed. There are no Groq defaults now: `MODEL_FAST` and `MODEL_STRONG` must be set when `LLM_PROVIDER=groq` (config error otherwise) |
| 11 | `server/src/ai/cost.ts:7–13` | Silent mapping of the Claude defaults to the two Llama models when the provider is Groq | Hard-coded provider assumption, pointing at retired models | Removed; `modelFor` is provider-neutral |
| 12 | `.env.example` | `MODEL_FAST=claude-3-5-haiku-20241022`, `MODEL_STRONG=claude-3-5-sonnet-20241022` | Contradicted the code defaults (`claude-haiku-5-5`, `claude-sonnet-5-5`) | Replaced by the code defaults, commented |
| 13 | `server/src/config/env.ts` price defaults (0.1/0.5/2/10 USD per Mtok) and `.env.example` "Check provider's pricing page" | Unverified prices feeding the spend cap (the EDD's "mispriced" finding) | Kept as **development placeholders** only. Production with a real provider now refuses to start until all four prices are set explicitly. No Groq price is written anywhere |
| 14 | `server/src/ai/groq.ts` | Adapter (JSON object mode, error mapping) | Code, not a claim; works through the provider abstraction | Unchanged. Tests unchanged (`groq-llm.test.ts`, including its pre-existing formatting issue) |

No other Groq pricing, free-tier, rate-limit or data-retention claim exists in the product. The final search found none in `client/src`, `server/src`, `packages`, `.env.example` or `scripts`.

## 2. Provider facts (verified 2026-11-12) and how they are used

| Fact | Source | Used in the product? |
| --- | --- | --- |
| `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` were deprecated with shutdown on 2026-08-16; replacements suggested: `openai/gpt-oss-20b`, `openai/gpt-oss-120b` | console.groq.com/docs/deprecations | Yes: the reason no Groq defaults are shipped. The models page still lists them, which conflicts; the deprecations page was taken as authoritative |
| Public per-token prices for those two models: not published (models page shows "Contact Sales"); groq.com/pricing showed no price table | console.groq.com/docs/models, groq.com/pricing | No price is stated anywhere; operators enter prices from their own agreement |
| A free tier exists; rate limits are per organisation and shown in the console's Limits page | console.groq.com/docs/rate-limits, deprecations page | Not stated in the product (account-specific) |
| By default Groq does not retain inference data, except logs kept up to 30 days for reliability or abuse investigation; Zero Data Retention can be enabled in Data Controls | console.groq.com/docs/your-data | Not stated in the product. The product says only that the provider's own terms govern its handling, because the operator's account settings (ZDR) decide the actual behaviour |
| The Services Agreement (last modified 2026-06-22), section 4.2, says Groq may not use Inputs or Outputs for training without permission | console.groq.com/docs/legal/services-agreement | Not stated in the product (contractual, account-specific) |
| JSON Object Mode is available on all models; strict `json_schema` only on some newer models | console.groq.com/docs/structured-outputs | Consistent with the adapter's `json_object` use. Moving to strict schemas for Groq is optional future work |

**Product-level policies** (enforced by this codebase, so stated in the copy):

- public repositories only;
- imported code is never executed;
- only short snippets, never the whole repository, are sent to the provider;
- code is kept for the configured number of days;
- redaction is pattern-based.

**Claims that cannot be verified by the product, and are therefore not made:**

- any provider price or free usage;
- provider retention or training behaviour;
- "all secrets are removed".

## 3. Architecture

The provider abstraction is intact (`LlmClient`, `createLlm`, `LLM_PROVIDER`). Provider facts reach the client only through `HealthView.privacy` (`aiProvider` display name or null, and `retentionDays`). The copy is generated in one component, `client/src/components/PrivacyFacts.tsx`, which Landing, Start and the repository menu share. Groq stays a non-MVP option, as the EDD says. It now has to be configured with explicit, current models and prices, rather than relying on assumptions in code.

## 4. Verification

| Check | Result |
| --- | --- |
| Copy per configuration: Anthropic, Groq, test provider, AI not configured; retention days; no "free", price, "never stored/retained", training or "all secrets" claims | `client/src/components/PrivacyFacts.test.tsx` (3 tests) |
| Landing still states the code policy (existing test unchanged) | `client/src/App.test.tsx` |
| No Groq defaults; Claude IDs refused for Groq; production needs explicit prices; an empty price falls back to the development placeholder, never 0 | `server/tests/config.test.ts` (2 new tests) |
| Existing provider configuration works: fake (all suites), Anthropic adapter (`anthropic-llm.test.ts`), Groq adapter (`groq-llm.test.ts`) | Pass, unchanged |
| Health exposes `privacy` | Local production run (`aiProvider: null` with the test provider, `retentionDays: 7`) |

## 5. Acceptance criteria

| Criterion | Status | Notes |
| --- | --- | --- |
| All Groq-specific claims audited | **PASS** | Section 1 |
| Unsupported claims removed | **PASS** | Items 1–3 and 6–13 |
| Verified claims accurate and dated | **PASS** | Section 2 (dated 2026-11-12); only product policies appear in the UI |
| Provider-independent architecture intact | **PASS** | Section 3 |
| Live provider behaviour or pricing checks | **BLOCKED** | Requires paid usage and an approved key (P0.2) |
