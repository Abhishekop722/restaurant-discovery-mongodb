import { buildApp, type AppConfig } from '../../src/app.js';
import type { RestaurantRepository } from '../../src/modules/restaurants/restaurant.repository.js';
import { RestaurantService } from '../../src/modules/restaurants/restaurant.service.js';

export function buildTestApp(
  repository: RestaurantRepository,
  isReady = () => Promise.resolve(true),
  config: Partial<AppConfig> = {},
) {
  const restaurants = new RestaurantService(repository, 'test-tenant');
  return buildApp(
    { LOG_LEVEL: 'silent', RATE_LIMIT_MAX: 10_000, TRUST_PROXY: false, ...config },
    { isReady, restaurants },
  );
}
