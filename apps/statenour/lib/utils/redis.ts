/**
 * Lazy Redis client for Vercel serverless.
 *
 * Pattern: module-level singleton, lazy init, fail-safe.
 * - No REDIS_URL → returns null (caller falls back)
 * - Connection errors → logged once, client nulled, caller falls back
 * - Never throws. Cache is best-effort.
 *
 * Works with any Redis-compatible URL: Upstash (rediss://), Redis Cloud,
 * local Redis, etc. Designed for Vercel where functions stay warm 5-15min
 * so the TCP connection is reused across invocations.
 */

import Redis from "ioredis";

let client: Redis | null = null;
let failed = false;

/**
 * Get the shared Redis client, or null if disabled/failed.
 * Safe to call on every request — it's a cached singleton.
 */
export function getRedis(): Redis | null {
  if (failed) return null;
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    client = new Redis(url, {
      // Lazy: don't connect until the first command
      lazyConnect: true,
      // Fail fast — serverless can't wait 10s for a dead Redis
      connectTimeout: 2000,
      commandTimeout: 1500,
      maxRetriesPerRequest: 1,
      // Don't spam logs on retry
      enableOfflineQueue: false,
      // Keep TLS for Upstash
      tls: url.startsWith("rediss://") ? {} : undefined,
    });

    client.on("error", (err) => {
      // Log once, then go silent. Cache falls back to memory/compute.
      if (!failed) {
        console.warn("[redis] client error — disabling L2 cache:", err.message);
        failed = true;
      }
    });

    return client;
  } catch (err) {
    console.warn("[redis] init failed:", err instanceof Error ? err.message : err);
    failed = true;
    return null;
  }
}

/**
 * Namespace prefix for all keys. Prevents collisions if Redis is shared.
 */
const PREFIX = process.env.REDIS_KEY_PREFIX || "statenour:";

export function nsKey(key: string): string {
  return PREFIX + key;
}

/**
 * Safe GET — returns null on miss, parse failure, or any error.
 * Never throws.
 */
export async function redisGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(nsKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Safe SET with TTL. Fire-and-forget — returns true on success, false otherwise.
 * Never throws.
 */
export async function redisSet<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const serialized = JSON.stringify(value);
    await r.set(nsKey(key), serialized, "EX", ttlSeconds);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safe DEL — returns true if deleted, false otherwise.
 */
export async function redisDel(key: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const n = await r.del(nsKey(key));
    return n > 0;
  } catch {
    return false;
  }
}

/**
 * Safe SCAN + DEL by prefix. Uses SCAN to avoid blocking Redis.
 * Returns count of deleted keys.
 */
export async function redisDelPrefix(prefix: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    const fullPrefix = nsKey(prefix);
    const pattern = fullPrefix + "*";
    let cursor = "0";
    let count = 0;
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) {
        count += await r.del(...keys);
      }
    } while (cursor !== "0");
    return count;
  } catch {
    return 0;
  }
}
