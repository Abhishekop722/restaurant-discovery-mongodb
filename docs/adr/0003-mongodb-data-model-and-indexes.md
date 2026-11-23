# 3. MongoDB data model and indexes

Status: accepted

## Decision

- One `restaurants` collection, documents carrying `tenantId`, `externalId`, GeoJSON `location`
  (`[lng, lat]`), `cuisines[]`, `rating`, `pricing` and a country-derived currency.
- Indexes: `2dsphere` on location; compound indexes led by `tenantId` for city/rating/cost listings;
  a partial unique index on `(tenantId, externalId)`; a text index.
- `ensureIndexes` runs at start and reconciles: it replaces drifted and drops undeclared indexes.
- Missing data is omitted, never faked (no `0,0` coordinates, no `0` ratings).
- Queries use `maxTimeMS`; pagination uses limit+1 for `hasMore` and ends every sort in `_id`.

## Consequences

- Reads are single-collection and index-served; query plans are asserted in integration tests.
- Sorting on a field requires it to exist, since missing values sort first.
- City and cuisine input is canonicalised against cached vocabulary so equality matches use indexes.
