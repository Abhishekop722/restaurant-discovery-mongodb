# restaurant-discovery-mongodb

Restaurant discovery API for BiteExpress, backed by MongoDB. Built as the MVP for the FDE take-home.

> Status: tooling, Docker stack and data seeding done. REST endpoints follow in later commits.

## Run with Docker

```bash
docker compose up --build        # API on :3000, MongoDB replica set on :27017
curl localhost:3000/health/ready
```

On first start the API creates indexes and, if the collection is empty, seeds it from
`data/zomato.csv` (full dataset, git-ignored) or else the committed `data/sample.csv`
(472 representative rows). Drop the Kaggle file at `data/zomato.csv` to load all 9,551.
Re-seed manually with `pnpm seed` (idempotent upsert on `tenantId + externalId`).

## Data cleaning decisions

| Source quirk                                               | Handling                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| File is not valid UTF-8 (some names are mojibake)          | Strict UTF-8 first, Latin-1 fallback; corrupted names kept as is |
| `Currency` column is wrong (Philippines = "Botswana Pula") | Currency derived from the country code                           |
| 497 rows with `0,0` coordinates                            | `location` omitted, never stored as 0,0                          |
| 2,148 unrated rows (rating 0)                              | `rating.average` omitted so 0 does not skew averages; votes kept |
| 18 rows with cost for two = 0                              | `pricing.averageCostForTwo` omitted                              |
| 9 rows with no cuisines                                    | `cuisines: []`                                                   |
| Comma-separated `Cuisines` string                          | Trimmed, de-duplicated array (multikey index)                    |

Lat/lng become a GeoJSON `Point` as `[longitude, latitude]` for the `2dsphere` index.

## Quick start (without Docker)

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
