import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyPluginCallback } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { Config } from './config/index.js';
import { restaurantRoutes } from './modules/restaurants/restaurant.routes.js';
import type { RestaurantService } from './modules/restaurants/restaurant.service.js';
import { AppError, errorBody } from './shared/errors.js';

export type AppConfig = Pick<Config, 'LOG_LEVEL' | 'RATE_LIMIT_MAX' | 'TRUST_PROXY'>;

export interface AppDeps {
  /** Returns true when downstream dependencies (MongoDB) are reachable. */
  isReady: () => Promise<boolean>;
  restaurants: RestaurantService;
}

const clientStatus = (error: unknown): number | undefined => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

const healthRoutes =
  (deps: Pick<AppDeps, 'isReady'>): FastifyPluginCallback =>
  (app, _options, done) => {
    app.get('/health/live', { schema: { tags: ['health'], summary: 'Liveness probe' } }, () => ({
      status: 'ok',
    }));
    app.get(
      '/health/ready',
      { schema: { tags: ['health'], summary: 'Readiness probe (pings MongoDB)' } },
      async (_request, reply) => {
        const ready = await deps.isReady().catch(() => false);
        return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable' });
      },
    );
    done();
  };

/** Builds the Fastify instance without listening, so tests can call it via inject(). */
export function buildApp(config: AppConfig, deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    genReqId: () => crypto.randomUUID(),
    trustProxy: config.TRUST_PROXY,
  });
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

  // Plugins load in registration order: swagger first so it sees every route after it.
  void app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'BiteExpress restaurant discovery API',
        description:
          'Restaurant discovery on MongoDB: create, fetch, filter/sort by rating, price and distance, and natural-language search.',
        version: '0.1.0',
      },
      tags: [
        { name: 'restaurants', description: 'Restaurant discovery' },
        { name: 'health', description: 'Liveness and readiness probes' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  void app.register(swaggerUi, { routePrefix: '/docs' });
  void app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // probes and docs must never be throttled
    allowList: (request) => request.url.startsWith('/health') || request.url.startsWith('/docs'),
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'rate_limited', `rate limit exceeded, retry in ${context.after}`),
  });
  void app.register(healthRoutes(deps));
  void app.register(restaurantRoutes, { prefix: '/v1', service: deps.restaurants });

  return app;
}
