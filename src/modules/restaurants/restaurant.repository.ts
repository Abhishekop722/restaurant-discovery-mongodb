import type { RestaurantDoc, SearchSortKey, StoredRestaurant } from './restaurant.schema.js';

/** A stored restaurant with its public identifier. */
export type RestaurantRecord = StoredRestaurant & { id: string };

export interface NearCriteria {
  lat: number;
  lng: number;
  radiusKm?: number | undefined;
}

/** Priors for the weighted score (see search/ranking.ts). */
export interface RankingPriors {
  /** Votes needed before a restaurant's own rating is trusted. */
  priorVotes: number;
  /** Mean rating across all rated restaurants. */
  priorMean: number;
}

/** A dish: matched by name, or by a cuisine that effectively is the dish. */
interface DishCriteria {
  names: string[];
  cuisines: string[];
}

/** Normalised, service-validated list parameters (canonical city/cuisine spellings, defaults applied). */
export interface ListCriteria {
  tenantId: string;
  name?: string | undefined;
  city?: string | undefined;
  cuisines?: string[] | undefined;
  minRating?: number | undefined;
  maxCost?: number | undefined;
  currency?: string | undefined;
  near?: NearCriteria | undefined;
  maxPriceRange?: number | undefined;
  dish?: DishCriteria | undefined;
  /** Required when sort is 'best'. */
  ranking?: RankingPriors | undefined;
  sort: SearchSortKey;
  limit: number;
  offset: number;
}

export interface ListRow {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  country: string;
  cuisines: string[];
  averageRating?: number | undefined;
  votes: number;
  averageCostForTwo?: number | undefined;
  currency: string;
  distanceMeters?: number | undefined;
  score?: number | undefined;
}

export interface ListResult {
  items: ListRow[];
  hasMore: boolean;
}

export interface Vocabulary {
  cities: string[];
  cuisines: string[];
}

export interface RatingStats {
  /** Mean of the average ratings of rated restaurants (0 when none are rated). */
  meanRating: number;
}

export interface CreateResult {
  record: RestaurantRecord;
  /** True when an earlier request with the same Idempotency-Key already created it. */
  replayed: boolean;
}

/** Port the service depends on; the MongoDB adapter implements it. */
export interface RestaurantRepository {
  /**
   * Inserts the restaurant. When `doc.idempotency` is set and a restaurant with the same key
   * already exists, returns it with `replayed: true` (same fingerprint) or throws a conflict.
   */
  create(doc: RestaurantDoc): Promise<CreateResult>;
  findById(tenantId: string, id: string): Promise<RestaurantRecord | null>;
  list(criteria: ListCriteria): Promise<ListResult>;
  vocabulary(tenantId: string): Promise<Vocabulary>;
  ratingStats(tenantId: string): Promise<RatingStats>;
}
