import { MongoServerError, ObjectId, type Collection, type Db, type WithId } from 'mongodb';

import { restaurantsCollection } from '../../infra/mongo/collections.js';
import { ConflictError } from '../../shared/errors.js';

import {
  buildBestPipeline,
  buildGeoPipeline,
  buildMatch,
  buildSort,
  LIST_PROJECTION,
} from './restaurant.mongo-query.js';
import type {
  ListCriteria,
  ListResult,
  ListRow,
  RatingStats,
  RestaurantRecord,
  RestaurantRepository,
  Vocabulary,
} from './restaurant.repository.js';
import type { RestaurantDoc, StoredRestaurant } from './restaurant.schema.js';

const DUPLICATE_KEY = 11000;

/** The shape returned by the list projection (plus distance on the geo path). */
interface ListDoc {
  _id: ObjectId;
  name: string;
  address: { line: string; city: string; country: string };
  cuisines: string[];
  rating: { average?: number; votes: number };
  pricing: { averageCostForTwo?: number; currency: string };
  distanceMeters?: number;
  score?: number;
}

function toRecord({ _id, ...rest }: WithId<StoredRestaurant>): RestaurantRecord {
  return { ...rest, id: _id.toHexString() };
}

function toRow(doc: ListDoc): ListRow {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    addressLine: doc.address.line,
    city: doc.address.city,
    country: doc.address.country,
    cuisines: doc.cuisines,
    averageRating: doc.rating.average,
    votes: doc.rating.votes,
    averageCostForTwo: doc.pricing.averageCostForTwo,
    currency: doc.pricing.currency,
    distanceMeters: doc.distanceMeters,
    score: doc.score,
  };
}

export class MongoRestaurantRepository implements RestaurantRepository {
  private readonly collection: Collection<StoredRestaurant>;

  constructor(
    db: Db,
    /** Server-side time limit per query, so a slow query fails fast instead of piling up at peak. */
    private readonly maxTimeMS: number,
  ) {
    this.collection = restaurantsCollection(db);
  }

  async create(doc: RestaurantDoc): Promise<RestaurantRecord> {
    const now = new Date();
    const stored: StoredRestaurant = { ...doc, createdAt: now, updatedAt: now };
    try {
      const { insertedId } = await this.collection.insertOne(stored);
      return { ...stored, id: insertedId.toHexString() };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        throw new ConflictError(
          `restaurant with externalId ${String(doc.externalId)} already exists`,
        );
      }
      throw error;
    }
  }

  async findById(tenantId: string, id: string): Promise<RestaurantRecord | null> {
    const doc = await this.collection.findOne(
      { _id: new ObjectId(id), tenantId },
      { maxTimeMS: this.maxTimeMS },
    );
    return doc ? toRecord(doc) : null;
  }

  async list(criteria: ListCriteria): Promise<ListResult> {
    // fetch one extra row to learn whether another page exists, without a count query
    const fetchLimit = criteria.limit + 1;
    const docs = await this.fetchPage(criteria, fetchLimit);
    return {
      items: docs.slice(0, criteria.limit).map(toRow),
      hasMore: docs.length > criteria.limit,
    };
  }

  private fetchPage(c: ListCriteria, fetchLimit: number): Promise<ListDoc[]> {
    if (c.near) return this.listNear(c, c.near, fetchLimit);
    if (c.sort === 'best') {
      return this.collection
        .aggregate<ListDoc>(buildBestPipeline(c, fetchLimit), { maxTimeMS: this.maxTimeMS })
        .toArray();
    }
    return this.listPlain(c, fetchLimit);
  }

  private listPlain(c: ListCriteria, fetchLimit: number): Promise<ListDoc[]> {
    // 'distance' needs a point and 'best' has its own pipeline; both are routed before this
    const sort = c.sort === 'distance' || c.sort === 'best' ? '-rating' : c.sort;
    return this.collection
      .find<ListDoc>(buildMatch(c), {
        projection: LIST_PROJECTION,
        sort: buildSort(sort),
        skip: c.offset,
        limit: fetchLimit,
        maxTimeMS: this.maxTimeMS,
      })
      .toArray();
  }

  private listNear(
    c: ListCriteria,
    near: NonNullable<ListCriteria['near']>,
    fetchLimit: number,
  ): Promise<ListDoc[]> {
    return this.collection
      .aggregate<ListDoc>(buildGeoPipeline(c, near, fetchLimit), { maxTimeMS: this.maxTimeMS })
      .toArray();
  }

  /** Distinct cities and cuisines, used to canonicalise user input and by the search parser. */
  async vocabulary(tenantId: string): Promise<Vocabulary> {
    const [cities, cuisines] = await Promise.all([
      this.collection.distinct('address.city', { tenantId }, { maxTimeMS: this.maxTimeMS }),
      this.collection.distinct('cuisines', { tenantId }, { maxTimeMS: this.maxTimeMS }),
    ]);
    return { cities: (cities as string[]).sort(), cuisines: cuisines.sort() };
  }

  /** Mean rating of rated restaurants: the prior for the weighted score. */
  async ratingStats(tenantId: string): Promise<RatingStats> {
    const [row] = await this.collection
      .aggregate<{ mean: number }>(
        [
          { $match: { tenantId, 'rating.average': { $gt: 0 } } },
          { $group: { _id: null, mean: { $avg: '$rating.average' } } },
        ],
        { maxTimeMS: this.maxTimeMS },
      )
      .toArray();
    return { meanRating: row?.mean ?? 0 };
  }
}
