# Know Your Code

A learning-first codebase understanding platform: desktop frontend, cloud runtime and a shared core (local runtime deferred).

## Source of truth

All project documentation lives in [`project-docs/`](project-docs/). Start with
[`00_Engineering_Decision_Document.md`](project-docs/00_Engineering_Decision_Document.md); the seven audits it is built on
are `01`–`07` in the same folder. Agent and contributor rules are in [`CLAUDE.md`](CLAUDE.md).

## Quick start (current code, branch `V1_KYC`)

Requirements: Node.js ≥ 20.12, PostgreSQL ≥ 14 with `pg_trgm` and `pgcrypto`.

```bash
npm install
cp .env.example .env              # set DATABASE_URL; LLM_PROVIDER=fake runs without an AI key
npm run dev                       # API on :8080, web app on http://localhost:5173
npm run check                     # typecheck, lint, format check, unit and integration tests
```

Production builds must set `NODE_ENV=production` explicitly (see risk S1 in the decision document).
