import type { Db, IndexDescription, IndexDescriptionInfo } from 'mongodb';

import { restaurantsCollection } from './collections.js';

/**
 * Every index exists for a named query. Compound indexes lead with tenantId so one
 * cluster can serve many businesses and later be zone-sharded by {tenantId, countryCode}.
 * Rating sorts end in _id (a unique tiebreaker) so deterministic pagination is index-served.
 */
export const RESTAURANT_INDEXES: IndexDescription[] = [
  // nearest / within-radius queries ($geoNear); documents without a location are simply not indexed
  { key: { location: '2dsphere' }, name: 'location_2dsphere' },
  // idempotent seeding and lookup by source id; partial so API-created restaurants (no externalId) don't collide
  {
    key: { tenantId: 1, externalId: 1 },
    name: 'tenant_externalId_unique',
    unique: true,
    partialFilterExpression: { externalId: { $exists: true } },
  },
  // best-rated overall
  {
    key: { tenantId: 1, 'rating.average': -1, 'rating.votes': -1, _id: 1 },
    name: 'tenant_rating',
  },
  // city listing, best rated first
  {
    key: { tenantId: 1, 'address.city': 1, 'rating.average': -1, 'rating.votes': -1, _id: 1 },
    name: 'tenant_city_rating',
  },
  // cuisine within a city, best rated first (multikey on cuisines)
  {
    key: { tenantId: 1, cuisines: 1, 'address.city': 1, 'rating.average': -1 },
    name: 'tenant_cuisine_city_rating',
  },
  // budget queries ("under Rs. 1000 for two")
  {
    key: { tenantId: 1, 'address.city': 1, 'pricing.averageCostForTwo': 1 },
    name: 'tenant_city_cost',
  },
];

const sameKey = (a: object, b: object): boolean =>
  JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

/**
 * Brings the collection's indexes in line with RESTAURANT_INDEXES, so index changes made by
 * one developer reach every environment on next start: same-name indexes with a different
 * definition and indexes no longer declared are dropped, then the declared ones are created.
 * Idempotent: createIndexes is a no-op for indexes that already match.
 */
export async function ensureIndexes(db: Db): Promise<string[]> {
  const collection = restaurantsCollection(db);
  // a missing collection has no indexes yet
  const existing: IndexDescriptionInfo[] = await collection
    .listIndexes()
    .toArray()
    .catch((): IndexDescriptionInfo[] => []);

  for (const index of existing) {
    if (index.name === undefined || index.name === '_id_') continue;
    const wanted = RESTAURANT_INDEXES.find((i) => i.name === index.name);
    if (!wanted || !sameKey(index.key, wanted.key)) await collection.dropIndex(index.name);
  }
  return collection.createIndexes(RESTAURANT_INDEXES);
}
