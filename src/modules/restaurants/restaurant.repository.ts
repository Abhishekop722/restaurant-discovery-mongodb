import type { RestaurantDoc, SortKey, StoredRestaurant } from './restaurant.schema.js';

/** A stored restaurant with its public identifier. */
export type RestaurantRecord = StoredRestaurant & { id: string };

export interface NearCriteria {
  lat: number;
  lng: number;
  radiusKm?: number | undefined;
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
  sort: SortKey;
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
}

export interface ListResult {
  items: ListRow[];
  hasMore: boolean;
}

export interface Vocabulary {
  cities: string[];
  cuisines: string[];
}

/** Port the service depends on; the MongoDB adapter implements it. */
export interface RestaurantRepository {
  create(doc: RestaurantDoc): Promise<RestaurantRecord>;
  findById(tenantId: string, id: string): Promise<RestaurantRecord | null>;
  list(criteria: ListCriteria): Promise<ListResult>;
  vocabulary(tenantId: string): Promise<Vocabulary>;
}
