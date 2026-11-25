# 4. Natural-language search (rules first, optional LLM) and weighted ranking

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

## Update: optional Groq LLM parser

A second `QueryParser`, `LlmQueryParser`, is enabled when `GROQ_API_KEY` is set. It asks Groq's
OpenAI-compatible endpoint (JSON mode, temperature 0, low reasoning effort for gpt-oss models, 2 s timeout, default model `openai/gpt-oss-20b`, chosen as the smallest and cheapest Groq model with strict structured output) for the same fields, then
validates them with Zod and canonicalises city and cuisine against the stored vocabulary. The model
only fills fields; it never builds a query, so prompt injection cannot reach MongoDB. Any failure
falls back to the rule-based parser, and the response says which parser ran (`parsedBy`).
The provider call is an injected `LlmClient`, so another provider is one small adapter. Gemini was
considered and not added.
