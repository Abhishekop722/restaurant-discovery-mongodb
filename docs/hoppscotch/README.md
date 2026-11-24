# Hoppscotch collection

1. Hoppscotch → Collections → Import → "Hoppscotch" → choose `biteexpress.collection.json`.
2. Environments → Import → `biteexpress.environment.json`, then select "BiteExpress local".
3. Start the API (`docker compose up --build`) and run the requests.

`baseUrl` defaults to `http://localhost:3000`. The create requests save the new id into
`restaurantId`, which "Get by id" uses. For the idempotency demo, send "Create with Idempotency-Key"
twice (201 then 200); change the header value to create another restaurant.
