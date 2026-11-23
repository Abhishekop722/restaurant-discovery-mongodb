import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';

import { buildApp } from '../../src/app.js';
import { connectMongo, type Mongo } from '../../src/infra/mongo/client.js';
import { ensureIndexes } from '../../src/infra/mongo/indexes.js';
import { seedFromFile } from '../../src/infra/seed/seed.js';
import { MongoRestaurantRepository } from '../../src/modules/restaurants/restaurant.mongo-repository.js';
import { RestaurantService } from '../../src/modules/restaurants/restaurant.service.js';

export const SAMPLE_CSV = resolve('data/sample.csv');

export interface IntegrationApp {
  app: FastifyInstance;
  mongo: Mongo;
  stop: () => Promise<void>;
}

/** A fresh database on the shared test container, indexed and seeded from the sample CSV. */
export async function startIntegrationApp(tenantId: string): Promise<IntegrationApp> {
  const mongo = await connectMongo({
    MONGODB_URI: inject('mongoUri'),
    MONGODB_DB: `it_${randomUUID().slice(0, 8)}`,
  });
  await ensureIndexes(mongo.db);
  await seedFromFile(mongo.db, SAMPLE_CSV, tenantId);
  const restaurants = new RestaurantService(
    new MongoRestaurantRepository(mongo.db, 5000),
    tenantId,
  );
  const app = buildApp(
    { LOG_LEVEL: 'silent', RATE_LIMIT_MAX: 10_000, TRUST_PROXY: false },
    { isReady: mongo.ping, restaurants },
  );
  return {
    app,
    mongo,
    stop: async () => {
      await mongo.db.dropDatabase();
      await app.close();
      await mongo.close();
    },
  };
}
