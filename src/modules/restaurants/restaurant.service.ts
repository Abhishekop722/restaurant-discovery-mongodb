import { createCachedLoader } from '../../shared/cache.js';
import { COUNTRIES } from '../../shared/countries.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';

import type {
  ListCriteria,
  ListResult,
  RestaurantRecord,
  RestaurantRepository,
} from './restaurant.repository.js';
import type {
  CreateRestaurantInput,
  Interpretation,
  ListQuery,
  RestaurantDoc,
  SearchQuery,
  SearchSortKey,
} from './restaurant.schema.js';
import { canonicalize, CITY_ALIASES, makeLookup, type Lookup } from './restaurant.vocabulary.js';
import {
  RuleBasedQueryParser,
  type ParsedSearch,
  type QueryParser,
} from './search/nl-query-parser.js';

export interface VocabularyLookups {
  cities: Lookup;
  cuisines: Lookup;
}

export interface SearchResult extends ListResult {
  interpretation: Interpretation;
  unparsedTerms: string[];
}

export interface ServiceOptions {
  /** Currency assumed when a search gives an amount without naming one. */
  defaultCurrency: string;
  /** Prior weight (votes) for the weighted "best" score. */
  rankingMinVotes: number;
  parser: QueryParser;
}

const CACHE_TTL_MS = 5 * 60_000;

/** Words in the query decide the sort; with a location and no words, nearest first. */
function sortFor(parsed: ParsedSearch, hasLocation: boolean): SearchSortKey {
  if (parsed.nearest) return 'distance';
  if (parsed.cheapest) return 'cost';
  if (parsed.best) return 'best';
  return hasLocation ? 'distance' : '-rating';
}

type FilterInput = Pick<
  ListQuery,
  'name' | 'city' | 'cuisine' | 'minRating' | 'maxCost' | 'currency'
>;

/** Explicit request parameters win over what was parsed from the text. */
function overrideParsed(query: SearchQuery, parsed: ParsedSearch): FilterInput {
  const leftover = parsed.unparsedTerms.join(' ');
  return {
    // words nothing recognised are searched as a name ("dominos in gurgaon")
    name: query.name ?? (leftover || undefined),
    city: query.city ?? parsed.city,
    cuisine: query.cuisine ?? (parsed.cuisines.length ? parsed.cuisines : undefined),
    minRating: query.minRating ?? parsed.minRating,
    maxCost: query.maxCost ?? parsed.maxCostForTwo,
    currency: query.currency ?? parsed.currency,
  };
}

interface DescribeInput {
  filters: Pick<ListCriteria, 'name' | 'city' | 'cuisines' | 'minRating' | 'maxCost' | 'currency'>;
  currency: string | undefined;
  parsed: ParsedSearch;
  near: { lat: number; lng: number } | undefined;
  radiusKm: number | undefined;
  sort: SearchSortKey;
}

/** How the query was understood: only what was actually applied is listed. */
function describe({
  filters,
  currency,
  parsed,
  near,
  radiusKm,
  sort,
}: DescribeInput): Interpretation {
  return {
    ...(filters.city && { city: filters.city }),
    ...(filters.cuisines?.length && { cuisines: filters.cuisines }),
    ...(parsed.dish && { dish: parsed.dish.terms }),
    ...(filters.name && { name: filters.name }),
    ...(filters.minRating !== undefined && { minRating: filters.minRating }),
    ...(filters.maxCost !== undefined && { maxCostForTwo: filters.maxCost }),
    ...(currency && { currency }),
    ...(parsed.maxPriceRange !== undefined && { maxPriceRange: parsed.maxPriceRange }),
    ...(radiusKm !== undefined && { radiusKm }),
    ...(near && { nearestTo: { latitude: near.lat, longitude: near.lng } }),
    sort,
  };
}

const NEEDS_LOCATION =
  'this query asks for nearby results; send lat and lng so distances can be computed';

export class RestaurantService {
  private readonly options: ServiceOptions;
  // lazy loaders: they only call the repository when first used
  private readonly vocabulary = createCachedLoader(async (): Promise<VocabularyLookups> => {
    const { cities, cuisines } = await this.repository.vocabulary(this.tenantId);
    return { cities: makeLookup(cities), cuisines: makeLookup(cuisines) };
  }, CACHE_TTL_MS);
  private readonly ratingStats = createCachedLoader(
    () => this.repository.ratingStats(this.tenantId),
    CACHE_TTL_MS,
  );

  constructor(
    private readonly repository: RestaurantRepository,
    private readonly tenantId: string,
    options: Partial<ServiceOptions> = {},
  ) {
    this.options = {
      defaultCurrency: 'INR',
      rankingMinVotes: 100,
      parser: new RuleBasedQueryParser(),
      ...options,
    };
  }

  /** Cached distinct cities/cuisines; refreshed on a TTL and after every create. */
  getVocabulary(): Promise<VocabularyLookups> {
    return this.vocabulary.get();
  }

  async create(input: CreateRestaurantInput): Promise<RestaurantRecord> {
    const country = COUNTRIES[input.address.countryCode];
    if (!country) {
      throw new BadRequestError(`unknown countryCode ${String(input.address.countryCode)}`);
    }
    const vocabulary = await this.getVocabulary();
    const cuisines = [...new Set(input.cuisines.map((c) => canonicalize(c, vocabulary.cuisines)))];

    const doc: RestaurantDoc = {
      tenantId: this.tenantId,
      ...(input.externalId !== undefined && { externalId: input.externalId }),
      name: input.name,
      address: {
        line: input.address.line,
        locality: input.address.locality,
        localityVerbose: input.address.locality,
        city: canonicalize(input.address.city, vocabulary.cities, CITY_ALIASES),
        countryCode: input.address.countryCode,
        country: country.name,
      },
      ...(input.location && {
        location: {
          type: 'Point' as const,
          coordinates: [input.location.longitude, input.location.latitude],
        },
      }),
      cuisines,
      pricing: {
        ...(input.pricing.averageCostForTwo !== undefined && {
          averageCostForTwo: input.pricing.averageCostForTwo,
        }),
        currency: country.currency,
        priceRange: input.pricing.priceRange,
      },
      flags: input.flags,
      rating: { text: 'Not rated', votes: 0 },
      schemaVersion: 1,
    };

    const record = await this.repository.create(doc);
    this.vocabulary.invalidate(); // a new city/cuisine may have appeared
    return record;
  }

  async getById(id: string): Promise<RestaurantRecord> {
    const record = await this.repository.findById(this.tenantId, id);
    if (!record) throw new NotFoundError(`restaurant ${id} not found`);
    return record;
  }

  async list(query: ListQuery): Promise<ListResult> {
    const vocabulary = await this.getVocabulary();
    const near =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng, radiusKm: query.radiusKm }
        : undefined;
    return this.repository.list({
      ...this.filters(query, vocabulary),
      near,
      // nearest first when a point is given, otherwise best rated first
      sort: query.sort ?? (near ? 'distance' : '-rating'),
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Natural-language search. The parser turns `q` into filters; explicit parameters
   * (city, cuisine, maxCost, sort, ...) override what was parsed, then the same repository
   * query as the list endpoint runs. The interpretation is returned so it can be checked.
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const [vocabulary, stats] = await Promise.all([this.getVocabulary(), this.ratingStats.get()]);
    const parsed = await this.options.parser.parse(query.q, vocabulary);

    const near =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : undefined;
    const radiusKm = query.radiusKm ?? parsed.radiusKm;
    const sort = query.sort ?? sortFor(parsed, near !== undefined);

    const filters = this.filters(overrideParsed(query, parsed), vocabulary);
    // an amount without a currency is read in the deployment's default currency
    const currency =
      filters.currency ??
      (filters.maxCost === undefined ? undefined : this.options.defaultCurrency);

    const interpretation = describe({ filters, currency, parsed, near, radiusKm, sort });
    if (!near && (sort === 'distance' || radiusKm !== undefined)) {
      throw new BadRequestError(NEEDS_LOCATION, { interpretation });
    }

    const result = await this.repository.list({
      ...filters,
      currency,
      maxPriceRange: parsed.maxPriceRange,
      dish: parsed.dish && { names: parsed.dish.names, cuisines: parsed.dish.cuisines },
      near: near && { ...near, radiusKm },
      ranking: { priorVotes: this.options.rankingMinVotes, priorMean: stats.meanRating },
      sort,
      limit: query.limit,
      offset: query.offset,
    });
    return { ...result, interpretation, unparsedTerms: parsed.unparsedTerms };
  }

  /** Canonicalises user-supplied filter values against the stored vocabulary. */
  private filters(
    input: FilterInput,
    vocabulary: VocabularyLookups,
  ): Pick<
    ListCriteria,
    'tenantId' | 'name' | 'city' | 'cuisines' | 'minRating' | 'maxCost' | 'currency'
  > {
    return {
      tenantId: this.tenantId,
      name: input.name,
      city: input.city && canonicalize(input.city, vocabulary.cities, CITY_ALIASES),
      cuisines: input.cuisine?.map((c) => canonicalize(c, vocabulary.cuisines)),
      minRating: input.minRating,
      maxCost: input.maxCost,
      currency: input.currency,
    };
  }
}
