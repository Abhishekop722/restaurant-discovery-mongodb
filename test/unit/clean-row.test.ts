import { describe, expect, it } from 'vitest';

import { cleanRow, parseCuisines } from '../../src/infra/seed/clean-row.js';

const base: Record<string, string> = {
  'Restaurant ID': '6317637',
  'Restaurant Name': ' Le Petit Souffle ',
  'Country Code': '162',
  City: 'Makati City',
  Address: 'Third Floor, Century City Mall',
  Locality: 'Century City Mall, Poblacion',
  'Locality Verbose': 'Century City Mall, Poblacion, Makati City',
  Longitude: '121.027535',
  Latitude: '14.565443',
  Cuisines: 'French, Japanese, Desserts',
  'Average Cost for two': '1100',
  Currency: 'Botswana Pula(P)',
  'Has Table booking': 'Yes',
  'Has Online delivery': 'No',
  'Is delivering now': 'No',
  'Switch to order menu': 'No',
  'Price range': '3',
  'Aggregate rating': '4.8',
  'Rating color': 'Dark Green',
  'Rating text': 'Excellent',
  Votes: '314',
};

const clean = (overrides: Record<string, string> = {}) =>
  cleanRow({ ...base, ...overrides }, 'biteexpress');

describe('cleanRow', () => {
  it('maps a full row to the document model', () => {
    const result = clean();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toMatchObject({
      tenantId: 'biteexpress',
      externalId: 6317637,
      name: 'Le Petit Souffle',
      cuisines: ['French', 'Japanese', 'Desserts'],
      address: { city: 'Makati City', countryCode: 162, country: 'Philippines' },
      pricing: { averageCostForTwo: 1100, priceRange: 3 },
      flags: { hasTableBooking: true, hasOnlineDelivery: false },
      rating: { average: 4.8, text: 'Excellent', votes: 314 },
      schemaVersion: 1,
    });
  });

  it('stores GeoJSON as [longitude, latitude]', () => {
    const result = clean();
    expect(result.ok && result.doc.location?.coordinates).toEqual([121.027535, 14.565443]);
  });

  it('derives currency from the country, ignoring the unreliable CSV column', () => {
    const result = clean();
    expect(result.ok && result.doc.pricing.currency).toBe('PHP');
  });

  it('omits location for 0,0 coordinates', () => {
    const result = clean({ Longitude: '0', Latitude: '0' });
    expect(result.ok && result.doc.location).toBeUndefined();
  });

  it('omits average rating for unrated restaurants but keeps votes', () => {
    const result = clean({ 'Aggregate rating': '0', 'Rating text': 'Not rated', Votes: '0' });
    expect(result.ok && result.doc.rating).toEqual({ text: 'Not rated', votes: 0 });
  });

  it('omits a zero cost for two', () => {
    const result = clean({ 'Average Cost for two': '0' });
    expect(result.ok && result.doc.pricing.averageCostForTwo).toBeUndefined();
  });

  it('allows missing cuisines', () => {
    const result = clean({ Cuisines: '' });
    expect(result.ok && result.doc.cuisines).toEqual([]);
  });

  it('rejects unknown country codes and bad ids with a reason', () => {
    expect(clean({ 'Country Code': '9999' })).toEqual({
      ok: false,
      reason: 'unknown country code',
    });
    expect(clean({ 'Restaurant ID': 'abc' })).toEqual({
      ok: false,
      reason: 'invalid restaurant id',
    });
  });

  it('rejects an empty name', () => {
    expect(clean({ 'Restaurant Name': '  ' })).toEqual({ ok: false, reason: 'invalid name' });
  });
});

describe('parseCuisines', () => {
  it('trims, drops empties and de-duplicates', () => {
    expect(parseCuisines(' North Indian ,Chinese,, North Indian')).toEqual([
      'North Indian',
      'Chinese',
    ]);
  });
});
