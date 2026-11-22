import type { Db, IndexDescription } from 'mongodb';

import { restaurantsCollection } from './collections.js';

/**
 * Every index exists for a named query. Compound indexes lead with tenantId so one
 * cluster can serve many businesses and later be zone-sharded by {tenantId, countryCode}.
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
  // city listing, best rated first
  {
    key: { tenantId: 1, 'address.city': 1, 'rating.average': -1, 'rating.votes': -1 },
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
  // baseline free-text name/cuisine search without Atlas Search
  { key: { name: 'text', cuisines: 'text' }, name: 'name_cuisines_text' },
];

/** Idempotent: createIndexes is a no-op for indexes that already exist with the same definition. */
export async function ensureIndexes(db: Db): Promise<string[]> {
  return restaurantsCollection(db).createIndexes(RESTAURANT_INDEXES);
}
