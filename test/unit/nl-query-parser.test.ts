import { describe, expect, it } from 'vitest';

import { makeLookup } from '../../src/modules/restaurants/restaurant.vocabulary.js';
import {
  parseSearchQuery,
  type ParsedSearch,
} from '../../src/modules/restaurants/search/nl-query-parser.js';

const vocabulary = {
  cities: makeLookup(['Gurgaon', 'New Delhi', 'Noida', 'Mumbai']),
  cuisines: makeLookup([
    'North Indian',
    'South Indian',
    'Indian',
    'Chinese',
    'Street Food',
    'Fast Food',
    'Biryani',
    'Cafe',
    'Pizza',
    'Desserts',
    'Tibetan',
  ]),
};
const parse = (q: string): ParsedSearch => parseSearchQuery(q, vocabulary);

describe('the three example queries from the brief', () => {
  it('"Best restaurants in Gurgaon with South Indian Food"', () => {
    expect(parse('Best restaurants in Gurgaon with South Indian Food')).toMatchObject({
      city: 'Gurgaon',
      cuisines: ['South Indian'],
      best: true,
      nearest: false,
      unparsedTerms: [],
    });
  });

  it('"Restaurants in Gurgaon under Rs. 1000 for two"', () => {
    const parsed = parse('Restaurants in Gurgaon under Rs. 1000 for two');
    expect(parsed).toMatchObject({
      city: 'Gurgaon',
      maxCostForTwo: 1000,
      currency: 'INR',
      best: false,
      unparsedTerms: [],
    });
    expect(parsed.cuisines).toEqual([]);
  });

  it('"Nearest place that serves Vada Pav"', () => {
    const parsed = parse('Nearest place that serves Vada Pav');
    expect(parsed).toMatchObject({ nearest: true, unparsedTerms: [] });
    expect(parsed.dish).toEqual({ terms: ['vada pav'], names: ['vada pav'], cuisines: [] });
    expect(parsed.city).toBeUndefined();
  });
});

describe('price phrases', () => {
  it.each([
    ['under Rs. 1000', 1000, 'INR'],
    ['below ₹500', 500, 'INR'],
    ['less than 750 rupees', 750, 'INR'],
    ['up to INR 2,000', 2000, 'INR'],
    ['max $40', 40, 'USD'],
    ['under 1.5k', 1500, undefined],
    ['under 800', 800, undefined],
    ['budget of rs 600 for two', 600, 'INR'],
  ])('%s', (phrase, cost, currency) => {
    const parsed = parse(`restaurants ${phrase}`);
    expect(parsed.maxCostForTwo).toBe(cost);
    expect(parsed.currency).toBe(currency);
    expect(parsed.unparsedTerms).toEqual([]);
  });

  it('doubles a per-person budget because prices are for two', () => {
    expect(parse('under rs 500 per person').maxCostForTwo).toBe(1000);
  });

  it('keeps the city when a price follows it', () => {
    expect(parse('cafes in noida under 600')).toMatchObject({
      city: 'Noida',
      cuisines: ['Cafe'],
      maxCostForTwo: 600,
    });
  });
});

describe('rating phrases', () => {
  it.each([
    ['rated above 4', 4],
    ['rating over 4.5', 4.5],
    ['at least 3.5 stars', 3.5],
    ['4+ stars', 4],
    ['4.5 star', 4.5],
    ['rated 4+', 4],
    ['more than 4', 4],
  ])('%s', (phrase, minRating) => {
    const parsed = parse(`pizza ${phrase}`);
    expect(parsed.minRating).toBe(minRating);
    expect(parsed.cuisines).toEqual(['Pizza']);
    expect(parsed.unparsedTerms).toEqual([]);
  });

  it('does not read a large number after "above" as a rating', () => {
    const parsed = parse('restaurants above 1000');
    expect(parsed.minRating).toBeUndefined();
    expect(parsed.unparsedTerms).toContain('1000');
  });

  it('rejects ratings outside 0..5', () => {
    expect(parse('rated above 7').minRating).toBeUndefined();
  });
});

describe('location words', () => {
  it.each(['nearest', 'closest', 'nearby', 'near me', 'close by', 'around me'])('%s', (word) => {
    const parsed = parse(`${word} cafe`);
    expect(parsed.nearest).toBe(true);
    expect(parsed.cuisines).toEqual(['Cafe']);
    expect(parsed.unparsedTerms).toEqual([]);
  });

  it.each([
    ['chinese within 3 km', 3],
    ['chinese within 500 m', 0.5],
    ['chinese in 2.5 kilometres', 2.5],
    ['chinese within 1 km radius', 1],
  ])('%s', (q, km) => {
    const parsed = parse(q);
    expect(parsed.radiusKm).toBe(km);
    expect(parsed.cuisines).toEqual(['Chinese']);
    expect(parsed.unparsedTerms).toEqual([]);
  });
});

describe('ranking and price words', () => {
  it.each(['best', 'top rated', 'highly rated', 'top-rated', 'highest rated'])('%s', (word) => {
    expect(parse(`${word} cafes`).best).toBe(true);
  });

  it('"cheap" limits the price range, "cheapest" sorts by cost', () => {
    expect(parse('cheap biryani')).toMatchObject({ maxPriceRange: 2, cheapest: false });
    expect(parse('cheapest biryani')).toMatchObject({ cheapest: true });
    expect(parse('cheapest biryani').maxPriceRange).toBeUndefined();
  });
});

describe('entities', () => {
  it('resolves city aliases to the stored spelling', () => {
    expect(parse('cafes in Gurugram').city).toBe('Gurgaon');
    expect(parse('cafes in delhi').city).toBe('New Delhi');
    expect(parse('cafes in Delhi NCR').city).toBe('New Delhi');
  });

  it('prefers the longest vocabulary match', () => {
    expect(parse('north indian food').cuisines).toEqual(['North Indian']);
    expect(parse('indian food').cuisines).toEqual(['Indian']);
  });

  it('collects several cuisines, including plurals', () => {
    expect(parse('north indian and chinese restaurants').cuisines).toEqual([
      'North Indian',
      'Chinese',
    ]);
    expect(parse('cafes and desserts').cuisines).toEqual(['Cafe', 'Desserts']);
  });

  it('matches case-insensitively', () => {
    expect(parse('SOUTH INDIAN in GURGAON')).toMatchObject({
      city: 'Gurgaon',
      cuisines: ['South Indian'],
    });
  });
});

describe('dishes', () => {
  it('matches "vadapav" and "vada  pav" spellings', () => {
    expect(parse('vadapav').dish?.terms).toEqual(['vada pav']);
    expect(parse('vada  pav').dish?.terms).toEqual(['vada pav']);
  });

  it('lets a word that is itself a cuisine match as a cuisine, not a dish', () => {
    const parsed = parse('biryani');
    expect(parsed.cuisines).toEqual(['Biryani']);
    expect(parsed.dish).toBeUndefined();
  });

  it('expands a dish to name patterns plus cuisines that exist in the data', () => {
    expect(parse('dosa').dish).toEqual({
      terms: ['dosa'],
      names: ['dosa'],
      cuisines: ['South Indian'],
    });
    // 'Tea' and 'Coffee and Tea' are not in the test vocabulary, so they are dropped
    expect(parse('chai').dish).toEqual({ terms: ['chai'], names: ['chai'], cuisines: [] });
  });

  it('merges several dishes without duplicates', () => {
    expect(parse('dosa and idli').dish).toEqual({
      terms: ['dosa', 'idli'],
      names: ['dosa', 'idli'],
      cuisines: ['South Indian'],
    });
  });

  it('does not map vada pav to a broad cuisine', () => {
    expect(parse('vada pav').dish?.cuisines).toEqual([]);
  });
});

describe('unrecognised words', () => {
  it('are reported so they can become a name search', () => {
    expect(parse('dominos in gurgaon')).toMatchObject({
      city: 'Gurgaon',
      unparsedTerms: ['dominos'],
    });
  });

  it('keeps apostrophes and drops punctuation', () => {
    expect(parse("Johny's, in Noida!").unparsedTerms).toEqual(["johny's"]);
  });

  it('handles empty-ish and symbol-only input', () => {
    expect(parse('   ').unparsedTerms).toEqual([]);
    expect(parse('???').unparsedTerms).toEqual([]);
  });

  it('copes with an empty vocabulary', () => {
    const empty = { cities: makeLookup([]), cuisines: makeLookup([]) };
    expect(parseSearchQuery('cafes in gurgaon', empty).unparsedTerms).toEqual(['cafes', 'gurgaon']);
  });

  it('never treats regex metacharacters in the query as syntax', () => {
    expect(() => parse('(((a+b*) [x] \\ ^$')).not.toThrow();
  });
});
