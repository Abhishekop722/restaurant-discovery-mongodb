import type { FastifyInstance } from 'fastify';
import type { IndexDescriptionInfo } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Mongo } from '../../src/infra/mongo/client.js';
import { restaurantsCollection } from '../../src/infra/mongo/collections.js';
import { ensureIndexes, RESTAURANT_INDEXES } from '../../src/infra/mongo/indexes.js';
import { loadCsvRows } from '../../src/infra/seed/load-csv.js';
import { seedFromFile } from '../../src/infra/seed/seed.js';
import {
  buildGeoPipeline,
  buildMatch,
  buildSort,
} from '../../src/modules/restaurants/restaurant.mongo-query.js';
import { SAMPLE_CSV, startIntegrationApp } from '../helpers/integration-app.js';

const TENANT = 'test-tenant';

interface Item {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  cuisines: string[];
  averageRating: number | null;
  averageCostForTwo: number | null;
  currency: string;
  distanceKm?: number;
}
interface ListBody {
  data: Item[];
  page: { limit: number; offset: number; hasMore: boolean };
}

let mongo: Mongo;

const indexesOf = async (): Promise<IndexDescriptionInfo[]> =>
  (await restaurantsCollection(mongo.db).listIndexes().toArray()) as IndexDescriptionInfo[];
let app: FastifyInstance;

const get = async (url: string): Promise<{ status: number; body: unknown }> => {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() };
};
const list = async (query: string): Promise<ListBody> => {
  const { status, body } = await get(`/v1/restaurants?${query}`);
  expect(status).toBe(200);
  return body as ListBody;
};

const fixture = (name: string, latitude: number, longitude: number) => ({
  name,
  address: { line: `${name} street`, city: 'Testville', countryCode: 1 },
  location: { latitude, longitude },
  cuisines: ['Test Cuisine'],
  pricing: { averageCostForTwo: 500, priceRange: 2 },
});

let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startIntegrationApp(TENANT);
  ({ app, mongo, stop } = started);

  // three restaurants due north of (10, 20): ~0 km, ~1.11 km and ~5.57 km away (MongoDB uses a 6378.1 km Earth radius)
  for (const [name, lat] of [
    ['Far', 10.05],
    ['Near', 10],
    ['Mid', 10.01],
  ] as const) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/restaurants',
      payload: fixture(name, lat, 20),
    });
    expect(res.statusCode).toBe(201);
  }
});

afterAll(async () => {
  await stop();
});

describe('seed and indexes', () => {
  it('seeds every sample row and is idempotent', async () => {
    const rows = await loadCsvRows(SAMPLE_CSV);
    const again = await seedFromFile(mongo.db, SAMPLE_CSV, TENANT);
    expect(again).toMatchObject({
      read: rows.length,
      rejected: 0,
      inserted: 0,
      updated: rows.length,
    });
    const seeded = await restaurantsCollection(mongo.db).countDocuments({
      externalId: { $exists: true },
    });
    expect(seeded).toBe(rows.length);
  });

  it('creates exactly the declared indexes and re-running is a no-op', async () => {
    await ensureIndexes(mongo.db);
    const names = (await indexesOf()).map((i) => i.name);
    expect(names.sort()).toEqual(['_id_', ...RESTAURANT_INDEXES.map((i) => i.name)].sort());
  });

  it('replaces an index whose definition drifted, and drops undeclared ones', async () => {
    const collection = restaurantsCollection(mongo.db);
    await collection.dropIndex('tenant_city_rating');
    await collection.createIndexes([
      { key: { tenantId: 1 }, name: 'tenant_city_rating' },
      { key: { cuisines: 1 }, name: 'leftover' },
    ]);

    await ensureIndexes(mongo.db);

    const indexes = await indexesOf();
    expect(indexes.find((i) => i.name === 'leftover')).toBeUndefined();
    expect(Object.keys(indexes.find((i) => i.name === 'tenant_city_rating')?.key ?? {})).toContain(
      'rating.average',
    );
  });
});

describe('POST and GET by id', () => {
  const body = fixture('Round Trip', 12, 34);

  it('round-trips a created restaurant', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/restaurants', payload: body });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    const fetched = await get(`/v1/restaurants/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      name: 'Round Trip',
      location: { latitude: 12, longitude: 34 },
    });
  });

  it('allows many restaurants without an externalId (partial unique index)', async () => {
    const a = await app.inject({ method: 'POST', url: '/v1/restaurants', payload: body });
    const b = await app.inject({ method: 'POST', url: '/v1/restaurants', payload: body });
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
  });

  it('returns 409 for a duplicate externalId', async () => {
    const payload = { ...body, externalId: 987654321 };
    expect((await app.inject({ method: 'POST', url: '/v1/restaurants', payload })).statusCode).toBe(
      201,
    );
    const dup = await app.inject({ method: 'POST', url: '/v1/restaurants', payload });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<{ error: { code: string } }>().error.code).toBe('conflict');
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    expect((await get('/v1/restaurants/' + 'f'.repeat(24))).status).toBe(404);
  });
});

describe('GET /v1/restaurants filters and sorting', () => {
  it('matches the city case-insensitively and via aliases', async () => {
    const lower = await list('city=gurgaon&limit=50');
    const alias = await list('city=Gurugram&limit=50');
    expect(lower.data.length).toBeGreaterThan(0);
    expect(lower.data.every((r) => r.city === 'Gurgaon')).toBe(true);
    expect(alias.data.map((r) => r.id)).toEqual(lower.data.map((r) => r.id));
  });

  it('sorts best rated first by default, unrated last', async () => {
    const { data } = await list('city=Gurgaon&limit=100');
    const ratings = data.map((r) => r.averageRating);
    const rated = ratings.filter((r): r is number => r !== null);
    expect(rated).toEqual([...rated].sort((a, b) => b - a));
    expect(ratings.slice(0, rated.length).every((r) => r !== null)).toBe(true);
  });

  it('filters by cuisine, minimum rating and budget', async () => {
    const south = await list('city=Gurgaon&cuisine=south indian&limit=100');
    expect(south.data.length).toBeGreaterThan(0);
    expect(south.data.every((r) => r.cuisines.includes('South Indian'))).toBe(true);

    const good = await list('minRating=4.2&limit=100');
    expect(good.data.every((r) => (r.averageRating ?? 0) >= 4.2)).toBe(true);

    const cheap = await list('city=Gurgaon&maxCost=500&currency=INR&limit=100');
    expect(cheap.data.length).toBeGreaterThan(0);
    expect(cheap.data.every((r) => (r.averageCostForTwo ?? Infinity) <= 500)).toBe(true);
  });

  it('matches names case-insensitively as a substring', async () => {
    const { data } = await list('name=CAFE&limit=100');
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((r) => /cafe/i.test(r.name))).toBe(true);
  });

  it('pages without overlap and reports hasMore', async () => {
    const first = await list('city=Gurgaon&limit=5');
    const second = await list('city=Gurgaon&limit=5&offset=5');
    expect(first.page.hasMore).toBe(true);
    const firstIds = new Set(first.data.map((r) => r.id));
    expect(second.data.some((r) => firstIds.has(r.id))).toBe(false);
  });

  it('sorts by name ascending', async () => {
    const { data } = await list('city=Gurgaon&sort=name&limit=50');
    const names = data.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe('GET /v1/restaurants with a location', () => {
  it('orders by distance and reports it in km', async () => {
    const { data } = await list('lat=10&lng=20&radiusKm=10&city=Testville');
    expect(data.map((r) => r.name)).toEqual(['Near', 'Mid', 'Far']);
    // compare with a tolerance: the exact figure depends on the Earth radius MongoDB assumes
    const km = data.map((r) => r.distanceKm ?? NaN);
    [0, 1.11, 5.57].forEach((expected, i) => {
      expect(km[i]).toBeCloseTo(expected, 1);
    });
  });

  it('excludes results beyond the radius', async () => {
    const { data } = await list('lat=10&lng=20&radiusKm=2&city=Testville');
    expect(data.map((r) => r.name)).toEqual(['Near', 'Mid']);
  });

  it('keeps [lng, lat] order straight: swapped axes find nothing nearby', async () => {
    const { data } = await list('lat=20&lng=10&radiusKm=10&city=Testville');
    expect(data).toEqual([]);
  });

  it('supports other sorts together with a distance, and omits distance otherwise', async () => {
    const withPoint = await list('lat=28.46&lng=77.03&radiusKm=50&sort=-rating&limit=30');
    expect(withPoint.data.length).toBeGreaterThan(0);
    expect(withPoint.data.every((r) => typeof r.distanceKm === 'number')).toBe(true);
    const rated = withPoint.data.map((r) => r.averageRating).filter((r): r is number => r !== null);
    expect(rated).toEqual([...rated].sort((a, b) => b - a));

    const without = await list('city=Gurgaon&limit=3');
    expect(without.data.every((r) => r.distanceKm === undefined)).toBe(true);
  });

  it('finds the nearest South Indian place from a point in Gurgaon', async () => {
    const { data } = await list('lat=28.4595&lng=77.0266&cuisine=South Indian&limit=10');
    expect(data.length).toBeGreaterThan(0);
    const distances = data.map((r) => r.distanceKm ?? Infinity);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
});

describe('query plans', () => {
  const criteria = { tenantId: TENANT, sort: '-rating' as const, limit: 21, offset: 0 };
  const planOf = (explained: unknown): string => JSON.stringify(explained);

  it('serves a city listing sorted by rating from an index, with no in-memory sort', async () => {
    const explained = await restaurantsCollection(mongo.db)
      .find(buildMatch({ ...criteria, city: 'Gurgaon' }))
      .sort(buildSort('-rating'))
      .limit(21)
      .explain('queryPlanner');
    const plan = planOf(
      (explained as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan,
    );
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('"stage":"SORT"');
    expect(plan).not.toContain('COLLSCAN');
  });

  it('serves a geo query from the 2dsphere index', async () => {
    const near = { lat: 10, lng: 20, radiusKm: 5 };
    const c = { ...criteria, sort: 'distance' as const, near };
    const explained = await restaurantsCollection(mongo.db)
      .aggregate(buildGeoPipeline(c, near, 21))
      .explain('queryPlanner');
    expect(planOf(explained)).toContain('GEO_NEAR_2DSPHERE');
  });
});
