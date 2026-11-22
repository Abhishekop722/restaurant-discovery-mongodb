import {
  restaurantDocSchema,
  type RestaurantDoc,
} from '../../modules/restaurants/restaurant.schema.js';
import { COUNTRIES } from '../../shared/countries.js';

export type CleanResult = { ok: true; doc: RestaurantDoc } | { ok: false; reason: string };

const text = (raw: Record<string, string>, key: string): string =>
  (raw[key] ?? '').normalize('NFC').trim();

const yes = (raw: Record<string, string>, key: string): boolean =>
  text(raw, key).toLowerCase() === 'yes';

function parseCoordinates(lng: number, lat: number): [number, number] | undefined {
  const valid = Number.isFinite(lng) && Number.isFinite(lat);
  // the source uses 0,0 as "unknown"; (0,0) is open ocean, so never store it
  if (!valid || (lng === 0 && lat === 0)) return undefined;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined;
  return [lng, lat];
}

/** Splits "North Indian, Chinese" into a trimmed, de-duplicated array. */
export function parseCuisines(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const cuisine = part.normalize('NFC').trim();
    if (cuisine) seen.add(cuisine);
  }
  return [...seen];
}

function buildPricing(raw: Record<string, string>, currency: string): RestaurantDoc['pricing'] {
  const cost = Number(text(raw, 'Average Cost for two'));
  return {
    // a cost of 0 means "unknown" in the source
    ...(Number.isFinite(cost) && cost > 0 && { averageCostForTwo: cost }),
    currency,
    priceRange: Number(text(raw, 'Price range')),
  };
}

function buildRating(raw: Record<string, string>): RestaurantDoc['rating'] {
  const value = Number(text(raw, 'Aggregate rating'));
  const label = text(raw, 'Rating text');
  // "Not rated" rows carry 0, which is "no rating", not a terrible one
  const rated = Number.isFinite(value) && value > 0 && label !== 'Not rated';
  return { ...(rated && { average: value }), text: label, votes: Number(text(raw, 'Votes')) || 0 };
}

/** Maps one raw CSV row to a validated restaurant document, or explains why it was rejected. */
export function cleanRow(raw: Record<string, string>, tenantId: string): CleanResult {
  const externalId = Number(text(raw, 'Restaurant ID'));
  if (!Number.isInteger(externalId)) return { ok: false, reason: 'invalid restaurant id' };

  const countryCode = Number(text(raw, 'Country Code'));
  const country = COUNTRIES[countryCode];
  if (!country) return { ok: false, reason: 'unknown country code' };

  const coordinates = parseCoordinates(
    Number(text(raw, 'Longitude')),
    Number(text(raw, 'Latitude')),
  );

  const candidate = {
    tenantId,
    externalId,
    name: text(raw, 'Restaurant Name'),
    address: {
      line: text(raw, 'Address'),
      locality: text(raw, 'Locality'),
      localityVerbose: text(raw, 'Locality Verbose'),
      city: text(raw, 'City'),
      countryCode,
      country: country.name,
    },
    ...(coordinates && { location: { type: 'Point' as const, coordinates } }),
    cuisines: parseCuisines(text(raw, 'Cuisines')),
    pricing: buildPricing(raw, country.currency),
    flags: {
      hasTableBooking: yes(raw, 'Has Table booking'),
      hasOnlineDelivery: yes(raw, 'Has Online delivery'),
      isDeliveringNow: yes(raw, 'Is delivering now'),
      switchToOrderMenu: yes(raw, 'Switch to order menu'),
    },
    rating: buildRating(raw),
    schemaVersion: 1 as const,
  };

  const parsed = restaurantDocSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `invalid ${issue?.path.join('.') ?? 'row'}` };
  }
  return { ok: true, doc: parsed.data };
}
