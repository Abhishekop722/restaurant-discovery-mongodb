import { MongoClient, type Db } from 'mongodb';

import type { Config } from '../../config/index.js';

export interface Mongo {
  client: MongoClient;
  db: Db;
  /** True when the server answers a ping; never throws. */
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

/** Connects once at startup; the driver manages its own connection pool. */
export async function connectMongo(
  config: Pick<Config, 'MONGODB_URI' | 'MONGODB_DB'>,
): Promise<Mongo> {
  const client = new MongoClient(config.MONGODB_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5_000,
    appName: 'biteexpress-discovery',
  });
  await client.connect();
  const db = client.db(config.MONGODB_DB);

  return {
    client,
    db,
    ping: async () => {
      try {
        await db.command({ ping: 1 }, { timeoutMS: 2_000 });
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
