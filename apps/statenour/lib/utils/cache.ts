/**
 * In-process TTL cache.
 *
 * One Map per process. Each Railway replica keeps its own copy, and a
 * restart starts it empty. That is the whole contract: callers that need
 * a value to agree across replicas must not rely on this cache for it.
 *
 * 2026-09-23 · the optional Redis second tier was retired. Railway
 * metrics showed 0 bytes of traffic to the Redis service over the prior
 * 7 days, the client disabled itself for the rest of the process on its
 * first error, and statenour-worker never had REDIS_URL, so nothing was
 * ever shared through it. Behaviour per process is unchanged.
 *
 * Usage:
 *   const revenue = await cached("revenue_today", 30, () => fetchRevenue());
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Get a value from cache, or compute it and cache the result.
 *
 * @param key   Unique cache key
 * @param ttlSeconds  Time to live in seconds
 * @param compute  Async function to compute the value on cache miss
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<T> {
  const now = Date.now();

  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return entry.value;
  }

  const value = await compute();
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });

  // Lazy cleanup: drop expired entries if map grows large
  if (store.size > 100) {
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
  }

  return value;
}

/**
 * Invalidate a specific cache key.
 */
export function invalidate(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all keys matching a prefix.
 * e.g., invalidatePrefix("dashboard_") clears all dashboard caches.
 */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
