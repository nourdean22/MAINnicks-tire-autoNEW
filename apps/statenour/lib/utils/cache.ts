/**
 * Two-tier TTL cache for Vercel serverless.
 *
 * L1: In-memory Map (per-instance, survives warm function ~5-15min)
 * L2: Redis (shared across instances, survives cold starts, optional)
 *
 * Flow on GET:
 *   1. L1 hit? → return
 *   2. L2 hit? → write to L1, return
 *   3. Compute → write to L1 and L2
 *
 * Flow on WRITE:
 *   Both tiers written in parallel. L2 failures are silent.
 *
 * If REDIS_URL is not set (or Redis errors), this degrades gracefully
 * to L1-only — the original behavior. Existing callers don't need changes.
 *
 * Usage:
 *   const revenue = await cached("revenue_today", 30, () => fetchRevenue());
 */

import { redisGet, redisSet, redisDel, redisDelPrefix } from "./redis";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Get a value from cache, or compute it and cache the result.
 * Checks L1 (memory) then L2 (Redis) before computing.
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

  // L1: in-memory
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return entry.value;
  }

  // L2: Redis (may be null / miss / error — all safe)
  const fromRedis = await redisGet<T>(key);
  if (fromRedis !== null) {
    // Hydrate L1 so subsequent same-instance calls skip Redis too
    store.set(key, { value: fromRedis, expiresAt: now + ttlSeconds * 1000 });
    return fromRedis;
  }

  // Miss on both tiers — compute
  const value = await compute();

  // Write to L1 synchronously (instant), L2 fire-and-forget
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  // Don't await — we don't want Redis latency on the critical path
  void redisSet(key, value, ttlSeconds);

  // Lazy cleanup: drop expired entries if map grows large
  if (store.size > 100) {
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
  }

  return value;
}

/**
 * Invalidate a specific cache key in both tiers.
 */
export function invalidate(key: string): void {
  store.delete(key);
  void redisDel(key);
}

/**
 * Invalidate all keys matching a prefix in both tiers.
 * e.g., invalidatePrefix("dashboard_") clears all dashboard caches.
 */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  void redisDelPrefix(prefix);
}
