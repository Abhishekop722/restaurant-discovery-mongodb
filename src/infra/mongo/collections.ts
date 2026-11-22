import type { Collection, Db } from 'mongodb';

import type { StoredRestaurant } from '../../modules/restaurants/restaurant.schema.js';

export const RESTAURANTS_COLLECTION = 'restaurants';

export function restaurantsCollection(db: Db): Collection<StoredRestaurant> {
  return db.collection<StoredRestaurant>(RESTAURANTS_COLLECTION);
}
