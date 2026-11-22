import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
import { connectMongo } from './infra/mongo/client.js';

const config = loadConfig();
const mongo = await connectMongo(config);
const app = buildApp(config, { isReady: mongo.ping });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close(); // stop accepting requests and drain in-flight ones
  await mongo.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
