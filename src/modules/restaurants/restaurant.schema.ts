import { z } from 'zod';

/** GeoJSON point, always [longitude, latitude] (the order MongoDB expects). */
export const pointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});

export const restaurantDocSchema = z.object({
  tenantId: z.string().min(1),
  /** Business key from the source system (the Zomato "Restaurant ID"). */
  externalId: z.number().int().optional(),
  name: z.string().min(1),
  address: z.object({
    line: z.string(),
    locality: z.string(),
    localityVerbose: z.string(),
    city: z.string().min(1),
    countryCode: z.number().int(),
    country: z.string().min(1),
  }),
  /** Omitted when the source has no usable coordinates (never stored as 0,0). */
  location: pointSchema.optional(),
  cuisines: z.array(z.string().min(1)),
  pricing: z.object({
    averageCostForTwo: z.number().positive().optional(),
    currency: z.string().length(3),
    priceRange: z.number().int().min(1).max(4),
  }),
  flags: z.object({
    hasTableBooking: z.boolean(),
    hasOnlineDelivery: z.boolean(),
    isDeliveringNow: z.boolean(),
    switchToOrderMenu: z.boolean(),
  }),
  rating: z.object({
    /** Omitted for unrated restaurants so a 0 never drags averages down. */
    average: z.number().min(0).max(5).optional(),
    text: z.string(),
    votes: z.number().int().min(0),
  }),
  schemaVersion: z.literal(1),
});

export type RestaurantDoc = z.infer<typeof restaurantDocSchema>;

/** A document as stored: the domain fields plus audit timestamps. */
export type StoredRestaurant = RestaurantDoc & { createdAt: Date; updatedAt: Date };
