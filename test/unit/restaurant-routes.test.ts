import { describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/build-test-app.js';
import { createFakeRepository } from '../helpers/fake-repository.js';

const validBody = {
  name: 'Saravana Bhavan',
  address: { line: 'Sector 29', locality: 'Sector 29', city: 'gurgaon', countryCode: 1 },
  location: { latitude: 28.4595, longitude: 77.0266 },
  cuisines: ['south indian'],
  pricing: { averageCostForTwo: 600, priceRange: 2 },
};

const setup = () => {
  const fake = createFakeRepository();
  return { ...fake, app: buildTestApp(fake.repository) };
};

interface ErrorEnvelope {
  error: { code: string; requestId: string; details?: unknown };
}
const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorEnvelope).error;

interface CreatedBody {
  id: string;
  address: Record<string, unknown>;
  cuisines: string[];
  pricing: Record<string, unknown>;
  location: unknown;
  rating: unknown;
}

describe('POST /v1/restaurants', () => {
  it('creates, canonicalises and returns the entity with a Location header', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/v1/restaurants', payload: validBody });

    expect(res.statusCode).toBe(201);
    const body = res.json<CreatedBody>();
    expect(res.headers.location).toBe(`/v1/restaurants/${body.id}`);
    expect(body.address).toMatchObject({ city: 'Gurgaon', country: 'India' });
    expect(body.cuisines).toEqual(['South Indian']);
    expect(body.pricing).toMatchObject({ currency: 'INR', averageCostForTwo: 600 });
    expect(body.location).toEqual({ latitude: 28.4595, longitude: 77.0266 });
    expect(body.rating).toEqual({ average: null, votes: 0, text: 'Not rated' });
  });

  it('stores GeoJSON as [longitude, latitude]', async () => {
    const { app, repository } = setup();
    await app.inject({ method: 'POST', url: '/v1/restaurants', payload: validBody });
    const doc = repository.create.mock.calls[0]?.[0];
    expect(doc?.location?.coordinates).toEqual([77.0266, 28.4595]);
    expect(doc?.tenantId).toBe('test-tenant');
  });

  it.each([
    ['missing name', { ...validBody, name: '' }],
    ['latitude out of range', { ...validBody, location: { latitude: 91, longitude: 0 } }],
    ['unknown field', { ...validBody, rating: 5 }],
    ['price range out of range', { ...validBody, pricing: { priceRange: 9 } }],
  ])('rejects %s with 400 and the error envelope', async (_label, payload) => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/v1/restaurants', payload });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('validation_error');
    expect(errorOf(res).requestId).toBeTruthy();
  });

  it('rejects an unknown country code', async () => {
    const { app } = setup();
    const payload = { ...validBody, address: { ...validBody.address, countryCode: 9999 } };
    const res = await app.inject({ method: 'POST', url: '/v1/restaurants', payload });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('bad_request');
  });
});

describe('GET /v1/restaurants/:id', () => {
  it('returns the stored restaurant', async () => {
    const { app } = setup();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/restaurants',
      payload: validBody,
    });
    const { id } = created.json<{ id: string }>();
    const res = await app.inject({ method: 'GET', url: `/v1/restaurants/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('Saravana Bhavan');
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const { app } = setup();
    const missing = await app.inject({ method: 'GET', url: `/v1/restaurants/${'a'.repeat(24)}` });
    expect(missing.statusCode).toBe(404);
    expect(errorOf(missing).code).toBe('not_found');
    const malformed = await app.inject({ method: 'GET', url: '/v1/restaurants/not-an-id' });
    expect(malformed.statusCode).toBe(400);
  });
});

describe('GET /v1/restaurants', () => {
  it('canonicalises filters and defaults to best-rated first', async () => {
    const { app, repository } = setup();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/restaurants?city=gurugram&cuisine=south%20indian,STREET FOOD&minRating=4',
    });
    expect(res.statusCode).toBe(200);
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      tenantId: 'test-tenant',
      city: 'Gurgaon',
      cuisines: ['South Indian', 'Street Food'],
      minRating: 4,
      sort: '-rating',
      limit: 20,
      offset: 0,
    });
  });

  it('defaults to nearest first when a point is given', async () => {
    const { app, repository } = setup();
    await app.inject({ method: 'GET', url: '/v1/restaurants?lat=28.45&lng=77.02&radiusKm=2' });
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      sort: 'distance',
      near: { lat: 28.45, lng: 77.02, radiusKm: 2 },
    });
  });

  it('maps rows to the response shape, with distance only when present', async () => {
    const { app, setListResult } = setup();
    setListResult({
      hasMore: true,
      items: [
        {
          id: 'a'.repeat(24),
          name: 'X',
          addressLine: 'Addr',
          city: 'Gurgaon',
          country: 'India',
          cuisines: ['Cafe'],
          averageRating: 4.2,
          votes: 10,
          currency: 'INR',
          distanceMeters: 1234.567,
        },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/v1/restaurants?limit=1&lat=1&lng=2' });
    expect(res.json()).toEqual({
      data: [
        {
          id: 'a'.repeat(24),
          name: 'X',
          address: 'Addr',
          city: 'Gurgaon',
          country: 'India',
          cuisines: ['Cafe'],
          averageRating: 4.2,
          votes: 10,
          averageCostForTwo: null,
          currency: 'INR',
          distanceKm: 1.23,
        },
      ],
      page: { limit: 1, offset: 0, hasMore: true },
    });
  });
});

describe('GET /v1/restaurants validation', () => {
  it.each([
    ['lat without lng', 'lat=28'],
    ['sort=distance without a point', 'sort=distance'],
    ['radiusKm without a point', 'radiusKm=3'],
    ['limit above the cap', 'limit=1000'],
    ['offset above the cap', 'offset=999999'],
    ['rating out of range', 'minRating=6'],
    ['unknown sort key', 'sort=price'],
    ['unknown parameter', 'foo=bar'],
    ['operator injection attempt', 'city[$ne]=x'],
  ])('rejects %s with 400', async (_label, query) => {
    const { app, repository } = setup();
    const res = await app.inject({ method: 'GET', url: `/v1/restaurants?${query}` });
    expect(res.statusCode).toBe(400);
    expect(repository.list).not.toHaveBeenCalled();
  });
});
