import { z } from 'zod';

/** An empty variable (e.g. `KEY=` or a compose default) means "not set". */
const blankAsUnset = (value: unknown): unknown => (value === '' ? undefined : value);

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
  /** Requests per minute per client IP (in-memory, per instance; a shared store is the next step). */
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  /** Set true behind a gateway/load balancer so rate limiting and logs see the real client IP. */
  TRUST_PROXY: z.stringbool().default(false),
  /** Business this deployment serves; every document and index is scoped by it. */
  TENANT_ID: z.string().min(1).default('biteexpress'),
  /** Load the dataset on startup when the collection is empty. */
  SEED_ON_START: z.stringbool().default(false),
  SEED_FILE: z.string().min(1).optional(),
  /** When set, natural-language search asks Groq to parse the text; otherwise the rules are used. */
  GROQ_API_KEY: z.preprocess(blankAsUnset, z.string().min(1).optional()),
  GROQ_MODEL: z.preprocess(blankAsUnset, z.string().min(1).default('llama-3.1-8b-instant')),
  /** Give up on the model after this long and use the rule-based parser instead. */
  GROQ_TIMEOUT_MS: z.preprocess(blankAsUnset, z.coerce.number().int().min(100).default(2000)),
});

export type Config = z.infer<typeof envSchema>;

/** Parses and validates environment variables once, failing fast on bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}
