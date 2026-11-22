# restaurant-discovery-mongodb

Restaurant discovery API for BiteExpress, backed by MongoDB. Built as the MVP for the FDE take-home.

> Status: block 0 (tooling skeleton). Endpoints, Docker and seed data follow in later commits.

## Quick start

```bash
nvm use            # Node 22
corepack enable    # pnpm
pnpm install
pnpm dev           # http://localhost:3000/health/live
```

## Commands

| Command                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `pnpm check`                | format check, lint, typecheck, tests (same as CI) |
| `pnpm lint` / `lint:fix`    | ESLint (type-aware, strict)                       |
| `pnpm format`               | Prettier                                          |
| `pnpm test` / `test:unit`   | Vitest                                            |
| `pnpm build` / `pnpm start` | Compile to `dist/` and run                        |

## Conventions (enforced by tooling, not by memory)

- **Commits:** Conventional Commits, validated by commitlint (`type(scope): subject`, max 72 chars).
  Allowed scopes: restaurants, search, seed, infra, docker, config, deps, ci, tooling, docs.
- **Hooks (Husky):** `pre-commit` runs lint-staged (ESLint + Prettier on staged files),
  `commit-msg` runs commitlint, `pre-push` runs typecheck and unit tests.
- **CI is the real gate:** GitHub Actions repeats format, lint, typecheck, test and build.
- **Layering:** `routes -> service -> repository (interface)`. Only `*.mongo-repository.ts`,
  `src/infra/` (and scripts/tests) may import `mongodb`; `process.env` is read only in `src/config/`.
  Violations fail ESLint.

## Tools and resources used

- Claude (Anthropic) was used as a coding assistant for planning and scaffolding. All code is
  reviewed and owned by the author.
