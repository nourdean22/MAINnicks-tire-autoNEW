/**
 * Server-side in-memory cache with TTL support.
 * Used for expensive queries (weather, reviews, Instagram, sitemap, etc.)
 * to avoid redundant DB/API calls on every request.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class ServerCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private readonly maxEntries = 2000;

  /**
   * Get a cached value, or compute and cache it if missing/expired.
   * @param key   Unique cache key
   * @param ttlMs Time-to-live in milliseconds
   * @param fn    Async function that produces the value
   */
  async getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const existing = this.store.get(key) as CacheEntry<T> | undefined;
    if (existing && existing.expiresAt > Date.now()) {
      this.hits++;
      return existing.data;
    }

    this.misses++;
    const data = await fn();
    // Evict if at capacity
    if (this.store.size >= this.maxEntries) {
      this.stats(); // Prune expired first
      if (this.store.size >= this.maxEntries) {
        // Delete oldest entry
        const firstKey = this.store.keys().next().value;
        if (firstKey) this.store.delete(firstKey);
      }
    }
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  }

  /** Manually set a value in the cache. */
  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  /** Invalidate a specific cache key. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate all keys matching a prefix. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Clear the entire cache. */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Return cache stats for the health endpoint. */
  stats() {
    // Prune expired entries while counting
    let active = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      } else {
        active++;
      }
    }
    return {
      entries: active,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100) + "%"
        : "0%",
    };
  }
}

export const serverCache = new ServerCache();

// Auto-prune expired entries every 5 minutes
setInterval(() => {
  serverCache.stats(); // stats() already prunes expired entries
}, 5 * 60 * 1000);

// ─── Common TTL constants ─────────────────────────────
export const CACHE_TTL = {
  WEATHER: 10 * 60 * 1000,        // 10 minutes
  REVIEWS: 30 * 60 * 1000,        // 30 minutes
  INSTAGRAM: 60 * 60 * 1000,      // 1 hour
  COUPONS: 5 * 60 * 1000,         // 5 minutes
  SITEMAP: 60 * 60 * 1000,        // 1 hour
  BLOG_LIST: 10 * 60 * 1000,      // 10 minutes
  SEARCH_INDEX: 15 * 60 * 1000,   // 15 minutes
} as const;
