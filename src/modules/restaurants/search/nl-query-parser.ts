import { CITY_ALIASES, type Lookup } from '../restaurant.vocabulary.js';

import { CURRENCY_WORDS, DISH_SYNONYMS } from './synonyms.js';

export interface SearchVocabulary {
  cities: Lookup;
  cuisines: Lookup;
}

/** What a free-text query asks for. Every field is optional; absent means "not mentioned". */
export interface ParsedSearch {
  city?: string;
  /** Canonical cuisine names mentioned explicitly ("South Indian"). */
  cuisines: string[];
  dish?: { terms: string[]; names: string[]; cuisines: string[] };
  minRating?: number;
  maxCostForTwo?: number;
  /** ISO code, only when the query named a currency. */
  currency?: string;
  /** 1..4; "cheap" means <= 2. */
  maxPriceRange?: number;
  radiusKm?: number;
  best: boolean;
  nearest: boolean;
  cheapest: boolean;
  /** Words nothing recognised; the service uses them as a name filter. */
  unparsedTerms: string[];
}

/** Tier 1 is rule based (below); an LLM-backed parser can implement this and fall back to it. */
export interface QueryParser {
  parse: (q: string, vocabulary: SearchVocabulary) => Promise<ParsedSearch>;
}

export class RuleBasedQueryParser implements QueryParser {
  parse(q: string, vocabulary: SearchVocabulary): Promise<ParsedSearch> {
    return Promise.resolve(parseSearchQuery(q, vocabulary));
  }
}

// --- regex building blocks -------------------------------------------------------------
// Boundaries use Unicode classes because \b is ASCII-only and the data has accented names.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const word = (alternatives: string): RegExp => new RegExp(`${START}(?:${alternatives})${END}`, 'u');
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Escapes a phrase; spaces match any whitespace run (and, for dishes, no whitespace). */
const phrase = (value: string, gap: string): string =>
  value.split(/\s+/).map(escapeRegex).join(gap);

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const CURRENCY = Object.keys(CURRENCY_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const COST_KEYWORD =
  String.raw`(?:${START}(?:under|below|less\s+than|upto|up\s+to|within|at\s+most|` +
  String.raw`not\s+more\s+than|max(?:imum)?|cheaper\s+than|budget(?:\s+of)?)${END}|<=?)`;

const RADIUS = new RegExp(
  String.raw`${START}(?:within|inside|upto|up\s+to|under|in)\s*(\d+(?:\.\d+)?)\s*` +
    String.raw`(km|kms|kilomet(?:er|re)s?|m|meters?|metres?)(?:\s*radius)?${END}`,
  'u',
);
// groups: 1 currency before, 2 amount, 3 "k", 4 currency after, 5 per-person unit
const PRICE = new RegExp(
  String.raw`${COST_KEYWORD}\s*(?:(${CURRENCY})\.?\s*)?${NUMBER}\s*(k${END})?\s*` +
    String.raw`(?:(${CURRENCY})${END})?(\s*(?:for\s+(?:two|2)|per\s+(?:person|head)|each|pp)${END})?`,
  'u',
);
const RATING_ABOVE = new RegExp(
  String.raw`(?:${START}(?:rated|rating|ratings)\s*)?(?:${START}(?:above|over|at\s+least|more\s+than|` +
    String.raw`greater\s+than|min(?:imum)?)${END}|>=?)\s*(\d(?:\.\d)?)(?!\d)\s*(?:\+|stars?${END})?`,
  'u',
);
const RATING_STARS = new RegExp(String.raw`${START}(\d(?:\.\d)?)\s*\+?\s*stars?${END}`, 'u');
const RATING_OF = new RegExp(
  String.raw`${START}(?:rating|rated)\s*(?:of\s*)?(\d(?:\.\d)?)(?!\d)\s*\+?`,
  'u',
);
const NEAREST = word(
  String.raw`nearest|closest|nearby|near\s*by|close\s*by|around\s+here|` +
    String.raw`(?:near|close\s+to|around)\s+(?:me|us|here|my\s+location)`,
);
const BEST = word(String.raw`best|top[\s-]+rated|highest\s+rated|highly\s+rated|top|finest`);
const CHEAPEST = word(String.raw`cheapest|lowest\s+price`);
const CHEAP = word(
  String.raw`cheap|budget|affordable|inexpensive|economical|low\s+cost|pocket\s+friendly`,
);

/** Words that carry no filter. Anything else left over becomes a name search. */
const FILLER = new Set(
  (
    'a an the in at on for of to from me my i we us you want need wanna find show list give get ' +
    'looking look search please restaurant restaurants place places eatery eateries joint joints ' +
    'spot spots outlet outlets food foods cuisine cuisines dish dishes serve serves serving served ' +
    'that which who with having has have and or near around some any good great nice popular famous ' +
    'two 2 rated rating radius kind type is are there where can eat'
  ).split(' '),
);

/** Mutable text: each extractor removes what it understood so the rest can be reported. */
class Working {
  constructor(public value: string) {}

  take(pattern: RegExp, accept: (match: RegExpExecArray) => boolean = () => true) {
    const match = pattern.exec(this.value);
    if (!match || match[0].length === 0 || !accept(match)) return null;
    this.value = `${this.value.slice(0, match.index)} ${this.value.slice(match.index + match[0].length)}`;
    return match;
  }

  takeAll(pattern: RegExp): RegExpExecArray[] {
    const matches: RegExpExecArray[] = [];
    for (let m = this.take(pattern); m; m = this.take(pattern)) matches.push(m);
    return matches;
  }
}

function normalize(q: string): string {
  return q
    .normalize('NFC')
    .toLowerCase()
    .replace(/₹/g, ' rs ')
    .replace(/£/g, ' gbp ')
    .replace(/\$/g, ' usd ')
    .replace(/(?<![\p{L}\p{N}])rs\./gu, 'rs ');
}

const parseAmount = (raw: string | undefined): number => Number((raw ?? '').replace(/,/g, ''));
const validRating = (value: number): boolean => value > 0 && value <= 5;

function extractRadius(text: Working, out: ParsedSearch): void {
  const m = text.take(RADIUS);
  if (!m) return;
  const value = Number(m[1]);
  const metres = /^m(eter|etre)?s?$/.test(m[2] ?? '');
  out.radiusKm = metres ? value / 1000 : value;
}

function extractRating(text: Working, out: ParsedSearch): void {
  for (const pattern of [RATING_ABOVE, RATING_STARS, RATING_OF]) {
    const m = text.take(pattern, (match) => validRating(Number(match[1])));
    if (m) {
      out.minRating = Number(m[1]);
      return;
    }
  }
}

function extractPrice(text: Working, out: ParsedSearch): void {
  const m = text.take(PRICE, (match) => parseAmount(match[2]) > 0);
  if (!m) return;
  const perPerson = /per|each|pp/.test(m[5] ?? '');
  // prices in the data are "for two", so a per-person budget is doubled
  out.maxCostForTwo = parseAmount(m[2]) * (m[3] ? 1000 : 1) * (perPerson ? 2 : 1);
  const currency = CURRENCY_WORDS[m[1] ?? m[4] ?? ''];
  if (currency) out.currency = currency;
}

function extractFlags(text: Working, out: ParsedSearch): void {
  out.nearest = text.take(NEAREST) !== null;
  out.best = text.take(BEST) !== null;
  out.cheapest = text.take(CHEAPEST) !== null;
  if (text.take(CHEAP)) out.maxPriceRange = 2;
}

// compiled alternations are cached per vocabulary lookup (the service rebuilds lookups on refresh)
const compiled = new WeakMap<Lookup, RegExp>();

function vocabularyPattern(lookup: Lookup, extraKeys: string[], suffix: string): RegExp | null {
  const cached = compiled.get(lookup);
  if (cached) return cached;
  const keys = [...lookup.keys(), ...extraKeys].filter(Boolean).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return null;
  const pattern = new RegExp(
    `${START}(${keys.map((key) => phrase(key, String.raw`\s+`)).join('|')})${suffix}${END}`,
    'u',
  );
  compiled.set(lookup, pattern);
  return pattern;
}

const key = (match: RegExpExecArray): string => (match[1] ?? '').replace(/\s+/g, ' ');

function extractCity(text: Working, vocabulary: SearchVocabulary, out: ParsedSearch): void {
  const aliases = Object.keys(CITY_ALIASES).filter((alias) =>
    vocabulary.cities.has(CITY_ALIASES[alias] ?? ''),
  );
  const pattern = vocabularyPattern(vocabulary.cities, aliases, '');
  const m = pattern && text.take(pattern);
  if (!m) return;
  const name = key(m);
  const city = vocabulary.cities.get(CITY_ALIASES[name] ?? name);
  if (city) out.city = city;
}

function extractCuisines(text: Working, vocabulary: SearchVocabulary, out: ParsedSearch): void {
  const pattern = vocabularyPattern(vocabulary.cuisines, [], '(?:s|es)?');
  if (!pattern) return;
  for (const m of text.takeAll(pattern)) {
    const cuisine = vocabulary.cuisines.get(key(m));
    if (cuisine && !out.cuisines.includes(cuisine)) out.cuisines.push(cuisine);
  }
}

const dishPattern = new RegExp(
  `${START}(${Object.keys(DISH_SYNONYMS)
    .sort((a, b) => b.length - a.length)
    .map((dish) => phrase(dish, String.raw`\s*`))
    .join('|')})${END}`,
  'u',
);

function extractDishes(text: Working, vocabulary: SearchVocabulary, out: ParsedSearch): void {
  const dish: NonNullable<ParsedSearch['dish']> = { terms: [], names: [], cuisines: [] };
  for (const m of text.takeAll(dishPattern)) {
    // "vadapav" / "vada  pav" -> the table key "vada pav"
    const term = Object.keys(DISH_SYNONYMS).find(
      (candidate) => candidate.replace(/\s+/g, '') === (m[1] ?? '').replace(/\s+/g, ''),
    );
    const synonym = term && DISH_SYNONYMS[term];
    if (!term || !synonym) continue;
    dish.terms.push(term);
    dish.names.push(...synonym.names);
    for (const cuisine of synonym.cuisines) {
      const canonical = vocabulary.cuisines.get(cuisine.toLowerCase());
      if (canonical) dish.cuisines.push(canonical);
    }
  }
  if (dish.terms.length > 0) {
    out.dish = {
      terms: [...new Set(dish.terms)],
      names: [...new Set(dish.names)],
      cuisines: [...new Set(dish.cuisines)],
    };
  }
}

function leftovers(text: Working): string[] {
  return text.value
    .split(/[^\p{L}\p{N}'&-]+/u)
    .map((token) => token.replace(/^['&-]+|['&-]+$/g, ''))
    .filter((token) => token && !FILLER.has(token));
}

/**
 * Turns "Best restaurants in Gurgaon with South Indian Food" into filters. Pure and
 * deterministic: no I/O, so every rule is unit-testable. Order matters: numbers and phrases
 * are consumed before entity words so e.g. "under 1000" is never mistaken for a name.
 */
export function parseSearchQuery(q: string, vocabulary: SearchVocabulary): ParsedSearch {
  const text = new Working(normalize(q));
  const out: ParsedSearch = {
    cuisines: [],
    best: false,
    nearest: false,
    cheapest: false,
    unparsedTerms: [],
  };
  extractRadius(text, out);
  extractRating(text, out);
  extractPrice(text, out);
  extractFlags(text, out);
  extractCity(text, vocabulary, out);
  extractCuisines(text, vocabulary, out);
  extractDishes(text, vocabulary, out);
  out.unparsedTerms = leftovers(text);
  return out;
}
