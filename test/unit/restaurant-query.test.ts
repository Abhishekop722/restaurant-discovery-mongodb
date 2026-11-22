import { describe, expect, it } from 'vitest';

import {
  buildGeoPipeline,
  buildMatch,
  buildSort,
} from '../../src/modules/restaurants/restaurant.mongo-query.js';
import type { ListCriteria } from '../../src/modules/restaurants/restaurant.repository.js';

const criteria = (overrides: Partial<ListCriteria> = {}): ListCriteria => ({
  tenantId: 't',
  sort: '-rating',
  limit: 20,
  offset: 0,
  ...overrides,
});

describe('buildMatch', () => {
  it('always scopes by tenant', () => {
    expect(buildMatch(criteria())).toEqual({ tenantId: 't' });
  });

  it('builds equality, any-of and range filters', () => {
    expect(
      buildMatch(
        criteria({
          city: 'Gurgaon',
          cuisines: ['North Indian', 'Chinese'],
          minRating: 4,
          maxCost: 1000,
          currency: 'INR',
        }),
      ),
    ).toEqual({
      tenantId: 't',
      'address.city': 'Gurgaon',
      cuisines: { $in: ['North Indian', 'Chinese'] },
      'rating.average': { $gte: 4 },
      'pricing.averageCostForTwo': { $lte: 1000 },
      'pricing.currency': 'INR',
    });
  });

  it('escapes regex metacharacters in the name filter', () => {
    const match = buildMatch(criteria({ name: 'a.b(c)*' })) as Record<string, { $regex: string }>;
    expect(match.name?.$regex).toBe('a\\.b\\(c\\)\\*');
  });

  it('never turns a value into an operator', () => {
    const match = buildMatch(criteria({ city: '{"$ne":null}' }));
    expect(match).toMatchObject({ 'address.city': '{"$ne":null}' });
  });
});

describe('buildSort', () => {
  it('ends every sort with _id for deterministic pagination', () => {
    for (const key of ['rating', '-rating', 'name', '-name', 'cost', '-cost'] as const) {
      expect(Object.keys(buildSort(key) as object).at(-1)).toBe('_id');
    }
  });

  it('matches the index key order and direction for best-rated first', () => {
    expect(buildSort('-rating')).toEqual({ 'rating.average': -1, 'rating.votes': -1, _id: 1 });
  });
});

describe('buildGeoPipeline', () => {
  const near = { lat: 28.45, lng: 77.02, radiusKm: 3 };

  it('starts with $geoNear using [lng, lat] and a radius in metres', () => {
    const [first] = buildGeoPipeline(criteria({ sort: 'distance', near }), near, 21);
    expect(first).toMatchObject({
      $geoNear: {
        near: { type: 'Point', coordinates: [77.02, 28.45] },
        distanceField: 'distanceMeters',
        spherical: true,
        maxDistance: 3000,
        query: { tenantId: 't' },
      },
    });
  });

  it('adds no extra sort for distance, but sorts in memory for other keys', () => {
    const byDistance = buildGeoPipeline(criteria({ sort: 'distance', near }), near, 21);
    expect(byDistance.some((stage) => '$sort' in stage)).toBe(false);
    const byRating = buildGeoPipeline(criteria({ sort: '-rating', near }), near, 21);
    expect(byRating.some((stage) => '$sort' in stage)).toBe(true);
  });

  it('applies skip and limit after sorting', () => {
    const stages = buildGeoPipeline(criteria({ sort: 'distance', near, offset: 40 }), near, 21);
    expect(stages.slice(-3, -1)).toEqual([{ $skip: 40 }, { $limit: 21 }]);
  });

  it('omits maxDistance when no radius is given', () => {
    const open = { lat: 1, lng: 2 };
    const [first] = buildGeoPipeline(criteria({ sort: 'distance', near: open }), open, 21);
    expect(JSON.stringify(first)).not.toContain('maxDistance');
  });
});
