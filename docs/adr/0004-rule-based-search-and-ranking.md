# 4. Rule-based natural-language search and weighted ranking

Status: accepted

## Decision

`/v1/restaurants/search` parses text with a pure, deterministic parser (city, cuisine, price, rating,
radius, proximity, "best", "cheap", dishes) into the same criteria the list endpoint uses. Unknown
words become a name search. The response echoes the interpretation. "Best" uses the Bayesian score
`v/(v+m)*R + m/(v+m)*C` with `m = RANKING_MIN_VOTES` (default 100).

## Consequences

- Predictable, free, fast and fully testable; behaviour is explainable to the caller.
- Coverage of phrasing is limited. The parser sits behind a `QueryParser` interface so an
  LLM-backed parser (validated, with this one as fallback) can be added later.
- The dataset has no dishes, so dish queries match restaurant names only; this is documented.
