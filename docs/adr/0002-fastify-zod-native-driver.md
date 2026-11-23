# 2. Fastify, Zod and the native MongoDB driver

Status: accepted

## Decision

Node 22, TypeScript, Fastify 5, Zod for validation (shared by runtime, types and OpenAPI via
`fastify-type-provider-zod`), and the official `mongodb` driver. No ODM.

## Consequences

- One schema produces validation, TypeScript types and the `/docs` OpenAPI spec.
- Aggregation and `$geoNear` pipelines are written directly; they live in one file and are unit-tested.
- Mongoose was rejected: its abstractions add little for a single collection and hide pipeline details.
- Only adapters and `src/infra` may import the driver, which keeps the service testable with a fake.
