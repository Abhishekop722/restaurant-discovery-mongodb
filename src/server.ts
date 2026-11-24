import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createGroqClient } from './infra/llm/groq-client.js';
import { connectMongo } from './infra/mongo/client.js';
import { restaurantsCollection } from './infra/mongo/collections.js';
import { ensureIndexes } from './infra/mongo/indexes.js';
import { resolveSeedFile } from './infra/seed/resolve-file.js';
import { seedFromFile } from './infra/seed/seed.js';
import { MongoRestaurantRepository } from './modules/restaurants/restaurant.mongo-repository.js';
import { RestaurantService } from './modules/restaurants/restaurant.service.js';
import { LlmQueryParser } from './modules/restaurants/search/llm-query-parser.js';
import { RuleBasedQueryParser } from './modules/restaurants/search/nl-query-parser.js';

const config = loadConfig();
const mongo = await connectMongo(config);
// the logger exists only once the app is built, so the fallback hook reads it lazily
const hooks: { warn?: (error: unknown, message: string) => void } = {};
const parser = config.GROQ_API_KEY
  ? new LlmQueryParser(
      createGroqClient({
        apiKey: config.GROQ_API_KEY,
        model: config.GROQ_MODEL,
        timeoutMs: config.GROQ_TIMEOUT_MS,
      }),
      new RuleBasedQueryParser(),
      (error) => hooks.warn?.(error, 'groq parse failed, used rule-based parser'),
    )
  : new RuleBasedQueryParser();
const restaurants = new RestaurantService(
  new MongoRestaurantRepository(mongo.db, config.QUERY_TIMEOUT_MS),
  config.TENANT_ID,
  { defaultCurrency: config.DEFAULT_CURRENCY, rankingMinVotes: config.RANKING_MIN_VOTES, parser },
);
const app = buildApp(config, { isReady: mongo.ping, restaurants });
hooks.warn = (error, message) => {
  app.log.warn({ err: error }, message);
};
app.log.info(
  { parser: config.GROQ_API_KEY ? `groq:${config.GROQ_MODEL}` : 'rules' },
  'search parser',
);

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
