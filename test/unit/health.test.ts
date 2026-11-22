import { describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/build-test-app.js';
import { createFakeRepository } from '../helpers/fake-repository.js';

describe('health endpoints', () => {
  it('reports liveness', async () => {
    const app = buildTestApp(createFakeRepository().repository);
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports 503 when a dependency is down', async () => {
    const app = buildTestApp(createFakeRepository().repository, () => Promise.resolve(false));
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });

  it('answers unknown routes with the error envelope and a request id header', async () => {
    const app = buildTestApp(createFakeRepository().repository);
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_found');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
