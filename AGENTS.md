# Notes for AI coding agents

- Run `pnpm check` before committing; it mirrors CI. Run `pnpm test:integration` for query/index changes (needs Docker).
- Respect the layering in CONTRIBUTING.md; `pnpm deps:check` fails on violations.
- Use Conventional Commits with the allowed scopes; keep commits small.
- Never read `process.env` outside `src/config`; never import `mongodb` outside adapters/`src/infra`.
- `$geoNear` must be the first pipeline stage; coordinates are `[lng, lat]`.
- Do not commit `data/zomato.csv` (git-ignored) or secrets.
- Update the README and add an ADR when behaviour or a major decision changes.
