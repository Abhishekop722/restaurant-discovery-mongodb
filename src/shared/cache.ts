export interface CachedLoader<T> {
  get: () => Promise<T>;
  /** Forces the next get() to reload. */
  invalidate: () => void;
}

/** Caches an async loader for ttlMs; concurrent callers share one load and a failure is never cached. */
export function createCachedLoader<T>(load: () => Promise<T>, ttlMs: number): CachedLoader<T> {
  let value: Promise<T> | undefined;
  let expiresAt = 0;
  return {
    get() {
      if (!value || Date.now() >= expiresAt) {
        expiresAt = Date.now() + ttlMs;
        const pending = load().catch((error: unknown) => {
          if (value === pending) value = undefined;
          throw error;
        });
        value = pending;
      }
      return value;
    },
    invalidate() {
      value = undefined;
    },
  };
}
