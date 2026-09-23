/**
 * Cache Layer — in-process Map cache with TTL.
 * All functions are no-op safe — the app works without caching.
 * (A Redis path existed here until 2026-09-23; its initializer had no caller,
 * ioredis was never a dependency, and production sets no REDIS_URL.)
 */

import { createLogger } from "./logger";

const log = createLogger("cache");

// ─── In-memory fallback cache ───────────────────
const memCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_MEM_CACHE_ENTRIES = 5000;

/** Get cached value */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const entry = memCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return JSON.parse(entry.value);
    }
    if (entry) memCache.delete(key); // Expired
    return null;
  } catch (err) {
    log.warn("Cache get failed", { key, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Set cached value with TTL in seconds */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
  try {
    const serialized = JSON.stringify(value);

    // Evict expired entries if at capacity
    if (memCache.size >= MAX_MEM_CACHE_ENTRIES) {
      cleanupMemCache();
      // If still over cap after cleanup, evict oldest entries
      if (memCache.size >= MAX_MEM_CACHE_ENTRIES) {
        const entries = Array.from(memCache.entries())
          .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
        const toRemove = memCache.size - Math.floor(MAX_MEM_CACHE_ENTRIES * 0.8);
        for (let i = 0; i < toRemove; i++) memCache.delete(entries[i][0]);
      }
    }
    memCache.set(key, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1000 });
  } catch (e) {
    // Caching is best-effort
    log.warn("[lib/cache] cache write failed:", e);
  }
}

/** Delete cached key */
export async function cacheDelete(key: string): Promise<void> {
  try {
    memCache.delete(key);
  } catch (err) {
    log.warn("Cache delete failed", { key, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Delete all keys matching a prefix pattern (a trailing "*" is stripped) */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    for (const key of memCache.keys()) {
      if (key.startsWith(pattern.replace("*", ""))) memCache.delete(key);
    }
  } catch (err) {
    log.warn("Cache delete pattern failed", { pattern, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Helper: get-or-set pattern */
export async function cached<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const existing = await cacheGet<T>(key);
  if (existing !== null) return existing;

  const fresh = await fetcher();
  await cacheSet(key, fresh, ttlSeconds);
  return fresh;
}

/** Cleanup expired entries (call periodically) */
export function cleanupMemCache(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of memCache) {
    if (entry.expiresAt <= now) {
      memCache.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Cache stats for health check */
export function getCacheStats(): { type: "redis" | "memory"; keys: number } {
  return { type: "memory", keys: memCache.size };
}

// Auto-cleanup expired cache entries every 5 minutes
const cacheCleanupInterval = setInterval(() => {
  cleanupMemCache();
}, 5 * 60 * 1000);

export function shutdownCache() {
  clearInterval(cacheCleanupInterval);
}
