import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { toListItem, toRestaurantResponse } from './restaurant.mapper.js';
import {
  createRestaurantSchema,
  idParamsSchema,
  listQuerySchema,
  listResponseSchema,
  restaurantResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
} from './restaurant.schema.js';
import type { RestaurantService } from './restaurant.service.js';

export const restaurantRoutes: FastifyPluginCallbackZod<{ service: RestaurantService }> = (
  app,
  { service },
  done,
) => {
  app.post(
    '/restaurants',
    { schema: { body: createRestaurantSchema, response: { 201: restaurantResponseSchema } } },
    async (request, reply) => {
      const record = await service.create(request.body);
      return reply
        .code(201)
        .header('Location', `/v1/restaurants/${record.id}`)
        .send(toRestaurantResponse(record));
    },
  );

  app.get(
    '/restaurants/search',
    { schema: { querystring: searchQuerySchema, response: { 200: searchResponseSchema } } },
    async (request) => {
      const { items, hasMore, interpretation, unparsedTerms } = await service.search(request.query);
      return {
        interpretation,
        unparsedTerms,
        data: items.map(toListItem),
        page: { limit: request.query.limit, offset: request.query.offset, hasMore },
      };
    },
  );

  app.get(
    '/restaurants/:id',
    { schema: { params: idParamsSchema, response: { 200: restaurantResponseSchema } } },
    async (request) => toRestaurantResponse(await service.getById(request.params.id)),
  );

  app.get(
    '/restaurants',
    { schema: { querystring: listQuerySchema, response: { 200: listResponseSchema } } },
    async (request) => {
      const { items, hasMore } = await service.list(request.query);
      return {
        data: items.map(toListItem),
        page: { limit: request.query.limit, offset: request.query.offset, hasMore },
      };
    },
  );

  done();
};
