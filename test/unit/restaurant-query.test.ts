import { describe, expect, it } from 'vitest';

import {
  buildBestPipeline,
  buildGeoPipeline,
  buildMatch,
  buildSort,
  scoreExpression,
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

describe('buildMatch: rankings need the ranked value to exist', () => {
  it('requires a rating for ascending rating and for best, but not for best-first', () => {
    expect(buildMatch(criteria({ sort: 'rating' }))).toMatchObject({
      'rating.average': { $gte: 0 },
    });
    expect(buildMatch(criteria({ sort: 'best' }))).toMatchObject({ 'rating.average': { $gte: 0 } });
    expect(buildMatch(criteria({ sort: '-rating' }))).not.toHaveProperty('rating.average');
  });

  it('combines an explicit minimum with the ranking requirement', () => {
    expect(buildMatch(criteria({ sort: 'best', minRating: 4 }))).toMatchObject({
      'rating.average': { $gte: 4 },
    });
  });

  it('excludes missing costs when sorting by cost, and combines with a ceiling', () => {
    expect(buildMatch(criteria({ sort: 'cost' }))).toMatchObject({
      'pricing.averageCostForTwo': { $gt: 0 },
    });
    expect(buildMatch(criteria({ sort: '-cost', maxCost: 800 }))).toMatchObject({
      'pricing.averageCostForTwo': { $gt: 0, $lte: 800 },
    });
  });
});

describe('buildMatch: price range and dishes', () => {
  it('limits the price range', () => {
    expect(buildMatch(criteria({ maxPriceRange: 2 }))).toMatchObject({
      'pricing.priceRange': { $lte: 2 },
    });
  });

  it('matches a dish by name or by cuisine', () => {
    const match = buildMatch(
      criteria({ dish: { names: ['vada pav', 'vadapav'], cuisines: ['Street Food'] } }),
    );
    expect(match).toMatchObject({
      $or: [
        { name: { $regex: 'vada\\s*pav|vadapav', $options: 'i' } },
        { cuisines: { $in: ['Street Food'] } },
      ],
    });
  });

  it('uses a name-only $or when the dish has no cuisine', () => {
    const match = buildMatch(criteria({ dish: { names: ['vada pav'], cuisines: [] } }));
    expect((match as { $or: unknown[] }).$or).toHaveLength(1);
  });

  it('adds no $or for an empty dish', () => {
    expect(buildMatch(criteria({ dish: { names: [], cuisines: [] } }))).not.toHaveProperty('$or');
  });

  it('escapes regex metacharacters in dish names', () => {
    const match = buildMatch(criteria({ dish: { names: ['a.b'], cuisines: [] } })) as {
      $or: { name: { $regex: string } }[];
    };
    expect(match.$or[0]?.name.$regex).toBe('a\\.b');
  });
});

describe('weighted score pipeline', () => {
  const ranking = { priorVotes: 100, priorMean: 3.4 };

  it('scores, sorts by score with deterministic tiebreaks, then pages', () => {
    const stages = buildBestPipeline(criteria({ sort: 'best', ranking, offset: 10 }), 21);
    expect(stages.map((s) => Object.keys(s)[0])).toEqual([
      '$match',
      '$addFields',
      '$sort',
      '$skip',
      '$limit',
      '$project',
    ]);
    expect(stages[2]).toEqual({ $sort: { score: -1, 'rating.votes': -1, _id: 1 } });
    expect(stages[3]).toEqual({ $skip: 10 });
  });

  it('only rated restaurants are matched', () => {
    const [match] = buildBestPipeline(criteria({ sort: 'best', ranking }), 21);
    expect(match).toMatchObject({ $match: { 'rating.average': { $gte: 0 } } });
  });

  it('refuses to rank without priors instead of silently guessing', () => {
    expect(() => buildBestPipeline(criteria({ sort: 'best' }), 21)).toThrow(/ranking priors/);
  });

  it('scores inside a $geoNear pipeline too, keeping $geoNear first', () => {
    const near = { lat: 1, lng: 2 };
    const stages = buildGeoPipeline(criteria({ sort: 'best', ranking, near }), near, 21);
    expect(Object.keys(stages[0] ?? {})[0]).toBe('$geoNear');
    expect(stages.some((s) => '$addFields' in s)).toBe(true);
  });

  it('builds the formula v/(v+m)*R + m/(v+m)*C', () => {
    expect(JSON.stringify(scoreExpression(ranking))).toBe(
      JSON.stringify({
        $add: [
          {
            $multiply: [
              {
                $divide: [
                  { $ifNull: ['$rating.votes', 0] },
                  { $add: [{ $ifNull: ['$rating.votes', 0] }, 100] },
                ],
              },
              '$rating.average',
            ],
          },
          {
            $multiply: [
              { $divide: [100, { $add: [{ $ifNull: ['$rating.votes', 0] }, 100] }] },
              3.4,
            ],
          },
        ],
      }),
    );
  });
});
