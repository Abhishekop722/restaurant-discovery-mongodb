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

// ---------------------------------------------------------------------------
// HTTP contract (requests and responses). The persisted document model is above.
// ---------------------------------------------------------------------------

const coordinate = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};

export const createRestaurantSchema = z.strictObject({
  /** Optional source-system id; makes the create idempotent-by-key (409 on duplicate). */
  externalId: z.number().int().optional(),
  name: z.string().trim().min(1).max(200),
  address: z.strictObject({
    line: z.string().trim().min(1).max(500),
    locality: z.string().trim().max(200).default(''),
    city: z.string().trim().min(1).max(100),
    /** Country is derived from the code; currency follows from the country. */
    countryCode: z.number().int(),
  }),
  location: z.strictObject(coordinate).optional(),
  cuisines: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  pricing: z.strictObject({
    averageCostForTwo: z.number().positive().optional(),
    priceRange: z.number().int().min(1).max(4),
  }),
  flags: z
    .strictObject({
      hasTableBooking: z.boolean().default(false),
      hasOnlineDelivery: z.boolean().default(false),
      isDeliveringNow: z.boolean().default(false),
      switchToOrderMenu: z.boolean().default(false),
    })
    .prefault({}),
});
export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

export const idParamsSchema = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/i) });

export const SORT_KEYS = [
  'rating',
  '-rating',
  'name',
  '-name',
  'cost',
  '-cost',
  'distance',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** `best` is the weighted score (ratings adjusted for vote count); only the search endpoint offers it. */
export const SEARCH_SORT_KEYS = [...SORT_KEYS, 'best'] as const;
export type SearchSortKey = (typeof SEARCH_SORT_KEYS)[number];

/** Accepts `cuisine=a&cuisine=b` and `cuisine=a,b`. */
const listOfStrings = z.union([z.string(), z.array(z.string())]).transform((value) =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean),
);

const listFields = {
  name: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  cuisine: listOfStrings.optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxCost: z.coerce.number().positive().optional(),
  /** ISO 4217. Costs in different currencies are not comparable, so this scopes maxCost. */
  currency: z.string().trim().length(3).toUpperCase().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(500).optional(),
  sort: z.enum(SORT_KEYS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Capped: deep offsets are slow; cursor pagination is the documented next step. */
  offset: z.coerce.number().int().min(0).max(5000).default(0),
};

/** Cross-field rules shared by the list and search endpoints. */
export function refineGeo(
  q: {
    lat?: number | undefined;
    lng?: number | undefined;
    radiusKm?: number | undefined;
    sort?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasLat = q.lat !== undefined;
  const hasLng = q.lng !== undefined;
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: 'custom',
      path: [hasLat ? 'lng' : 'lat'],
      message: 'lat and lng must be sent together',
    });
  }
  const hasPoint = hasLat && hasLng;
  if (!hasPoint && q.sort === 'distance') {
    ctx.addIssue({ code: 'custom', path: ['sort'], message: 'sort=distance requires lat and lng' });
  }
  if (!hasPoint && q.radiusKm !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['radiusKm'], message: 'radiusKm requires lat and lng' });
  }
}

export const listQuerySchema = z.strictObject(listFields).superRefine(refineGeo);
export type ListQuery = z.infer<typeof listQuerySchema>;
export { listFields };

export const restaurantResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.object({
    line: z.string(),
    locality: z.string(),
    city: z.string(),
    country: z.string(),
    countryCode: z.number(),
  }),
  location: z.object(coordinate).nullable(),
  cuisines: z.array(z.string()),
  pricing: z.object({
    averageCostForTwo: z.number().nullable(),
    currency: z.string(),
    priceRange: z.number(),
  }),
  flags: z.object({
    hasTableBooking: z.boolean(),
    hasOnlineDelivery: z.boolean(),
    isDeliveringNow: z.boolean(),
    switchToOrderMenu: z.boolean(),
  }),
  rating: z.object({ average: z.number().nullable(), votes: z.number(), text: z.string() }),
});

export const listItemSchema = z.object({
  /** Weighted score; present only for sort=best. */
  score: z.number().optional(),
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  country: z.string(),
  cuisines: z.array(z.string()),
  averageRating: z.number().nullable(),
  votes: z.number(),
  averageCostForTwo: z.number().nullable(),
  currency: z.string(),
  /** Present only when lat/lng were sent. */
  distanceKm: z.number().optional(),
});

export const listResponseSchema = z.object({
  data: z.array(listItemSchema),
  page: z.object({ limit: z.number(), offset: z.number(), hasMore: z.boolean() }),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export const searchQuerySchema = z
  .strictObject({
    /** Free text, e.g. "best south indian in gurgaon under rs 1000". */
    q: z.string().trim().min(1).max(200),
    ...listFields,
    sort: z.enum(SEARCH_SORT_KEYS).optional(),
  })
  .superRefine(refineGeo);
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** How the query was understood, echoed so users and tests can see and correct it. */
export const interpretationSchema = z.object({
  city: z.string().optional(),
  cuisines: z.array(z.string()).optional(),
  dish: z.array(z.string()).optional(),
  name: z.string().optional(),
  minRating: z.number().optional(),
  maxCostForTwo: z.number().optional(),
  currency: z.string().optional(),
  maxPriceRange: z.number().optional(),
  radiusKm: z.number().optional(),
  nearestTo: z.object(coordinate).optional(),
  sort: z.enum(SEARCH_SORT_KEYS),
});
export type Interpretation = z.infer<typeof interpretationSchema>;

export const searchResponseSchema = listResponseSchema.extend({
  interpretation: interpretationSchema,
  unparsedTerms: z.array(z.string()),
});
