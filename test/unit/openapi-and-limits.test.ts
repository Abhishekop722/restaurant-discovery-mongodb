import { describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/build-test-app.js';
import { createFakeRepository } from '../helpers/fake-repository.js';

interface OpenApi {
  openapi: string;
  paths: Record<string, Record<string, { tags?: string[]; responses: Record<string, unknown> }>>;
}

describe('OpenAPI document', () => {
  const app = buildTestApp(createFakeRepository().repository);

  it('is served as JSON and lists every endpoint with its error responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<OpenApi>();

    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/health/live',
      '/health/ready',
      '/v1/restaurants',
      '/v1/restaurants/search',
      '/v1/restaurants/{id}',
    ]);
    expect(Object.keys(doc.paths['/v1/restaurants'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(doc.paths['/v1/restaurants/{id}']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '404']),
    );
    expect(doc.paths['/v1/restaurants']?.post?.responses).toHaveProperty('409');
  });

  it('serves the interactive UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('rate limiting', () => {
  it('answers 429 in the error envelope once the limit is exceeded', async () => {
    const app = buildTestApp(createFakeRepository().repository, undefined, { RATE_LIMIT_MAX: 2 });
    const get = () => app.inject({ method: 'GET', url: '/v1/restaurants?limit=1' });

    expect([(await get()).statusCode, (await get()).statusCode]).toEqual([200, 200]);
    const limited = await get();
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string; requestId: string } }>().error.code).toBe(
      'rate_limited',
    );
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('never throttles health probes or docs', async () => {
    const app = buildTestApp(createFakeRepository().repository, undefined, { RATE_LIMIT_MAX: 1 });
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    }
  });

  it('limits each client IP separately', async () => {
    const app = buildTestApp(createFakeRepository().repository, undefined, { RATE_LIMIT_MAX: 1 });
    const get = (remoteAddress: string) =>
      app.inject({ method: 'GET', url: '/v1/restaurants?limit=1', remoteAddress });
    expect((await get('10.0.0.1')).statusCode).toBe(200);
    expect((await get('10.0.0.1')).statusCode).toBe(429);
    expect((await get('10.0.0.2')).statusCode).toBe(200);
  });
});
