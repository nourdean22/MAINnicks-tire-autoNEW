/**
 * lib/services/wisdom-suggest-feed.ts · hooks-lib REST→tRPC slice
 * (2026-05-22)
 *
 * The at-write-time wisdom-suggestion feed · extracted verbatim from
 * the POST /api/ai/chat/wisdom-suggest route handler (the in-memory
 * cache + the short-circuits + the dismissed-id read-time filter) so
 * the legacy REST endpoint AND the new `chat.wisdomSuggest` tRPC
 * procedure both call this one function · drift between the two
 * consumers is structurally impossible.
 *
 * The cache key = trim(draft).slice(0,100) · the dismissed-id list is
 * NOT part of the key (dismissals are filtered AT READ time so the
 * cache stays dense). Bounded at 200 keys, 60s TTL — one cache shared
 * across both transports.
 *
 * `WisdomSuggestion` is a flat object (id · text · source · similarity)
 * — no Prisma row reaches the AppRouter (TS2589 firewall).
 */

import { ServiceError } from "@/lib/utils/service-error";
import {
  findRelatedWisdom,
  markWisdomShown,
  type WisdomSuggestion,
} from "@/lib/brain/wisdom-suggest";

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
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { at: Date.now(), payload });
}

/**
 * Build the at-write-time wisdom suggestions for a draft. Returns at
 * most 2 (the top after dismissed-id filtering). Short-circuits to an
 * empty list for drafts < 25 chars / slash-commands. Throws
 * ServiceError(413) for a pathological 5000+ char paste — the same
 * status the REST route returned.
 */
export async function buildWisdomSuggestFeed(args: {
  draft: string;
  dismissedIds?: string[];
}): Promise<{ suggestions: WisdomSuggestion[] }> {
  const draft = typeof args.draft === "string" ? args.draft : "";
  const dismissed = Array.isArray(args.dismissedIds)
    ? args.dismissedIds.filter((s): s is string => typeof s === "string")
    : [];

  const trimmed = draft.trim();
  if (trimmed.length < 25) {
    return { suggestions: [] };
  }
  if (trimmed.startsWith("/")) {
    return { suggestions: [] };
  }
  if (trimmed.length > 5000) {
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

  // Fire-and-forget · mark each returned wisdom as shown (24h cooldown).
  for (const s of top) {
    void markWisdomShown(s.id);
  }

  return { suggestions: top };
}
