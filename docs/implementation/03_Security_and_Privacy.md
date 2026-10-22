# 03 · Security and Privacy

| Field | Value |
|---|---|
| Applies to | `V1_KYC` as built |
| Method | Threat model against `docs/07 §10`; each safeguard names the test that covers it |
| Claim | The listed threats are mitigated as described. **This is not a claim that the product is completely secure** (see §4) |

## 1. What is untrusted

Everything that comes from outside: the repository URL, the archive and every file in it, repository text shown to the model,
the model's output, browser requests, and the `Origin`/`Host` headers. Nothing from a repository is ever executed
(no `npm install`, no scripts, no imported tests).

## 2. Threats and safeguards

| Threat | Safeguard | Test / evidence |
|---|---|---|
| **SSRF** via the repository URL | Only `http(s)://[www.]github.com/{owner}/{repo}[/tree/{ref}]`; no credentials, ports, query, fragment, control characters; strict owner/name/ref grammar; validation happens before any network request | `ingestion-url.test.ts`: localhost, `127.0.0.1`, `169.254.169.254`, `github.com.evil.com`, `github.com@evil.com`, `file:`, `javascript:` … all rejected |
| SSRF via **redirects** | The GitHub client talks only to the two configured hosts, follows redirects manually and refuses any other host; credentials are never forwarded across hosts | `github.test.ts` ("refuses redirects to unexpected hosts") |
| **Malicious archive**: zip-slip, absolute paths, symlinks/hardlinks, bombs | Paths normalised and rejected if `..`/absolute/backslash; links ignored; caps on download bytes, entry count, **decompressed** bytes, per-file and total text, analysable files | `extract.test.ts`, real React/TypeScript rejected with bounded memory |
| **Resource exhaustion** | Import concurrency 2, 120 s timeout, analysis in a worker thread with a memory cap and termination, per-owner and per-IP rate limits, 64 KB request bodies, daily LLM spend cap | `runner.test.ts`, `security.test.ts`, `ai.test.ts` (budget, rate limit) |
| **Secrets in repositories** | `.env*`, keys, certificates are never stored or shown; known token formats, key blocks, connection-string passwords and secret-looking assignments are redacted (line structure preserved) before storage **and** again before anything is sent to the model | `redact.test.ts`, `extract.test.ts`, `ai.test.ts` (prompt contains `[REDACTED]`, not the token), E2E (page never shows the token) |
| **Prompt injection** from code/comments | System rules and repository text are separate; repository text is inside `<repository_content trust="untrusted">`; the model has no tools and cannot take actions; output is schema-validated; every file/line link is verified against what was shown | `ai.test.ts` (placement of a hostile comment), E2E "repository text cannot steer the assistant". Residual: see §4 |
| **Invented citations** | Links outside the shown ranges are stripped and counted; >30% stripped triggers one strong-tier regeneration | `ai-units.test.ts`, `ai.test.ts` |
| **XSS** | React text rendering only; the model's tiny markdown subset (`**`/`` ` ``) is parsed into elements, never HTML; no `innerHTML`/`eval`; CSP `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` | `inline.test.tsx` (HTML stays text), E2E asserts no CSP violations in the console |
| **CSRF** | `SameSite=Lax` cookie; JSON-only bodies; state-changing requests refused when `Sec-Fetch-Site: cross-site` or `Origin` is not this host / `APP_BASE_URL` | `security.test.ts`; dev-proxy behaviour verified by hand |
| **Cookie theft/forgery** | Owner cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, signed; a forged unsigned value mints a fresh owner | `security.test.ts` |
| **Unauthorised access** | Owner checks on explanations, messages, checks, feedback, deletion; snapshots are unguessable UUIDv4 and read-only | `api.test.ts`, `ai.test.ts` |
| **IP-limit evasion** | `X-Forwarded-For` is ignored unless `TRUST_PROXY=true` | `security.test.ts` |
| **Error leakage** | Typed user-safe errors; provider/DB/parser messages are never returned; unknown errors become a generic 500; logs avoid code and prompts | `api.test.ts`, `anthropic-llm.test.ts` (provider text and key never echoed), `health.test.ts` |
| **Data retention / deletion** | 7-day expiry (hourly job + audit rows with only `owner/name`), on-demand cascade delete (149 ms measured), cost/event rows 90 days | `security.test.ts`, `deletion-perf.test.ts`, `api.test.ts` |
| **Dependencies** | `npm audit`: 0 known vulnerabilities at the time of the final run; lockfile committed | The CI workflow installs from the lockfile (`npm ci`); the workflow itself has not yet run on GitHub |
| **Credentials in the browser** | `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` exist only in server configuration | grep of `client/` shows no key material; `anthropic-llm.test.ts` |

## 3. Privacy

- Public repositories only; no accounts; an anonymous signed cookie identifies the browser.
- Imported files, analysis, explanations and conversations are kept **7 days** (`RETENTION_DAYS`) or until the user deletes them.
- **The AI provider receives short snippets** of the code the user selects, plus related definitions and call sites (≤ ~6–8k
  tokens per request, secrets redacted). The provider (Anthropic) is named on the landing page, the start page and the
  repository menu. Check Anthropic's current data-use and retention terms before launch; this is an operator decision and is
  not verified here.
- Events (`events` table) are whitelisted names with scalar props; they never contain code. No third-party analytics or trackers.
- `llm_calls` stores token counts, cost and timings, never prompts or outputs. Explanations and messages are stored (that is
  the product) and deleted with the repository.

## 4. Residual risks and limitations

1. **Prompt injection cannot be eliminated**, only contained: a hostile repository could still make an explanation of *its own
   code* misleading. The blast radius is that one answer (no tools, no secrets, verified links, Verified vs Explained labels).
2. **Redaction is pattern-based.** A secret in an unusual format can slip through to storage and to the AI provider. Excluded
   file names and common token formats are covered; entropy-based detection is not implemented.
3. **Public-only is enforced by GitHub's response**, not by us: a repository that becomes public later is importable, and a
   private repository returns "not found or private" (indistinguishable by design).
4. **No malware scanning** of repository content (it is only parsed as text).
5. **In-memory rate limits** reset on restart and are per-instance.
6. **`unsafe-inline` styles** are allowed by the CSP because CodeMirror injects `<style>` elements; scripts remain `'self'` only.
7. The anonymous owner model means anyone holding the cookie can delete that data; clearing cookies orphans (but does not
   expose) it until the 7-day expiry.
8. Not done: a third-party penetration test, dependency-confusion review beyond the lockfile, and a screen-reader audit.
