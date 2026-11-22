# restaurant-discovery-mongodb

Restaurant discovery API for BiteExpress, backed by MongoDB. Built as the MVP for the FDE take-home.

> Status: tooling, Docker, seeding, create/get/list and natural-language search done.

## Run with Docker

```bash
docker compose up --build        # API on :3000, MongoDB replica set on :27017
curl localhost:3000/health/ready
```

On first start the API creates indexes and, if the collection is empty, seeds it from
`data/zomato.csv` (full dataset, git-ignored) or else the committed `data/sample.csv`
(472 representative rows). Drop the Kaggle file at `data/zomato.csv` to load all 9,551.
Re-seed manually with `pnpm seed` (idempotent upsert on `tenantId + externalId`).

## API

| Endpoint                            | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `POST /v1/restaurants`              | Create; returns `201`, the entity and a `Location` header     |
| `GET /v1/restaurants/{id}`          | Full details; `404` if missing, `400` if the id is malformed  |
| `GET /v1/restaurants`               | Filter, sort and paginate; distance when `lat`/`lng` are sent |
| `GET /health/live`, `/health/ready` | Liveness and readiness (MongoDB ping)                         |

List parameters: `name` (contains), `city`, `cuisine` (repeat or comma-separate, any-of), `minRating`,
`maxCost` (+ `currency`), `lat` + `lng` (+ `radiusKm`), `sort`
(`rating|-rating|name|-name|cost|-cost|distance`), `limit` (default 20, max 100), `offset` (max 5000).
Unknown parameters are rejected with `400`, which also blocks operator-injection attempts.

```bash
# best-rated South Indian places in Gurgaon
curl 'localhost:3000/v1/restaurants?city=gurgaon&cuisine=south%20indian&limit=5'
# nearest places within 3 km of a point
curl 'localhost:3000/v1/restaurants?lat=28.4595&lng=77.0266&radiusKm=3'
```

Design notes: `city`/`cuisine` input is canonicalised against a cached vocabulary of the stored
values (so `gurgaon`, `Gurugram` and `GURGAON` are equality matches that use the indexes, not
case-insensitive regexes); every sort ends in `_id` for stable pagination; `$geoNear` is used only
when a point is given, and other sorts then run in memory over the radius-bounded set; errors share
one envelope with a request id; indexes are reconciled with the declared set on every start.

## Natural-language search

`GET /v1/restaurants/search?q=...` turns free text into the same filters the list endpoint uses
(it is a parsing layer, not a second query path). The response echoes `interpretation` and
`unparsedTerms`, so you can always see what was understood.

```bash
curl -G localhost:3000/v1/restaurants/search --data-urlencode 'q=Best restaurants in Gurgaon with South Indian Food'
curl -G localhost:3000/v1/restaurants/search --data-urlencode 'q=Restaurants in Gurgaon under Rs. 1000 for two'
curl -G localhost:3000/v1/restaurants/search --data-urlencode 'q=Nearest place that serves Vada Pav' \
  -d 'lat=28.4595&lng=77.0266'
```

| The text says                                                      | It becomes                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| a known city (`gurgaon`, `Gurugram`, `delhi`)                      | `city` (aliases resolve to the stored spelling)               |
| a known cuisine, singular or plural                                | `cuisine` filter (any-of)                                     |
| `under/below/max/up to` + amount (`Rs`, `₹`, `1.5k`, `per person`) | `maxCost` (+ currency; per-person is doubled)                 |
| `rated above 4`, `4+ stars`, `at least 3.5`                        | `minRating`                                                   |
| `nearest`, `closest`, `near me`, `nearby`                          | sort by distance (needs `lat` and `lng`, else a clear `400`)  |
| `within 3 km`, `within 500 m`                                      | `radiusKm` (needs `lat` and `lng`)                            |
| `best`, `top rated`, `highly rated`                                | sort by weighted score (see below)                            |
| `cheap` / `cheapest`                                               | price range <= 2 / sort by cost                               |
| a dish (`vada pav`, `dosa`, `biryani`...)                          | name match, plus a cuisine only where the cuisine is the dish |
| anything unrecognised                                              | name search, listed in `unparsedTerms`                        |

Explicit parameters (`city`, `cuisine`, `maxCost`, `sort`, ...) override what was parsed.

**"Best" is not "highest average".** A 5.0 from 3 votes should not beat a 4.5 from 300, so it
ranks by the Bayesian weighted score `v/(v+m) * R + m/(v+m) * C` (R = rating, v = votes,
C = mean rating of all rated restaurants, m = `RANKING_MIN_VOTES`, default 100; the dataset's median
is about 60 votes). Only rated restaurants take part, and the score is returned with each result.
The formula is computed in MongoDB and checked against a plain TypeScript implementation in tests.

**Honest limits**

- The dataset has cuisines, not dishes. "Vada pav" matches restaurants _named_ that (the data has
  such places, all typed `Street Food`); it deliberately does not return every street-food stall.
  A dish with no matching name returns nothing rather than something unrelated.
- A currency is assumed (`DEFAULT_CURRENCY`, default `INR`) when an amount names none; `$` means USD.
- Free-text name search is a case-insensitive regex, because `$text` cannot be combined with
  `$geoNear`. It is bounded by the other filters; Atlas Search would replace it.
- The weighted sort runs in memory over the filtered set (fine at this scale; a precomputed
  score field would be the next step).
- The parser sits behind a `QueryParser` interface, so an LLM-backed parser that fills the same
  structure (validated, with this one as fallback) can be added without touching the rest.

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
