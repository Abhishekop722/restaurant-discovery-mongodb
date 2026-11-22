import { loadConfig } from '../../config/index.js';
import { connectMongo } from '../mongo/client.js';
import { ensureIndexes } from '../mongo/indexes.js';

import { resolveSeedFile } from './resolve-file.js';
import { seedFromFile } from './seed.js';

const config = loadConfig();
const file = resolveSeedFile(config.SEED_FILE);
const mongo = await connectMongo(config);
try {
  await ensureIndexes(mongo.db);
  console.log(`Seeding ${file} ...`);
  console.log(await seedFromFile(mongo.db, file, config.TENANT_ID));
} finally {
  await mongo.close();
}
