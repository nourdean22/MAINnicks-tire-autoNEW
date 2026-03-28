/**
 * Cache Layer — Redis with in-memory fallback
 * If REDIS_URL is set, uses Redis. Otherwise, uses a simple Map cache.
 * All functions are no-op safe — the app works without caching.
 */

import { createLogger } from "./logger";

const log = createLogger("cache");

// ─── In-memory fallback cache ───────────────────
const memCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_MEM_CACHE_ENTRIES = 5000;

let redisClient: {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
} | null = null;

/** Initialize cache — call on server startup */
export async function initCache(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.info("No REDIS_URL — using in-memory cache fallback");
    return;
  }

  try {
    // Dynamic import to avoid crash if ioredis not installed
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });

    client.on("error", (err: Error) => log.error("Redis error", { error: err.message }));
    client.on("connect", () => log.info("Redis connected"));

    await client.connect();
    redisClient = client as any;
    log.info("Redis cache initialized");
  } catch (err) {
    log.warn("Redis unavailable — using in-memory fallback", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Get cached value */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redisClient) {
      const val = await redisClient.get(key);
      return val ? JSON.parse(val) : null;
    }

    // In-memory fallback
    const entry = memCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return JSON.parse(entry.value);
    }
    if (entry) memCache.delete(key); // Expired
    return null;
  } catch {
    return null;
  }
}

/** Set cached value with TTL in seconds */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
  try {
    const serialized = JSON.stringify(value);

    if (redisClient) {
      await redisClient.setex(key, ttlSeconds, serialized);
      return;
    }

    // In-memory fallback — evict expired entries if at capacity
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
  } catch {
    // Silent failure — caching is best-effort
  }
}

/** Delete cached key */
export async function cacheDelete(key: string): Promise<void> {
  try {
    if (redisClient) {
      await redisClient.del(key);
      return;
    }
    memCache.delete(key);
  } catch {}
}

/** Delete all keys matching pattern (Redis only, no-op for memory) */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    if (redisClient) {
      const keys = await redisClient.keys(pattern);
      for (const key of keys) await redisClient.del(key);
      return;
    }
    // In-memory: delete matching keys
    for (const key of memCache.keys()) {
      if (key.startsWith(pattern.replace("*", ""))) memCache.delete(key);
    }
  } catch {}
}

/** Helper: get-or-set pattern */
export async function cached<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const existing = await cacheGet<T>(key);
  if (existing !== null) return existing;

  const fresh = await fetcher();
  await cacheSet(key, fresh, ttlSeconds);
  return fresh;
}

/** Cleanup expired entries (in-memory only — call periodically) */
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
  return {
    type: redisClient ? "redis" : "memory",
    keys: redisClient ? -1 : memCache.size,
  };
}

// Auto-cleanup expired in-memory cache entries every 5 minutes
setInterval(() => {
  if (!redisClient) {
    cleanupMemCache();
  }
}, 5 * 60 * 1000);
