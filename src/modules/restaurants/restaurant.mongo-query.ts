import type { Document, Filter, Sort } from 'mongodb';

import type { ListCriteria, NearCriteria } from './restaurant.repository.js';
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
} as const;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Equality/range filters only, always scoped by tenant. User text never becomes an operator:
 * every value is a typed string or number produced by validation.
 */
export function buildMatch(c: ListCriteria): Filter<StoredRestaurant> {
  const match: Document = { tenantId: c.tenantId };
  if (c.city) match['address.city'] = c.city;
  if (c.cuisines?.length) match.cuisines = { $in: c.cuisines };
  if (c.name) match.name = { $regex: escapeRegex(c.name), $options: 'i' };
  if (c.minRating !== undefined) match['rating.average'] = { $gte: c.minRating };
  if (c.maxCost !== undefined) match['pricing.averageCostForTwo'] = { $lte: c.maxCost };
  if (c.currency) match['pricing.currency'] = c.currency;
  return match;
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
    ...(c.sort === 'distance' ? [] : [{ $sort: buildSort(c.sort) }]),
    { $skip: c.offset },
    { $limit: fetchLimit },
    { $project: { ...LIST_PROJECTION, distanceMeters: 1 } },
  ];
}
