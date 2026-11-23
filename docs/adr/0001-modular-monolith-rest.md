# 1. Stateless modular monolith with a REST API

Status: accepted

## Context

BiteExpress needs a discovery MVP that handles peak-hour load, multiple countries and tenants, and
may move off its current cloud. One small domain, one team.

## Decision

One deployable service exposing REST under `/v1`, organised in layers (routes, service, repository
port, Mongo adapter). No in-process state beyond caches and rate-limit counters.

## Consequences

- Horizontal scaling is "run more containers".
- Microservices were rejected: operational cost with no benefit at this size. Module boundaries are
  enforced (ESLint + dependency-cruiser), so a split stays possible.
- REST over GraphQL: four simple resources and cacheable GETs.
