# Know Your Code

> *Understand the code you build.*

**Know Your Code (KYC)** is a free browser workspace for CS students. Paste a public GitHub repository URL, select any line of your own JavaScript/TypeScript code, and get a plain-language explanation. Alongside it you see the code's callers, callees and definitions, **computed by static analysis and linked to exact lines**, so every relationship is verifiable with a click.

Team Destruct · Construct 2.0

## Status

Planning complete, implementation not started. This repository currently holds the product documentation set (v1.0, 22 Oct 2026).

## The problem

Many undergraduates have projects that work but can't fully explain, trace or modify them. KYC aims to give them a working mental model of their own code. After a session, a student should be able to explain a function, say where its inputs come from, what depends on it, and describe one failure case, without the tool.

## How it works

1. Paste a public GitHub repo URL and watch staged processing.
2. Review the overview and file tree, then open a file in the read-only viewer.
3. Select code to get a grounded, streamed explanation plus **Verified** relations.
4. Go simpler or deeper, ask follow-ups, learn the underlying concept, and optionally check yourself.
5. Delete the repo when done, or let it auto-delete after 7 days.

## MVP scope

- **Must:** public GitHub import (JS/TS), staged progress, file tree, viewer, selection resolution, grounded explanations, Verified relations, depth control, follow-ups, concept chips, feedback, deletion/retention, rate limits.
- **Should (Week 3):** project summary, starting points, trace a value, local call diagram, check yourself.
- **Excluded:** accounts, private repos, other languages, code generation, embeddings, payments.

## Planned architecture

A TypeScript modular monolith on a Replit Reserved VM:

- Fastify API with an in-process job runner, and a React + Vite SPA
- PostgreSQL (with `pg_trgm`)
- Repo ingestion via GitHub tarball, then **ts-morph** analysis into symbols and `imports`/`calls` edges
- Claude API with a graph-based context pack and a **reference verifier** that strips any file/line not in the pack

## Documentation

All project documents live in [`docs/`](docs/). Start with [`docs/00_Master_Product_Blueprint.md`](docs/00_Master_Product_Blueprint.md), and see [`docs/README.md`](docs/README.md) for how the documents relate and who should read what.

| Doc | Topic |
|---|---|
| [00](docs/00_Master_Product_Blueprint.md) | Master product blueprint |
| [01](docs/01_Product_Requirements_Document.md) | Product requirements (source of truth) |
| [02](docs/02_User_Research_and_Validation.md) | User research and validation |
| [03](docs/03_Competitive_Analysis.md) | Competitive analysis |
| [04](docs/04_MVP_Scope_and_Prioritization.md) | MVP scope and prioritization |
| [05](docs/05_End_to_End_User_Flow.md) | End-to-end user flow |
| [06](docs/06_Product_Design_and_Design_System.md) | Product design and design system |
| [07](docs/07_System_Architecture.md) | System architecture |
| [08](docs/08_Repository_Ingestion_and_Code_Analysis.md) | Repository ingestion and code analysis |
| [09](docs/09_AI_System_Design_and_Prompts.md) | AI system design and prompts |
| [10](docs/10_API_and_Database_Specification.md) | API and database specification |
| [11](docs/11_Test_Strategy_and_AI_Evaluation.md) | Test strategy and AI evaluation |
| [12](docs/12_Three_Week_Sprint_and_Deployment_Plan.md) | Three-week sprint and deployment plan |
| [13](docs/13_Brand_Strategy_and_Positioning.md) | Brand strategy and positioning |
| [14](docs/14_Go_to_Market_and_Launch_Strategy.md) | Go-to-market and launch strategy |
| [99](docs/99_Consistency_Audit.md) | Consistency audit |

The original archive is kept at [`docs/archive/know-your-code-docs.zip`](docs/archive/know-your-code-docs.zip).

Requirements change in `docs/01` first; other documents implement it and must not redefine the product.
