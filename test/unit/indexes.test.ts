import { describe, expect, it } from 'vitest';

import { RESTAURANT_INDEXES } from '../../src/infra/mongo/indexes.js';

describe('RESTAURANT_INDEXES', () => {
  it('has unique names', () => {
    const names = RESTAURANT_INDEXES.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('leads every compound index with tenantId', () => {
    const compound = RESTAURANT_INDEXES.filter(
      (i) => Object.keys(i.key).length > 1 && !Object.values(i.key).includes('text'),
    );
    expect(compound.length).toBeGreaterThan(0);
    for (const index of compound) expect(Object.keys(index.key)[0]).toBe('tenantId');
  });

  it('makes the business-key index partial so API-created restaurants do not collide', () => {
    const unique = RESTAURANT_INDEXES.find((i) => i.unique);
    expect(unique?.partialFilterExpression).toEqual({ externalId: { $exists: true } });
  });
});
