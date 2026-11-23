import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { toListItem, toRestaurantResponse } from './restaurant.mapper.js';
import {
  createHeadersSchema,
  createRestaurantSchema,
  errorResponseSchema,
  idParamsSchema,
  listQuerySchema,
  listResponseSchema,
  restaurantResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
} from './restaurant.schema.js';
import type { RestaurantService } from './restaurant.service.js';

const tags = ['restaurants'];

// Request/response contracts per endpoint. They also feed the OpenAPI document at /docs.
const createSchema = {
  tags,
  summary: 'Create a restaurant',
  description:
    'Send an Idempotency-Key header to make retries safe: repeating the same request with the same key returns the original restaurant (200) instead of creating another. The same key with a different body returns 409.',
  headers: createHeadersSchema,
  body: createRestaurantSchema,
  response: {
    200: restaurantResponseSchema,
    201: restaurantResponseSchema,
    400: errorResponseSchema,
    409: errorResponseSchema,
  },
};

const getByIdSchema = {
  tags,
  summary: 'Get a restaurant by id',
  params: idParamsSchema,
  response: { 200: restaurantResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
};

const listSchema = {
  tags,
  summary: 'List restaurants',
  description:
    'Filter by name, city, cuisine, rating and cost; sort; paginate; distance when lat and lng are sent.',
  querystring: listQuerySchema,
  response: { 200: listResponseSchema, 400: errorResponseSchema },
};

const searchSchema = {
  tags,
  summary: 'Natural-language search',
  description:
    'Free text such as "best south indian in gurgaon under rs 1000". The response echoes how the text was interpreted. Explicit parameters override the parsed ones.',
  querystring: searchQuerySchema,
  response: { 200: searchResponseSchema, 400: errorResponseSchema },
};

export const restaurantRoutes: FastifyPluginCallbackZod<{ service: RestaurantService }> = (
  app,
  { service },
  done,
) => {
  app.post('/restaurants', { schema: createSchema }, async (request, reply) => {
    const { record, replayed } = await service.create(
      request.body,
      request.headers['idempotency-key'],
    );
    if (replayed) void reply.header('Idempotent-Replayed', 'true');
    return reply
      .code(replayed ? 200 : 201)
      .header('Location', `/v1/restaurants/${record.id}`)
      .send(toRestaurantResponse(record));
  });

  app.get('/restaurants/search', { schema: searchSchema }, async (request) => {
    const { items, hasMore, interpretation, unparsedTerms } = await service.search(request.query);
    return {
      interpretation,
      unparsedTerms,
      data: items.map(toListItem),
      page: { limit: request.query.limit, offset: request.query.offset, hasMore },
    };
  });

  app.get('/restaurants/:id', { schema: getByIdSchema }, async (request) =>
    toRestaurantResponse(await service.getById(request.params.id)),
  );

  app.get('/restaurants', { schema: listSchema }, async (request) => {
    const { items, hasMore } = await service.list(request.query);
    return {
      data: items.map(toListItem),
      page: { limit: request.query.limit, offset: request.query.offset, hasMore },
    };
  });

  done();
};
