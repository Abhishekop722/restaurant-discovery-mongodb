import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
import { connectMongo } from './infra/mongo/client.js';
import { restaurantsCollection } from './infra/mongo/collections.js';
import { ensureIndexes } from './infra/mongo/indexes.js';
import { resolveSeedFile } from './infra/seed/resolve-file.js';
import { seedFromFile } from './infra/seed/seed.js';
import { MongoRestaurantRepository } from './modules/restaurants/restaurant.mongo-repository.js';
import { RestaurantService } from './modules/restaurants/restaurant.service.js';

const config = loadConfig();
const mongo = await connectMongo(config);
const restaurants = new RestaurantService(
  new MongoRestaurantRepository(mongo.db, config.QUERY_TIMEOUT_MS),
  config.TENANT_ID,
  { defaultCurrency: config.DEFAULT_CURRENCY, rankingMinVotes: config.RANKING_MIN_VOTES },
);
const app = buildApp(config, { isReady: mongo.ping, restaurants });

await ensureIndexes(mongo.db);
if (
  config.SEED_ON_START &&
  (await restaurantsCollection(mongo.db).estimatedDocumentCount()) === 0
) {
  const file = resolveSeedFile(config.SEED_FILE);
  app.log.info({ file }, 'collection empty, seeding');
  app.log.info(await seedFromFile(mongo.db, file, config.TENANT_ID), 'seed complete');
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close(); // stop accepting requests and drain in-flight ones
  await mongo.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
