# 02 · Deployment and Operations

| Field | Value |
|---|---|
| Applies to | `V1_KYC` as built |
| Verified | Production build started locally (Node 26, PostgreSQL 16) and exercised with `scripts/smoke.mjs` against real GitHub |
| **Not verified** | Deployment on Replit or any hosted platform; TLS/reverse-proxy behaviour; the live Claude API |

The app is **one Node process** (Fastify API + in-process job runner + static React app) plus **PostgreSQL**. There is no
other infrastructure: no Redis, queue, object store, or search service.

## 1. Requirements

- Node.js ≥ 20.12 (uses `process.loadEnvFile`, `worker_threads`, global `fetch`).
- PostgreSQL ≥ 14 with `pg_trgm` and `pgcrypto` (the first migration runs `CREATE EXTENSION IF NOT EXISTS`; the DB role
  needs permission to create extensions, or an admin must create them once).
- Memory: plan for **≥ 2 GB**. Analysing real repositories peaked at 0.4–0.75 GB RSS in measurements; the analysis worker is
  capped at `ANALYSIS_MAX_MEMORY_MB` (default 2048) and a worker that exceeds it fails that import only.
- Outbound HTTPS to `codeload.github.com` (and `api.github.com` if `GITHUB_TOKEN` is set) and `api.anthropic.com`.

## 2. Configuration

See the table in the root `README.md` and `.env.example`. Production essentials:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the managed Postgres URL |
| `COOKIE_SECRET` | `openssl rand -hex 32`. **Required**; startup fails without it |
| `ANTHROPIC_API_KEY` | required (or startup fails) unless `LLM_PROVIDER=fake` is set deliberately |
| `APP_BASE_URL` | the public URL, e.g. `https://kyc.example.com`. The same-origin check accepts this origin |
| `TRUST_PROXY` | `true` only if a reverse proxy you control sets `X-Forwarded-*` |
| `GITHUB_TOKEN` | recommended: fine-grained, read-only, public data only |
| `DAILY_SPEND_CAP_USD` and `MODEL_*_USD_PER_MTOK` | set from the provider's current pricing page |

Startup **fails fast** with a readable message when configuration is invalid. It logs a warning (not an error) when the
test provider is active in production or when `GITHUB_TOKEN` is missing.

## 3. Build and run

```bash
npm ci
npm run build        # client/dist (static) + server/dist (server.js, analysis/worker.js, db/migrations)
npm start            # node server/dist/server.js ; applies pending migrations, re-queues interrupted imports, schedules retention
```

- Migrations are forward-only and additive, applied under an advisory lock at every start. They can also be run alone:
  `node server/dist/db/migrate-cli.js`.
- The server serves the API under `/api/v1` and the SPA (with history fallback) from `client/dist`. Run from the repository
  root, or set `STATIC_DIR`.
- Graceful shutdown on `SIGTERM`/`SIGINT` waits up to 10 s; an import still running is **re-queued on the next start**.

### Replit Reserved VM (planned target in `docs/07`; instructions not exercised)

1. Create a Reserved VM deployment from the repository; add a PostgreSQL database and copy its URL to `DATABASE_URL`.
2. Add the variables above under **Secrets** (never commit them).
3. Build command: `npm ci && npm run build`. Run command: `npm start`. Set `TRUST_PROXY=true` and `APP_BASE_URL` to the
   deployment URL.
4. After the first deploy run the smoke test (below). Use a Reserved VM (always on), not Autoscale: the job runner and rate
   limiter are in-process.

Any host that can run Node and reach Postgres works the same way (systemd unit, PM2, a PaaS). No Dockerfile is provided
because it could not be built or tested in the development environment.

## 4. Verification after every deploy

```bash
BASE_URL=https://your.app npm run smoke              # health, headers, SPA, bad URL, real import, selection, relations, delete
BASE_URL=https://your.app node scripts/smoke.mjs --ai  # also requests one explanation (a few cents with Claude)
```

The smoke test imports a public repository (`--repo` to choose), checks the result, and deletes it. It exits non-zero on the
first failing step, naming it.

## 5. Health and monitoring

`GET /api/v1/health`:

| Field | Meaning |
|---|---|
| HTTP `200` + `status: ok` | database reachable, AI provider configured |
| HTTP `200` + `status: degraded` | database fine, AI provider missing (`ai: not_configured`): browsing and verified relations work |
| HTTP `503` | database unreachable (`db: down`): the app cannot serve |
| `ai` | `configured`, `not_configured`, or `test_provider` (deterministic test double, **not** Claude) |
| `github` | `token` or `anonymous` (anonymous cannot pre-check size/visibility) |
| `queueDepth` | imports queued or running |

Health does not call GitHub or Anthropic (no quota use) and exposes no hostnames or secrets. Point an uptime monitor at it
(every ~5 min) and alert on non-200. Provider outages show up as `AI_*` errors in the logs and as failed `llm_calls` rows.

**Logs** are pino JSON on stdout. Request logs record method, path (no query), request id. Cookies, authorization headers,
request bodies, repository contents and prompts are never logged. Useful messages: `import complete` (with per-stage
timings), `import failed`, `import rejected` (limit/unsupported, with code), `retention: deleted expired snapshots`,
`AI provider error` (status and type only).

**Cost and quality queries** (all tables carry no code content):

```sql
-- spend today
SELECT sum(cost_usd) FROM llm_calls WHERE created_at >= date_trunc('day', now());
-- error and cache rates by task, last 7 days
SELECT task, count(*) calls, count(*) FILTER (WHERE status <> 'ok') failures, count(*) FILTER (WHERE cache_hit) cached,
       round(avg(total_ms)) avg_ms, sum(cost_usd) cost
FROM llm_calls WHERE created_at > now() - interval '7 days' GROUP BY task;
-- "Incorrect" ratings
SELECT count(*) FILTER (WHERE reason='incorrect') incorrect, count(*) total FROM feedback;
```

## 6. Runbook

| Situation | What happens | What to do |
|---|---|---|
| Anthropic outage / key revoked | Explanations fail with a retryable message; relations still work. A rejected key surfaces as `AI_NOT_CONFIGURED` | Fix the key / wait. No data is lost |
| Daily cap reached | New model calls return `BUDGET_EXCEEDED` until the next UTC day | Raise `DAILY_SPEND_CAP_USD` and restart if intentional |
| GitHub rate limit (`GITHUB_RATE_LIMITED`) | Imports fail with a retry hint | Set `GITHUB_TOKEN` (5,000/h instead of 60/h) |
| Import stuck after a crash | On start, `queued`/`running` jobs are re-queued (max 3 attempts), others marked failed | Nothing |
| Slow or huge repository | Rejected early with the limit named; timeout 120 s (`IMPORT_TIMEOUT_MS`) | Tune limits in env if you accept the memory cost |
| Disk/DB growth | Imported text is deleted after 7 days by the hourly retention job; `llm_calls`/`events` after 90 days | Check `deletion_log` shows `retention` rows |
| User asks to delete their data | The user can self-serve: Repository menu → Delete my data | Manual: `DELETE FROM repositories WHERE gh_owner='…' AND gh_name='…'` cascades everything |
| Rotating `COOKIE_SECRET` | Existing owner cookies become invalid: users lose "Continue" and delete rights for existing imports (data still expires in 7 days) | Rotate rarely; announce if needed |

## 7. Rollback and recovery

- **Application:** redeploy the previous build (Replit deployment history, or re-run `git checkout <tag> && npm ci && npm run build && npm start`).
  Migrations `001`–`003` only add tables/indexes/an extra allowed CHECK value, so the previous build runs correctly against
  the newer schema. There are no destructive migrations.
- **Schema:** migrations are forward-only by policy. If one ever must be reverted, restore from a Postgres backup taken
  before the deploy (`pg_dump`). Because user data is transient (7 days), a backup is usually unnecessary; take one before any
  future schema change that rewrites data.
- **Recovery from total loss:** provision Postgres, set the variables, `npm start` (migrations create the schema). Users
  re-import; nothing else is lost.

## 8. Capacity and limits (as designed, single instance)

- ~20 concurrent users and ~200 imports/week (`NFR-SCL-01`). Measured: 20 concurrent navigation clients sustained
  ~12.7k requests/s with p90 2.3 ms on one laptop; real imports finish in 2–7 s. 20 concurrent *explanations* were not
  measured (needs the real model).
- Imports run at most `IMPORT_CONCURRENCY` (2) at a time. Per-owner limits default to 5 imports, 60 explanations and 120
  follow-ups per hour; per-IP import limit is 4× the owner limit.
- The rate limiter and queue are in memory: **do not run more than one instance** without replacing them (see ADR-06).
