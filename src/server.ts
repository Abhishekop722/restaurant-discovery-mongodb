import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';

const config = loadConfig();
// MongoDB wiring arrives in the next block; until then readiness is always true.
const app = buildApp(config, { isReady: () => Promise.resolve(true) });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
