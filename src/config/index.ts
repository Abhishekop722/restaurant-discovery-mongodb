import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/?replicaSet=rs0'),
  MONGODB_DB: z.string().min(1).default('biteexpress'),
  /** Server-side limit per MongoDB query; slow queries fail fast instead of piling up at peak. */
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  /** Currency assumed when a search says "under 1000" without naming one. */
  DEFAULT_CURRENCY: z.string().length(3).toUpperCase().default('INR'),
  /** Votes needed before a rating is trusted by the weighted "best" score (dataset median is ~60). */
  RANKING_MIN_VOTES: z.coerce.number().int().min(1).default(100),
  /** Business this deployment serves; every document and index is scoped by it. */
  TENANT_ID: z.string().min(1).default('biteexpress'),
  /** Load the dataset on startup when the collection is empty. */
  SEED_ON_START: z.stringbool().default(false),
  SEED_FILE: z.string().min(1).optional(),
});

export type Config = z.infer<typeof envSchema>;

/** Parses and validates environment variables once, failing fast on bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}
