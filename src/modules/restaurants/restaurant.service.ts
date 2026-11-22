import { COUNTRIES } from '../../shared/countries.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';

import type {
  ListCriteria,
  ListResult,
  RestaurantRecord,
  RestaurantRepository,
} from './restaurant.repository.js';
import type { CreateRestaurantInput, ListQuery, RestaurantDoc } from './restaurant.schema.js';
import { canonicalize, CITY_ALIASES, makeLookup, type Lookup } from './restaurant.vocabulary.js';

export interface VocabularyLookups {
  cities: Lookup;
  cuisines: Lookup;
}

const VOCABULARY_TTL_MS = 5 * 60_000;

export class RestaurantService {
  private vocabulary: Promise<VocabularyLookups> | undefined;
  private vocabularyExpiresAt = 0;

  constructor(
    private readonly repository: RestaurantRepository,
    private readonly tenantId: string,
  ) {}

  /** Cached distinct cities/cuisines; refreshed on a TTL and after every create. */
  getVocabulary(): Promise<VocabularyLookups> {
    if (!this.vocabulary || Date.now() >= this.vocabularyExpiresAt) {
      this.vocabularyExpiresAt = Date.now() + VOCABULARY_TTL_MS;
      this.vocabulary = this.repository
        .vocabulary(this.tenantId)
        .then(({ cities, cuisines }) => ({
          cities: makeLookup(cities),
          cuisines: makeLookup(cuisines),
        }))
        .catch((error: unknown) => {
          this.vocabulary = undefined; // do not cache a failure
          throw error;
        });
    }
    return this.vocabulary;
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
    this.vocabulary = undefined; // a new city/cuisine may have appeared
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

    const criteria: ListCriteria = {
      tenantId: this.tenantId,
      name: query.name,
      city: query.city && canonicalize(query.city, vocabulary.cities, CITY_ALIASES),
      cuisines: query.cuisine?.map((c) => canonicalize(c, vocabulary.cuisines)),
      minRating: query.minRating,
      maxCost: query.maxCost,
      currency: query.currency,
      near,
      // nearest first when a point is given, otherwise best rated first
      sort: query.sort ?? (near ? 'distance' : '-rating'),
      limit: query.limit,
      offset: query.offset,
    };
    return this.repository.list(criteria);
  }
}
