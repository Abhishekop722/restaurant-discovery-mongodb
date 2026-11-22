import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('health endpoints', () => {
  it('reports liveness', async () => {
    const app = buildApp({ LOG_LEVEL: 'silent' }, { isReady: () => Promise.resolve(true) });
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports 503 when a dependency is down', async () => {
    const app = buildApp({ LOG_LEVEL: 'silent' }, { isReady: () => Promise.resolve(false) });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });
});
