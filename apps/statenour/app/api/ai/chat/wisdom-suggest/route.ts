/**
 * POST /api/ai/chat/wisdom-suggest · v10.0.526 · Arc B Feature 2
 *
 * At-write-time wisdom suggestion endpoint. Takes the operator's
 * current draft text and returns 1-2 wisdoms most semantically
 * relevant. Owner-gated, 800ms target wire time (the frontend
 * debounces 600ms so the perceived feel is ~1.4s).
 *
 * Input:  { draft: string, dismissedIds?: string[] }
 * Output: { suggestions: [{ id, text, source, similarity }] }
 *
 * Short-circuits:
 *   · draft < 25 chars   → []
 *   · draft starts "/"   → [] (slash command, not natural language)
 *   · cache hit          → cached payload (60s · keyed by trim+slice100)
 *
 * Caching is in-memory · we accept the small re-fire cost on the
 * cold-start path. Per-keystroke debouncing already cuts the wire
 * load · the cache just kills the dupe-fire that happens when the
 * operator pastes the same paragraph twice or scrubs back to an
 * earlier state.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { readRequestJson } from "@/lib/utils/http";
import { findRelatedWisdom, markWisdomShown, type WisdomSuggestion } from "@/lib/brain/wisdom-suggest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SuggestBody {
  draft?: string;
  dismissedIds?: string[];
}

// ── tiny in-memory cache ────────────────────────────────────────────
//
// One process-local Map · LRU-ish via TTL only · bounded at 200 keys.
// Cache key = trim(draft).slice(0,100). Dismissed-id list is NOT part
// of the key · dismissals are filtered AT READ time so cache stays
// dense across operators-with-dismissals.

interface CacheEntry {
  at: number;
  payload: WisdomSuggestion[];
}

const TTL_MS = 60_000;
const MAX_KEYS = 200;
const cache = new Map<string, CacheEntry>();

function cacheKey(draft: string): string {
  return draft.trim().slice(0, 100).toLowerCase();
}

function cacheGet(key: string): WisdomSuggestion[] | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.payload;
}

function cacheSet(key: string, payload: WisdomSuggestion[]): void {
  if (cache.size >= MAX_KEYS) {
    // Drop the oldest insertion · Map iterates in insertion order.
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { at: Date.now(), payload });
}

// ── handler ─────────────────────────────────────────────────────────

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<SuggestBody>(req);
    const draft = typeof body.draft === "string" ? body.draft : "";
    const dismissed = Array.isArray(body.dismissedIds)
      ? body.dismissedIds.filter((s): s is string => typeof s === "string")
      : [];

    const trimmed = draft.trim();
    if (trimmed.length < 25) {
      return { suggestions: [] };
    }
    if (trimmed.startsWith("/")) {
      return { suggestions: [] };
    }
    if (trimmed.length > 5000) {
      // Pathological paste · clamp to keep embedding cost bounded.
      // findRelatedWisdom already slices to 1500 chars internally · we
      // hard-reject anything 10x past that so the body never blocks
      // the route.
      throw new ServiceError("draft too large", 413);
    }

    const key = cacheKey(trimmed);
    let pool = cacheGet(key);
    if (!pool) {
      pool = await findRelatedWisdom(trimmed, 5);
      cacheSet(key, pool);
    }

    const dismissedSet = new Set(dismissed);
    const filtered = pool.filter((s) => !dismissedSet.has(s.id));
    const top = filtered.slice(0, 2);

    // Fire-and-forget · mark each returned wisdom as shown so it gets
    // a 24h cooldown on the pill. We do NOT await · the read path
    // must stay under target latency. Errors are swallowed inside
    // markWisdomShown via the logger.
    for (const s of top) {
      void markWisdomShown(s.id);
    }

    return { suggestions: top };
  },
  { auth: "owner" },
);
