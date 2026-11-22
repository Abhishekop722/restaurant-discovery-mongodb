import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCachedLoader } from '../../src/shared/cache.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('createCachedLoader', () => {
  it('shares one load between concurrent callers', async () => {
    const load = vi.fn(() => Promise.resolve('v'));
    const cached = createCachedLoader(load, 1000);
    await Promise.all([cached.get(), cached.get(), cached.get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL and after invalidate()', async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => Promise.resolve('v'));
    const cached = createCachedLoader(load, 1000);
    await cached.get();
    vi.advanceTimersByTime(1001);
    await cached.get();
    expect(load).toHaveBeenCalledTimes(2);
    cached.invalidate();
    await cached.get();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failure, and a late failure cannot evict a newer value', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('boom'));
    load.mockResolvedValue('ok');
    const cached = createCachedLoader(load, 1000);
    await expect(cached.get()).rejects.toThrow('boom');
    await expect(cached.get()).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
