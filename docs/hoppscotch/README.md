# Hoppscotch collection

Import (Collections -> Import -> "Import from Hoppscotch" / JSON file): `biteexpress.collection.json`.
Environments -> Import: `biteexpress.environment.json`, then select "BiteExpress local".

`baseUrl` defaults to `http://localhost:3000`. The create requests save the new id into
`restaurantId`, which "Get by id" uses. For the idempotency demo, send "Create with Idempotency-Key"
twice (201 then 200); change the header value to create another restaurant.

Alternative: with the API running, import `http://localhost:3000/docs/json` as an OpenAPI source.
