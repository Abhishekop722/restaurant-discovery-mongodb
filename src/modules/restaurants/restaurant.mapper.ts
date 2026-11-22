import type { z } from 'zod';

import type { ListRow, RestaurantRecord } from './restaurant.repository.js';
import type { listItemSchema, restaurantResponseSchema } from './restaurant.schema.js';

type RestaurantResponse = z.infer<typeof restaurantResponseSchema>;
type ListItem = z.infer<typeof listItemSchema>;

export function toRestaurantResponse(record: RestaurantRecord): RestaurantResponse {
  const { address, location, pricing, rating } = record;
  return {
    id: record.id,
    name: record.name,
    address: {
      line: address.line,
      locality: address.locality,
      city: address.city,
      country: address.country,
      countryCode: address.countryCode,
    },
    location: location
      ? { longitude: location.coordinates[0], latitude: location.coordinates[1] }
      : null,
    cuisines: record.cuisines,
    pricing: {
      averageCostForTwo: pricing.averageCostForTwo ?? null,
      currency: pricing.currency,
      priceRange: pricing.priceRange,
    },
    flags: record.flags,
    rating: { average: rating.average ?? null, votes: rating.votes, text: rating.text },
  };
}

export function toListItem(row: ListRow): ListItem {
  return {
    id: row.id,
    name: row.name,
    address: row.addressLine,
    city: row.city,
    country: row.country,
    cuisines: row.cuisines,
    averageRating: row.averageRating ?? null,
    votes: row.votes,
    averageCostForTwo: row.averageCostForTwo ?? null,
    currency: row.currency,
    ...(row.score !== undefined && { score: Math.round(row.score * 100) / 100 }),
    ...(row.distanceMeters !== undefined && {
      distanceKm: Math.round(row.distanceMeters / 10) / 100,
    }),
  };
}
