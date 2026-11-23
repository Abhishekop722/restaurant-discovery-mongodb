# Contributing

## Setup

```bash
nvm use && corepack enable && pnpm install   # Node 22, pnpm 10
cp .env.example .env
docker compose up -d mongo                    # or point MONGODB_URI at any MongoDB
pnpm dev
```

Integration tests need Docker (Testcontainers).

## Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. Make small commits using Conventional Commits: `type(scope): subject` (max 72 chars).
   Types: feat, fix, docs, test, refactor, perf, build, ci, chore. Scopes: restaurants, search, seed,
   infra, docker, config, deps, ci, tooling, docs.
3. Run `pnpm check` (and `pnpm test:integration` if you touched queries or indexes).
4. Open a PR with a Conventional Commit title; CI must be green.

## Rules the tooling enforces

- `routes -> service -> repository port -> mongo adapter`; only `*.mongo-*.ts` and `src/infra` import `mongodb`.
- `process.env` is read only in `src/config`.
- The parser and schemas stay pure (no I/O).
- No unused exports or dependencies (knip); no circular imports.
- Coverage thresholds must hold.

## Adding things

- New endpoint: Zod schemas in `restaurant.schema.ts`, route with tags and error responses, service
  method, repository port method, adapter implementation, and unit and integration tests.
- New index: declare it in `src/infra/mongo/indexes.ts`; reconciliation applies it on start.
- Significant decision: add an ADR in `docs/adr/`.
