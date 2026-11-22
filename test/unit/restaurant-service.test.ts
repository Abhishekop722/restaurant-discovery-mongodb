import { afterEach, describe, expect, it, vi } from 'vitest';

import { RestaurantService } from '../../src/modules/restaurants/restaurant.service.js';
import { createFakeRepository } from '../helpers/fake-repository.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('RestaurantService vocabulary cache', () => {
  it('loads once, then serves from cache until the TTL expires', async () => {
    vi.useFakeTimers();
    const { repository } = createFakeRepository();
    const service = new RestaurantService(repository, 't');

    await service.getVocabulary();
    await service.getVocabulary();
    expect(repository.vocabulary).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    await service.getVocabulary();
    expect(repository.vocabulary).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    const { repository } = createFakeRepository();
    repository.vocabulary.mockRejectedValueOnce(new Error('db down'));
    const service = new RestaurantService(repository, 't');

    await expect(service.getVocabulary()).rejects.toThrow('db down');
    await expect(service.getVocabulary()).resolves.toBeDefined();
  });

  it('refreshes after a create so new cities and cuisines are picked up', async () => {
    const { repository } = createFakeRepository();
    const service = new RestaurantService(repository, 't');
    await service.getVocabulary();
    await service.create({
      name: 'N',
      address: { line: 'l', locality: '', city: 'Pune', countryCode: 1 },
      cuisines: [],
      pricing: { priceRange: 1 },
      flags: {
        hasTableBooking: false,
        hasOnlineDelivery: false,
        isDeliveringNow: false,
        switchToOrderMenu: false,
      },
    });
    await service.getVocabulary();
    expect(repository.vocabulary).toHaveBeenCalledTimes(2);
  });
});
