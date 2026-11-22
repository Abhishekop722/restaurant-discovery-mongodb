import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { restaurantsCollection } from '../../src/infra/mongo/collections.js';
import { cleanRow } from '../../src/infra/seed/clean-row.js';
import { loadCsvRows } from '../../src/infra/seed/load-csv.js';
import type { RestaurantDoc } from '../../src/modules/restaurants/restaurant.schema.js';
import { weightedScore } from '../../src/modules/restaurants/search/ranking.js';
import {
  SAMPLE_CSV,
  startIntegrationApp,
  type IntegrationApp,
} from '../helpers/integration-app.js';

const TENANT = 'search-tenant';
const PRIOR_VOTES = 100; // service default
const GURGAON = 'lat=28.4595&lng=77.0266';

interface Item {
  id: string;
  name: string;
  city: string;
  cuisines: string[];
  averageRating: number | null;
  votes: number;
  averageCostForTwo: number | null;
  currency: string;
  distanceKm?: number;
  score?: number;
}
interface SearchBody {
  interpretation: Record<string, unknown>;
  unparsedTerms: string[];
  data: Item[];
  page: { hasMore: boolean };
}

let ctx: IntegrationApp;
let app: FastifyInstance;
let docs: RestaurantDoc[]; // independent oracle: the sample CSV cleaned in plain JS

const search = async (q: string, extra = ''): Promise<{ status: number; body: SearchBody }> => {
  const url = `/v1/restaurants/search?${new URLSearchParams({ q }).toString()}${extra}`;
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json<SearchBody>() };
};
const ok = async (q: string, extra = ''): Promise<SearchBody> => {
  const { status, body } = await search(q, extra);
  expect(status).toBe(200);
  return body;
};

const priorMean = (): number => {
  const rated = docs.flatMap((d) => (d.rating.average === undefined ? [] : [d.rating.average]));
  return rated.reduce((sum, r) => sum + r, 0) / rated.length;
};
const descending = (values: number[]): boolean =>
  values.every((v, i) => i === 0 || (values[i - 1] ?? Infinity) >= v);

beforeAll(async () => {
  ctx = await startIntegrationApp(TENANT);
  app = ctx.app;
  const rows = await loadCsvRows(SAMPLE_CSV);
  docs = rows.flatMap((row) => {
    const cleaned = cleanRow(row, TENANT);
    return cleaned.ok ? [cleaned.doc] : [];
  });
});

afterAll(async () => {
  await ctx.stop();
});

describe('"Best restaurants in Gurgaon with South Indian Food"', () => {
  it('returns only rated Gurgaon South Indian places, ordered by the weighted score', async () => {
    const body = await ok('Best restaurants in Gurgaon with South Indian Food', '&limit=50');

    expect(body.interpretation).toEqual({
      city: 'Gurgaon',
      cuisines: ['South Indian'],
      sort: 'best',
    });
    expect(body.data.length).toBeGreaterThan(1);
    expect(
      body.data.every((r) => r.city === 'Gurgaon' && r.cuisines.includes('South Indian')),
    ).toBe(true);
    expect(body.data.every((r) => r.averageRating !== null)).toBe(true);

    // the database computed the same score as our reference implementation
    const mean = priorMean();
    const expected = body.data.map((r) =>
      weightedScore(r.averageRating ?? 0, r.votes, PRIOR_VOTES, mean),
    );
    body.data.forEach((r, i) => {
      expect(Math.abs((r.score ?? NaN) - (expected[i] ?? NaN))).toBeLessThan(0.011);
    });
    expect(descending(expected)).toBe(true);
  });

  it('ranks established ratings above a perfect score from almost no votes', async () => {
    const base = {
      tenantId: TENANT,
      address: {
        line: 'x',
        locality: '',
        localityVerbose: '',
        city: 'Rankville',
        countryCode: 1,
        country: 'India',
      },
      cuisines: ['Cafe'],
      pricing: { currency: 'INR', priceRange: 2 },
      flags: {
        hasTableBooking: false,
        hasOnlineDelivery: false,
        isDeliveringNow: false,
        switchToOrderMenu: false,
      },
      schemaVersion: 1 as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await restaurantsCollection(ctx.mongo.db).insertMany([
      { ...base, name: 'Hyped', rating: { average: 5, votes: 2, text: 'Excellent' } },
      { ...base, name: 'Proven', rating: { average: 4.5, votes: 400, text: 'Excellent' } },
      { ...base, name: 'Unrated', rating: { text: 'Not rated', votes: 0 } },
    ]);

    const body = await ok('best', '&city=Rankville');
    expect(body.data.map((r) => r.name)).toEqual(['Proven', 'Hyped']); // Unrated is excluded
  });

  it('keeps the score order when a location is also given', async () => {
    const body = await ok('best south indian', `&${GURGAON}&radiusKm=30&limit=30`);
    expect(body.data.length).toBeGreaterThan(1);
    expect(body.data.every((r) => typeof r.distanceKm === 'number')).toBe(true);
    expect(descending(body.data.map((r) => r.score ?? NaN))).toBe(true);
  });
});

describe('"Restaurants in Gurgaon under Rs. 1000 for two"', () => {
  it('returns exactly the Gurgaon restaurants priced up to 1000 INR', async () => {
    const body = await ok('Restaurants in Gurgaon under Rs. 1000 for two', '&limit=100');
    const expected = docs.filter(
      (d) =>
        d.address.city === 'Gurgaon' &&
        d.pricing.currency === 'INR' &&
        d.pricing.averageCostForTwo !== undefined &&
        d.pricing.averageCostForTwo <= 1000,
    ).length;

    expect(body.interpretation).toEqual({
      city: 'Gurgaon',
      maxCostForTwo: 1000,
      currency: 'INR',
      sort: '-rating',
    });
    expect(body.data).toHaveLength(Math.min(100, expected));
    expect(
      body.data.every(
        (r) =>
          r.city === 'Gurgaon' && r.currency === 'INR' && (r.averageCostForTwo ?? Infinity) <= 1000,
      ),
    ).toBe(true);
  });

  it('treats "cheap" as a price range of at most 2', async () => {
    const body = await ok('cheap north indian in gurgaon', '&limit=30');
    expect(body.data.length).toBeGreaterThan(0);
    const stored = await restaurantsCollection(ctx.mongo.db)
      .find({ _id: { $in: body.data.map((r) => new ObjectId(r.id)) } })
      .toArray();
    expect(stored.every((d) => d.pricing.priceRange <= 2)).toBe(true);
  });

  it('"cheapest" sorts by cost ascending and never lists a restaurant with no cost', async () => {
    const body = await ok('cheapest south indian in gurgaon', '&limit=50');
    const costs = body.data.map((r) => r.averageCostForTwo);
    expect(costs.every((c) => c !== null && c > 0)).toBe(true);
    const numeric = costs.map((c) => c ?? NaN);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  });
});

describe('"Nearest place that serves Vada Pav"', () => {
  const isVadaPav = (d: RestaurantDoc): boolean => /vada\s*pav/i.test(d.name);

  it('lists only vada pav places, nearest first', async () => {
    const body = await ok('Nearest place that serves Vada Pav', `&${GURGAON}&limit=50`);
    const expected = docs.filter((d) => isVadaPav(d) && d.location).length;

    expect(body.interpretation).toMatchObject({ dish: ['vada pav'], sort: 'distance' });
    expect(expected).toBeGreaterThan(5);
    expect(body.data).toHaveLength(Math.min(50, expected));
    expect(body.data.every((r) => /vada\s*pav/i.test(r.name))).toBe(true);

    const km = body.data.map((r) => r.distanceKm ?? NaN);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    expect(body.data[0]?.city).toBe('Gurgaon'); // the nearest one is in Gurgaon, not Delhi
  });

  it('does not return unrelated street-food places', async () => {
    const body = await ok('vada pav', `&${GURGAON}&limit=100`);
    expect(body.data.every((r) => /vada\s*pav/i.test(r.name))).toBe(true);
  });

  it('is a clear 400 without a location, naming what was understood', async () => {
    const { status, body } = await search('Nearest place that serves Vada Pav');
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('send lat and lng');
    expect(JSON.stringify(body)).toContain('vada pav');
  });
});

describe('combining text, parameters and fallbacks', () => {
  it('lets an explicit city override the one in the text', async () => {
    const body = await ok('restaurants in gurgaon', '&city=Noida&limit=50');
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((r) => r.city === 'Noida')).toBe(true);
  });

  it('searches unrecognised words as a name', async () => {
    const body = await ok('goli');
    expect(body.unparsedTerms).toEqual(['goli']);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((r) => /goli/i.test(r.name))).toBe(true);
  });

  it('applies a minimum rating from the text', async () => {
    const body = await ok('north indian in new delhi rated above 4', '&limit=50');
    expect(body.interpretation).toMatchObject({ city: 'New Delhi', minRating: 4 });
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((r) => (r.averageRating ?? 0) >= 4)).toBe(true);
  });

  it('pages without overlap', async () => {
    const first = await ok('best north indian in new delhi', '&limit=5');
    const second = await ok('best north indian in new delhi', '&limit=5&offset=5');
    expect(first.page.hasMore).toBe(true);
    const seen = new Set(first.data.map((r) => r.id));
    expect(second.data.some((r) => seen.has(r.id))).toBe(false);
  });

  it('routes /search to the search handler rather than treating it as an id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/restaurants/search' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { details: { in: string } } }>().error.details.in).toBe('querystring');
  });
});
