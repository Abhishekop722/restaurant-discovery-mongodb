/**
 * End-to-end smoke test against a RUNNING stack (docker compose up).
 *   pnpm test:e2e                      # http://localhost:3000
 *   BASE_URL=https://host pnpm test:e2e
 * It only needs the seeded sample (or full) dataset; it does not depend on exact counts.
 */
import assert from 'node:assert/strict';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const GURGAON = 'lat=28.4595&lng=77.0266';

interface Item {
  name: string;
  city: string;
  cuisines: string[];
  averageCostForTwo: number | null;
  currency: string;
  distanceKm?: number;
}
interface Page {
  data: Item[];
  page: { hasMore: boolean };
  interpretation?: Record<string, unknown>;
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, headers: res.headers, body: await res.json() };
}
const search = async (q: string, extra = ''): Promise<Page> => {
  const { status, body } = await call(
    `/v1/restaurants/search?${new URLSearchParams({ q }).toString()}${extra}`,
  );
  assert.equal(status, 200);
  return body as Page;
};

const checks: [string, () => Promise<void>][] = [
  [
    'readiness reports MongoDB reachable',
    async () => {
      const { status, body } = await call('/health/ready');
      assert.equal(status, 200);
      assert.deepEqual(body, { status: 'ok' });
    },
  ],
  [
    'responses carry a request id',
    async () => {
      const { headers } = await call('/health/live');
      assert.ok(headers.get('x-request-id'));
    },
  ],
  [
    'list filters by city and pages',
    async () => {
      const { status, body } = await call('/v1/restaurants?city=Gurgaon&limit=5');
      const page = body as Page;
      assert.equal(status, 200);
      assert.equal(page.data.length, 5);
      assert.ok(page.data.every((r) => r.city === 'Gurgaon'));
      assert.equal(page.page.hasMore, true);
    },
  ],
  [
    'search: best restaurants in Gurgaon with South Indian food',
    async () => {
      const page = await search('Best restaurants in Gurgaon with South Indian Food');
      assert.deepEqual(page.interpretation, {
        city: 'Gurgaon',
        cuisines: ['South Indian'],
        sort: 'best',
      });
      assert.ok(page.data.length > 0);
      assert.ok(
        page.data.every((r) => r.city === 'Gurgaon' && r.cuisines.includes('South Indian')),
      );
    },
  ],
  [
    'search: Gurgaon under Rs. 1000 for two',
    async () => {
      const page = await search('Restaurants in Gurgaon under Rs. 1000 for two', '&limit=50');
      assert.ok(page.data.length > 0);
      assert.ok(
        page.data.every((r) => r.currency === 'INR' && (r.averageCostForTwo ?? Infinity) <= 1000),
      );
    },
  ],
  [
    'search: nearest vada pav, closest first',
    async () => {
      const page = await search('Nearest place that serves Vada Pav', `&${GURGAON}`);
      assert.ok(page.data.length > 0);
      assert.ok(page.data.every((r) => /vada\s*pav/i.test(r.name)));
      const km = page.data.map((r) => r.distanceKm ?? NaN);
      assert.deepEqual(
        km,
        [...km].sort((a, b) => a - b),
      );
    },
  ],
  [
    'create then fetch a restaurant',
    async () => {
      const payload = {
        name: 'Smoke Test Kitchen',
        address: { line: '1 Test Road', city: 'gurgaon', countryCode: 1 },
        location: { latitude: 28.46, longitude: 77.03 },
        cuisines: ['south indian'],
        pricing: { averageCostForTwo: 450, priceRange: 1 },
      };
      const created = await call('/v1/restaurants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(created.status, 201);
      const location = created.headers.get('location');
      assert.ok(location);
      assert.ok(location.startsWith('/v1/restaurants/'));
      const fetched = await call(location);
      assert.equal(fetched.status, 200);
      assert.equal((fetched.body as { address: { city: string } }).address.city, 'Gurgaon');
    },
  ],
  [
    'errors use the envelope: 404, 400',
    async () => {
      const missing = await call(`/v1/restaurants/${'a'.repeat(24)}`);
      assert.equal(missing.status, 404);
      assert.equal((missing.body as { error: { code: string } }).error.code, 'not_found');
      assert.equal((await call('/v1/restaurants/not-an-id')).status, 400);
      assert.equal((await call('/v1/restaurants/search')).status, 400);
    },
  ],
  [
    'OpenAPI docs are served',
    async () => {
      const { status, body } = await call('/docs/json');
      assert.equal(status, 200);
      assert.ok((body as { paths: object }).paths);
    },
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
console.log(
  failed === 0
    ? `\nall ${checks.length} smoke checks passed`
    : `\n${failed} of ${checks.length} smoke checks failed`,
);
process.exit(failed === 0 ? 0 : 1);
