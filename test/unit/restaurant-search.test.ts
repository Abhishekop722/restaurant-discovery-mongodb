import { describe, expect, it } from 'vitest';

import { RestaurantService } from '../../src/modules/restaurants/restaurant.service.js';
import type { QueryParser } from '../../src/modules/restaurants/search/nl-query-parser.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { createFakeRepository } from '../helpers/fake-repository.js';

interface SearchBody {
  interpretation: Record<string, unknown>;
  unparsedTerms: string[];
  data: Record<string, unknown>[];
  page: { limit: number; offset: number; hasMore: boolean };
  error?: { code: string; message: string; details?: { interpretation: Record<string, unknown> } };
}

const setup = () => {
  const fake = createFakeRepository();
  return { ...fake, app: buildTestApp(fake.repository) };
};

const search = async (app: ReturnType<typeof setup>['app'], q: string, extra = '') => {
  const url = `/v1/restaurants/search?${new URLSearchParams({ q }).toString()}${extra}`;
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json<SearchBody>() };
};

describe('the three example queries from the brief', () => {
  it('"Best restaurants in Gurgaon with South Indian Food"', async () => {
    const { app, repository } = setup();
    const { status, body } = await search(
      app,
      'Best restaurants in Gurgaon with South Indian Food',
    );

    expect(status).toBe(200);
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      tenantId: 'test-tenant',
      city: 'Gurgaon',
      cuisines: ['South Indian'],
      sort: 'best',
      ranking: { priorVotes: 100, priorMean: 3.4 },
    });
    expect(body.interpretation).toEqual({
      city: 'Gurgaon',
      cuisines: ['South Indian'],
      sort: 'best',
    });
    expect(body.unparsedTerms).toEqual([]);
  });

  it('"Restaurants in Gurgaon under Rs. 1000 for two"', async () => {
    const { app, repository } = setup();
    const { body } = await search(app, 'Restaurants in Gurgaon under Rs. 1000 for two');

    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      city: 'Gurgaon',
      maxCost: 1000,
      currency: 'INR',
      sort: '-rating',
    });
    expect(repository.list.mock.calls[0]?.[0].dish).toBeUndefined();
    expect(body.interpretation).toEqual({
      city: 'Gurgaon',
      maxCostForTwo: 1000,
      currency: 'INR',
      sort: '-rating',
    });
  });

  it('"Nearest place that serves Vada Pav" with a location', async () => {
    const { app, repository } = setup();
    const { body } = await search(
      app,
      'Nearest place that serves Vada Pav',
      '&lat=28.4595&lng=77.0266',
    );

    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      sort: 'distance',
      near: { lat: 28.4595, lng: 77.0266 },
      dish: { names: ['vada pav'], cuisines: [] },
    });
    expect(body.interpretation).toEqual({
      dish: ['vada pav'],
      nearestTo: { latitude: 28.4595, longitude: 77.0266 },
      sort: 'distance',
    });
  });

  it('"Nearest ..." without a location is a clear 400 that still shows the interpretation', async () => {
    const { app, repository } = setup();
    const { status, body } = await search(app, 'Nearest place that serves Vada Pav');

    expect(status).toBe(400);
    expect(body.error?.message).toMatch(/send lat and lng/);
    expect(body.error?.details?.interpretation).toMatchObject({
      dish: ['vada pav'],
      sort: 'distance',
    });
    expect(repository.list).not.toHaveBeenCalled();
  });
});

describe('how the parsed text and explicit parameters combine', () => {
  it('explicit parameters override what was parsed', async () => {
    const { app, repository } = setup();
    await search(
      app,
      'cheap south indian in gurgaon under 500',
      '&city=delhi&maxCost=900&sort=name',
    );

    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      city: 'New Delhi',
      maxCost: 900,
      sort: 'name',
      cuisines: ['South Indian'],
    });
  });

  it('reads an amount without a currency in the default currency, and honours a stated one', async () => {
    const fake = createFakeRepository();
    const service = new RestaurantService(fake.repository, 't', { defaultCurrency: 'USD' });
    const app = buildTestApp(fake.repository);
    const plain = await service.search({ q: 'cafes under 50', limit: 20, offset: 0 });
    expect(plain.interpretation).toMatchObject({ maxCostForTwo: 50, currency: 'USD' });

    const stated = await search(app, 'cafes under rs 50');
    expect(stated.body.interpretation).toMatchObject({ currency: 'INR' });
  });

  it('searches words nothing recognised as a name', async () => {
    const { app, repository } = setup();
    const { body } = await search(app, 'dominos in gurgaon');
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({ name: 'dominos', city: 'Gurgaon' });
    expect(body.unparsedTerms).toEqual(['dominos']);
    expect(body.interpretation).toMatchObject({ name: 'dominos' });
  });
});

describe('sorting and location in search', () => {
  it('passes "cheap" as a price range and "cheapest" as a cost sort', async () => {
    const { app, repository } = setup();
    await search(app, 'cheap north indian');
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({ maxPriceRange: 2, sort: '-rating' });
    await search(app, 'cheapest north indian');
    expect(repository.list.mock.calls[1]?.[0]).toMatchObject({ sort: 'cost' });
  });

  it('defaults to nearest first when a location is sent and the text says nothing about order', async () => {
    const { app, repository } = setup();
    await search(app, 'north indian', '&lat=28&lng=77&radiusKm=2');
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      sort: 'distance',
      near: { lat: 28, lng: 77, radiusKm: 2 },
    });
  });

  it('takes a radius from the text, but needs a location for it', async () => {
    const { app, repository } = setup();
    await search(app, 'north indian within 3 km', '&lat=28&lng=77');
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({ near: { radiusKm: 3 } });

    const noLocation = await search(app, 'north indian within 3 km');
    expect(noLocation.status).toBe(400);
  });

  it('lets an explicit sort=best be combined with a location', async () => {
    const { app, repository } = setup();
    await search(app, 'south indian', '&lat=28&lng=77&sort=best');
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({ sort: 'best', near: { lat: 28 } });
  });

  it('returns scores for best and omits them otherwise', async () => {
    const { app, setListResult } = setup();
    setListResult({
      hasMore: false,
      items: [
        {
          id: 'a'.repeat(24),
          name: 'X',
          addressLine: 'A',
          city: 'Gurgaon',
          country: 'India',
          cuisines: [],
          averageRating: 4.4,
          votes: 250,
          currency: 'INR',
          score: 4.0833,
        },
      ],
    });
    const { body } = await search(app, 'best cafes');
    expect(body.data[0]).toMatchObject({ score: 4.08, averageRating: 4.4 });
  });
});

describe('request validation', () => {
  it.each([
    ['missing q', '/v1/restaurants/search'],
    ['blank q', '/v1/restaurants/search?q=%20%20'],
    ['q over 200 characters', `/v1/restaurants/search?q=${'a'.repeat(201)}`],
    ['unknown parameter', '/v1/restaurants/search?q=x&foo=1'],
    ['sort=distance without a point', '/v1/restaurants/search?q=x&sort=distance'],
    ['lat without lng', '/v1/restaurants/search?q=x&lat=1'],
    ['limit above the cap', '/v1/restaurants/search?q=x&limit=101'],
  ])('rejects %s with 400', async (_label, url) => {
    const { app, repository } = setup();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(res.json<SearchBody>().error?.code).toBe('validation_error');
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('routes /search to the search handler, not to GET /:id', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/v1/restaurants/search' });
    const issues = res.json<{ error: { details: { in: string } } }>().error.details;
    expect(issues.in).toBe('querystring');
  });
});

describe('parser extension point', () => {
  it('uses whatever QueryParser it is given (for example an LLM-backed one)', async () => {
    const fake = createFakeRepository();
    const parser: QueryParser = {
      parse: () =>
        Promise.resolve({
          cuisines: ['North Indian'],
          best: false,
          nearest: false,
          cheapest: false,
          unparsedTerms: [],
          city: 'Noida',
        }),
    };
    const service = new RestaurantService(fake.repository, 't', { parser });
    const result = await service.search({ q: 'anything at all', limit: 20, offset: 0 });
    expect(result.interpretation).toMatchObject({ city: 'Noida', cuisines: ['North Indian'] });
  });
});
