# 5. Quality gates enforced by tooling

Status: accepted

## Decision

Strict TypeScript and type-aware ESLint; Prettier; Conventional Commits via commitlint; Husky hooks
(pre-commit lint-staged, commit-msg, pre-push); dependency-cruiser for layering; knip for unused
code; Vitest coverage thresholds; GitHub Actions running all of it plus a Docker smoke test;
Dependabot for updates.

## Consequences

- Local hooks give fast feedback, but CI is the authority because hooks can be skipped.
- Rules live in config files, so they apply equally to every contributor.
- Branch protection (require CI, reviews) must be enabled in GitHub settings; it is not a file.
