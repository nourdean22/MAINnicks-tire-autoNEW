/**
 * System Prompt Cache — in-memory TTL cache for the heavy
 * buildSystemPrompt() output.
 *
 * The full builder runs 35+ brain engines in parallel on every
 * invocation and takes ~1-3s + 2000ms-ish of latency. For rapid
 * back-and-forth chats that's 35+ engines × 2s = 70s of redundant
 * work across a short session.
 *
 * This cache serves a 45-second window so cold sessions still see
 * fresh data but warm lambdas reuse the prompt across consecutive
 * messages. Vercel serverless instances stay warm for ~15 min so
 * cache hit rates are real when Nour is actively chatting.
 *
 * Returns null for cache misses — caller should call buildSystemPrompt()
 * and then cache the result via setCachedPrompt().
 *
 * ── Apr 26 · key broadened ──
 * Original key was `provider|15min-bucket`. The chat route now passes
 * a `tier` (core/personal/strategy/full) into buildSystemPrompt(), so
 * two consecutive turns with different tiers were silently sharing the
 * same cached prompt — meaning a "core" tier turn could pull a "full"
 * tier prompt or vice versa, defeating the per-tier engine pruning
 * that saves 60% of context on casual messages.
 *
 * The new key includes tier; callers must pass the tier they're about
 * to build/want. The 15-minute time bucket still flushes morning →
 * afternoon shifts automatically.
 *
 * Cache stats are exposed via getCacheStats() so /system/chat-health
 * can show hit rate without us having to grep server logs.
 */

interface CacheEntry {
  prompt: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 45_000;

// ── Stats — tracked across the lambda's lifetime ──
// Exported via getCacheStats() so the chat-health dashboard can show
// the hit rate. Stats reset on lambda cold start (which is fine — that's
// the same scope as the cache itself).
let hits = 0;
let misses = 0;
let sets = 0;
let lastResetAt = Date.now();

function cacheKey(provider: string, tier: string, variant = "default"): string {
  const now = new Date();
  // Key includes the 15-minute time bucket so that MIT/daily shifts
  // are picked up even within a warm lambda. Tier matters because
  // buildSystemPrompt(tier) returns wildly different content per tier.
  // 2026-07-12 review · `variant` (slot + content format, from
  // computePromptVariant) replaces the old content-mode BOOLEAN. The
  // boolean collapsed deep-vs-content, sms, stitch, and every content
  // FORMAT (reel/carousel/story) into two buckets, so this fast-path cache
  // could serve the wrong-variant prompt for up to 45s. The variant matches
  // the inner (300s) key exactly so both layers partition identically.
  const bucket = `${now.getUTCHours()}-${Math.floor(now.getUTCMinutes() / 15)}`;
  return `${provider}|${tier}|${variant}|${bucket}`;
}

/**
 * Read the cached system prompt for this provider + tier + time bucket.
 * Returns null if missing or expired. Tier defaults to "full" for
 * legacy call sites that don't tier their requests.
 */
export function getCachedPrompt(
  provider: string,
  tier: string = "full",
  variant = "default",
): string | null {
  const key = cacheKey(provider, tier, variant);
  const entry = cache.get(key);
  if (!entry) {
    misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    misses++;
    return null;
  }
  hits++;
  return entry.prompt;
}

/**
 * Store a freshly-built prompt in the cache with the standard TTL.
 * Also prunes any stale entries from other time buckets so the Map
 * doesn't grow unbounded. Tier defaults to "full".
 */
export function setCachedPrompt(
  provider: string,
  tier: string,
  prompt: string,
  variant = "default",
): void {
  const key = cacheKey(provider, tier, variant);
  cache.set(key, { prompt, expiresAt: Date.now() + TTL_MS });
  sets++;

  // Opportunistic cleanup — drop anything expired
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (v.expiresAt < now) cache.delete(k);
  }
}

/**
 * Invalidate the cache — for use by triggers that know the prompt
 * would materially change (e.g. user logged a score, MIT was set,
 * a new commitment was made).
 */
export function invalidatePromptCache(): void {
  cache.clear();
  // Stats survive — they're per-lambda. A flushed cache after lots of
  // hits should still surface as "had a high hit rate, then someone
  // mutated a fact and we flushed."
}

/**
 * v6 · Hot-flush — selective invalidation for specific knowledge changes.
 *
 * The system prompt embeds business-knowledge.ts content. When that file
 * changes (Master Content Engine version bump, new pillar, new banned
 * phrase, etc.), the next chat turn should rebuild from scratch — but
 * the 45s TTL would otherwise keep serving stale prompt content.
 *
 * Call sites:
 *   · After admin-side memory writes (pin/unpin, brand_rule edit)
 *   · On `/api/admin/knowledge-refresh` POST
 *   · On Drive sync completion
 *   · On any business_knowledge.ts hot-reload event (dev mode HMR
 *     can fire this from a dev hook)
 *
 * `reason` is logged so we can debug "why did Nick rebuild the prompt
 * mid-session?" without grepping logs.
 */
export function hotFlushPromptCache(reason: string): void {
  const before = cache.size;
  cache.clear();
  console.log(
    `[system-prompt-cache] HOT-FLUSH (${before} entries dropped) — reason: ${reason}`,
  );
}

/**
 * Cache hit-rate + size stats for /system/chat-health visibility.
 * Counts are lifetime-of-lambda; resetCacheStats() zeroes them.
 */
export function getCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  sets: number;
  hitRate: number;
  lastResetAt: number;
  ttlMs: number;
} {
  const total = hits + misses;
  return {
    size: cache.size,
    hits,
    misses,
    sets,
    hitRate: total > 0 ? hits / total : 0,
    lastResetAt,
    ttlMs: TTL_MS,
  };
}

export function resetCacheStats(): void {
  hits = 0;
  misses = 0;
  sets = 0;
  lastResetAt = Date.now();
}
