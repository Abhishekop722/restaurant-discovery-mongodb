import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { Config } from './config/index.js';
import { restaurantRoutes } from './modules/restaurants/restaurant.routes.js';
import type { RestaurantService } from './modules/restaurants/restaurant.service.js';
import { AppError, errorBody } from './shared/errors.js';

export interface AppDeps {
  /** Returns true when downstream dependencies (MongoDB) are reachable. */
  isReady: () => Promise<boolean>;
  restaurants: RestaurantService;
}

const clientStatus = (error: unknown): number | undefined => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

/** Builds the Fastify instance without listening, so tests can call it via inject(). */
export function buildApp(config: Pick<Config, 'LOG_LEVEL'>, deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, genReqId: () => crypto.randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // every response carries the request id, which is also on every log line
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send(errorBody(error.code, error.message, request.id, error.details));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((v) => ({ path: v.instancePath, message: v.message }));
      return reply.code(400).send(
        errorBody('validation_error', 'request validation failed', request.id, {
          in: error.validationContext,
          issues,
        }),
      );
    }
    const status = clientStatus(error);
    if (status && !isResponseSerializationError(error)) {
      const { message } = error as Error;
      return reply.code(status).send(errorBody('bad_request', message, request.id));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('internal_error', 'internal server error', request.id));
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send(errorBody('not_found', `route ${request.method} ${request.url} not found`, request.id)),
  );

  app.get('/health/live', () => ({ status: 'ok' }));

  app.get('/health/ready', async (_req, reply) => {
    const ready = await deps.isReady().catch(() => false);
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable' });
  });

  void app.register(restaurantRoutes, { prefix: '/v1', service: deps.restaurants });

  return app;
}
