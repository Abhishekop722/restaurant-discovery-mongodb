# 3. MongoDB data model and indexes

Status: accepted

## Decision

- One `restaurants` collection, documents carrying `tenantId`, `externalId`, GeoJSON `location`
  (`[lng, lat]`), `cuisines[]`, `rating`, `pricing` and a country-derived currency.
- Indexes (no text index: name search is a bounded regex, since `$text` cannot combine with `$geoNear`): `2dsphere` on location; compound indexes led by `tenantId` for city/rating/cost listings;
  a partial unique index on `(tenantId, externalId)`.
- `ensureIndexes` runs at start and reconciles: it replaces drifted and drops undeclared indexes.
- Creates accept an optional `Idempotency-Key`; it is stored on the document (with a hash of the body) behind a partial unique `(tenantId, idempotency.key)` index, so retries and concurrent duplicates return the original instead of inserting twice.
- Missing data is omitted, never faked (no `0,0` coordinates, no `0` ratings).
- Queries use `maxTimeMS`; pagination uses limit+1 for `hasMore` and ends every sort in `_id`.

## Consequences

- Reads are single-collection and index-served; query plans are asserted in integration tests.
- Sorting on a field requires it to exist, since missing values sort first.
- City and cuisine input is canonicalised against cached vocabulary so equality matches use indexes.
