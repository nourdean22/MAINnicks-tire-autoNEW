/**
 * Bounded TTL Map — an in-memory Map with automatic expiry and size cap.
 * Replaces the ad-hoc `Map + cleanup setInterval + MAX_SIZE` pattern that was
 * duplicated across smsBot, messengerBot, rate-limit caches, etc.
 *
 * Semantics:
 *   - Entries older than ttlMs are treated as absent on read (and purged on write).
 *   - When size exceeds maxEntries * 0.5 on write, a sweep runs.
 *   - When size exceeds maxEntries (hard cap), oldest-first eviction.
 *
 * Typical usage:
 *   const convo = new BoundedTtlMap<ConversationState>({
 *     ttlMs: 30 * 60_000,
 *     maxEntries: 500,
 *     touchOnRead: true,  // rolling TTL (good for conversations)
 *   });
 */

export interface BoundedTtlMapOptions {
  ttlMs: number;
  maxEntries: number;
  /** If true, `get()` refreshes the entry's timestamp (rolling TTL). */
  touchOnRead?: boolean;
}

interface Entry<V> {
  value: V;
  timestamp: number;
}

export class BoundedTtlMap<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly touchOnRead: boolean;

  constructor(opts: BoundedTtlMapOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries;
    this.touchOnRead = opts.touchOnRead ?? false;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    if (this.touchOnRead) entry.timestamp = Date.now();
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, timestamp: Date.now() });
    // Soft-sweep when we cross half capacity
    if (this.store.size > this.maxEntries / 2) this.sweep();
    // Hard cap: evict oldest until back under limit
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /** Manually trigger cleanup of expired entries. */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, entry] of this.store) {
      if (now - entry.timestamp > this.ttlMs) {
        this.store.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** Iterate fresh (non-expired) entries. */
  *entries(): IterableIterator<[string, V]> {
    const now = Date.now();
    for (const [k, entry] of this.store) {
      if (now - entry.timestamp <= this.ttlMs) {
        yield [k, entry.value];
      }
    }
  }

  /** Return all fresh values. */
  values(): V[] {
    return Array.from(this.entries()).map(([, v]) => v);
  }
}
