import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Config } from './config/index.js';

export interface AppDeps {
  /** Returns true when downstream dependencies (MongoDB) are reachable. */
  isReady: () => Promise<boolean>;
}

/** Builds the Fastify instance without listening, so tests can call it via inject(). */
export function buildApp(config: Pick<Config, 'LOG_LEVEL'>, deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, genReqId: () => crypto.randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.withTypeProvider<ZodTypeProvider>();

  app.get('/health/live', () => ({ status: 'ok' }));

  app.get('/health/ready', async (_req, reply) => {
    const ready = await deps.isReady().catch(() => false);
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable' });
  });

  return app;
}
