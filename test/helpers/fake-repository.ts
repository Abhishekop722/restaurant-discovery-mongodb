import { vi } from 'vitest';

import type {
  ListResult,
  RatingStats,
  RestaurantRecord,
  RestaurantRepository,
  Vocabulary,
} from '../../src/modules/restaurants/restaurant.repository.js';
import type { RestaurantDoc } from '../../src/modules/restaurants/restaurant.schema.js';
import { ConflictError } from '../../src/shared/errors.js';

/** In-memory port implementation that records calls; list returns whatever the test sets. */
export function createFakeRepository(
  vocabulary: Vocabulary = {
    cities: ['Gurgaon', 'New Delhi'],
    cuisines: ['North Indian', 'South Indian', 'Street Food'],
  },
) {
  const records = new Map<string, RestaurantRecord>();
  let listResult: ListResult = { items: [], hasMore: false };
  const byKey = new Map<string, RestaurantRecord>();
  let nextId = 1;

  const repository = {
    create: vi.fn<RestaurantRepository['create']>((doc: RestaurantDoc) => {
      const key = doc.idempotency?.key;
      const earlier = key === undefined ? undefined : byKey.get(key);
      if (earlier) {
        if (earlier.idempotency?.fingerprint !== doc.idempotency?.fingerprint) {
          return Promise.reject(new ConflictError('Idempotency-Key was already used'));
        }
        return Promise.resolve({ record: earlier, replayed: true });
      }
      const id = (nextId++).toString(16).padStart(24, '0');
      const now = new Date();
      const record: RestaurantRecord = { ...doc, id, createdAt: now, updatedAt: now };
      records.set(id, record);
      if (key !== undefined) byKey.set(key, record);
      return Promise.resolve({ record, replayed: false });
    }),
    findById: vi.fn<RestaurantRepository['findById']>((_tenantId, id) =>
      Promise.resolve(records.get(id) ?? null),
    ),
    list: vi.fn<RestaurantRepository['list']>(() => Promise.resolve(listResult)),
    vocabulary: vi.fn<RestaurantRepository['vocabulary']>(() => Promise.resolve(vocabulary)),
    ratingStats: vi.fn<RestaurantRepository['ratingStats']>(() =>
      Promise.resolve<RatingStats>({ meanRating: 3.4 }),
    ),
  } satisfies RestaurantRepository;

  return {
    repository,
    setListResult: (result: ListResult) => {
      listResult = result;
    },
  };
}
