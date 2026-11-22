import type { Document, Filter, Sort } from 'mongodb';

import type { ListCriteria, NearCriteria, RankingPriors } from './restaurant.repository.js';
import type { SortKey, StoredRestaurant } from './restaurant.schema.js';

/** Fields the list view needs; keeps list reads light (no flags, locality, timestamps...). */
export const LIST_PROJECTION = {
  name: 1,
  'address.line': 1,
  'address.city': 1,
  'address.country': 1,
  cuisines: 1,
  'rating.average': 1,
  'rating.votes': 1,
  'pricing.averageCostForTwo': 1,
  'pricing.currency': 1,
  score: 1,
} as const;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "a b" -> `a\s*b`, so "vadapav" and "vada pav" both match. */
const namesPattern = (names: string[]): string =>
  names.map((n) => n.trim().split(/\s+/).map(escapeRegex).join('\\s*')).join('|');

/** Rating filter; ranking by rating needs the value to exist (a missing field sorts lowest). */
function ratingCondition(c: ListCriteria): Document | undefined {
  const ranksByRating = c.sort === 'rating' || c.sort === 'best';
  if (c.minRating === undefined && !ranksByRating) return undefined;
  return { $gte: c.minRating ?? 0 };
}

/** Cost filter; sorting by cost needs a real (positive) cost, not a missing one. */
function costCondition(c: ListCriteria): Document | undefined {
  const sortsByCost = c.sort === 'cost' || c.sort === '-cost';
  if (c.maxCost === undefined && !sortsByCost) return undefined;
  return { ...(sortsByCost && { $gt: 0 }), ...(c.maxCost !== undefined && { $lte: c.maxCost }) };
}

/** A dish matches by name, or by a cuisine that effectively is the dish. */
function dishCondition(c: ListCriteria): Document[] | undefined {
  if (!c.dish) return undefined;
  const any: Document[] = [];
  if (c.dish.names.length) {
    any.push({ name: { $regex: namesPattern(c.dish.names), $options: 'i' } });
  }
  if (c.dish.cuisines.length) any.push({ cuisines: { $in: c.dish.cuisines } });
  return any.length ? any : undefined;
}

/**
 * Equality/range filters only, always scoped by tenant. User text never becomes an operator:
 * every value is a typed string or number produced by validation.
 *
 * Sorts that rank by a value (rating asc, best, cost) require the value to exist: in MongoDB a
 * missing field sorts as the lowest value, which would put unrated/unpriced rows first.
 */
export function buildMatch(c: ListCriteria): Filter<StoredRestaurant> {
  const fields: Record<string, unknown> = {
    'address.city': c.city,
    cuisines: c.cuisines?.length ? { $in: c.cuisines } : undefined,
    name: c.name ? { $regex: escapeRegex(c.name), $options: 'i' } : undefined,
    'rating.average': ratingCondition(c),
    'pricing.averageCostForTwo': costCondition(c),
    'pricing.currency': c.currency,
    'pricing.priceRange': c.maxPriceRange === undefined ? undefined : { $lte: c.maxPriceRange },
    $or: dishCondition(c),
  };
  const defined = Object.entries(fields).filter(([, value]) => value !== undefined);
  return { tenantId: c.tenantId, ...Object.fromEntries(defined) };
}

/**
 * Every sort ends with _id so pagination is deterministic. The rating sorts match the
 * compound index key order exactly (including direction), so they can be served by it.
 */
export function buildSort(sort: Exclude<SortKey, 'distance'>): Sort {
  switch (sort) {
    case '-rating':
      return { 'rating.average': -1, 'rating.votes': -1, _id: 1 };
    case 'rating':
      return { 'rating.average': 1, 'rating.votes': 1, _id: -1 };
    case 'name':
      return { name: 1, _id: 1 };
    case '-name':
      return { name: -1, _id: -1 };
    case 'cost':
      return { 'pricing.averageCostForTwo': 1, _id: 1 };
    case '-cost':
      return { 'pricing.averageCostForTwo': -1, _id: -1 };
  }
}

/** MongoDB expression for the weighted score; mirrors weightedScore() in search/ranking.ts. */
export function scoreExpression({ priorVotes, priorMean }: RankingPriors): Document {
  const votes = { $ifNull: ['$rating.votes', 0] };
  const total = { $add: [votes, priorVotes] };
  return {
    $add: [
      { $multiply: [{ $divide: [votes, total] }, '$rating.average'] },
      { $multiply: [{ $divide: [priorVotes, total] }, priorMean] },
    ],
  };
}

function sortStages(c: ListCriteria): Document[] {
  const sort = c.sort;
  if (sort === 'distance') return []; // $geoNear already orders by distance
  if (sort !== 'best') return [{ $sort: buildSort(sort) }];
  if (!c.ranking) throw new Error('sort=best requires ranking priors');
  return [
    { $addFields: { score: scoreExpression(c.ranking) } },
    { $sort: { score: -1, 'rating.votes': -1, _id: 1 } },
  ];
}

const pageStages = (c: ListCriteria, fetchLimit: number): Document[] => [
  { $skip: c.offset },
  { $limit: fetchLimit },
  { $project: { ...LIST_PROJECTION, distanceMeters: 1 } },
];

/**
 * Distance path: $geoNear must be the first stage and sorts by distance itself; any other
 * requested sort then runs in memory over the (tenant/filter/radius) bounded set.
 */
export function buildGeoPipeline(
  c: ListCriteria,
  near: NearCriteria,
  fetchLimit: number,
): Document[] {
  return [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [near.lng, near.lat] },
        key: 'location',
        distanceField: 'distanceMeters',
        spherical: true,
        query: buildMatch(c),
        ...(near.radiusKm !== undefined && { maxDistance: near.radiusKm * 1000 }),
      },
    },
    ...sortStages(c),
    ...pageStages(c, fetchLimit),
  ];
}

/** Weighted-score path without a location: filter, score and sort in memory, then page. */
export function buildBestPipeline(c: ListCriteria, fetchLimit: number): Document[] {
  return [{ $match: buildMatch(c) }, ...sortStages(c), ...pageStages(c, fetchLimit)];
}
