import type { AnyBulkWriteOperation, Db } from 'mongodb';

import type { StoredRestaurant } from '../../modules/restaurants/restaurant.schema.js';
import { restaurantsCollection } from '../mongo/collections.js';

import { cleanRow } from './clean-row.js';
import { loadCsvRows } from './load-csv.js';

export interface SeedSummary {
  read: number;
  inserted: number;
  updated: number;
  rejected: number;
  rejectedReasons: Record<string, number>;
}

const BATCH_SIZE = 1000;

/**
 * Loads the CSV and upserts by (tenantId, externalId): running it twice leaves the same
 * documents, and re-running after a cleaning rule changes updates them in place.
 */
export async function seedFromFile(db: Db, file: string, tenantId: string): Promise<SeedSummary> {
  const rows = await loadCsvRows(file);
  const summary: SeedSummary = {
    read: rows.length,
    inserted: 0,
    updated: 0,
    rejected: 0,
    rejectedReasons: {},
  };
  const collection = restaurantsCollection(db);
  const now = new Date();
  let batch: AnyBulkWriteOperation<StoredRestaurant>[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const result = await collection.bulkWrite(batch, { ordered: false });
    summary.inserted += result.upsertedCount;
    summary.updated += result.matchedCount;
    batch = [];
  };

  for (const row of rows) {
    const cleaned = cleanRow(row, tenantId);
    if (!cleaned.ok) {
      summary.rejected += 1;
      summary.rejectedReasons[cleaned.reason] = (summary.rejectedReasons[cleaned.reason] ?? 0) + 1;
      continue;
    }
    const { doc } = cleaned;
    batch.push({
      updateOne: {
        filter: { tenantId, externalId: doc.externalId },
        update: {
          $set: { ...doc, updatedAt: now },
          $setOnInsert: { createdAt: now },
          // a re-seed must drop a location that is no longer valid
          ...(!doc.location && { $unset: { location: '' as const } }),
        },
        upsert: true,
      },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return summary;
}
