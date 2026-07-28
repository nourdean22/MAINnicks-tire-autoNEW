/**
 * lib/services/chat-prefetch.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * The speculative chat warm-up · extracted verbatim from the POST
 * /api/ai/chat/prefetch route handler so the legacy REST endpoint AND
 * the new `chat.prefetch` tRPC procedure both call this one function ·
 * drift between the two consumers is structurally impossible.
 *
 * The warm-up:
 *   1. warms the system-prompt cache if cold,
 *   2. runs predictive prefetch (populates downstream DB query caches),
 *   3. detects the likely chat mode,
 *   4. kicks off tool-embedding warm-up in the background.
 * It NEVER calls Venice — pure warmup. The per-client rate-limit +
 * draft-dedupe maps move in here (one set shared across both
 * transports). The return is the explicit flat `ChatPrefetchResult`.
 */

import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { getCachedPrompt, setCachedPrompt } from "@/lib/ai/system-prompt-cache";
import { getActiveProviderInfo } from "@/lib/ai/provider";
import { detectChatMode } from "@/lib/ai/chat-mode";
import { prefetchIntents } from "@/lib/ai/predictive-prefetch";
import {
  warmToolEmbeddings,
  isToolEmbeddingCacheWarm,
} from "@/lib/ai/tool-embeddings";
import { logError } from "@/lib/utils/error-log";

export interface ChatPrefetchResult {
  ok: boolean;
  warmed: boolean;
  /** Present when the warmup actually ran (draft long enough, not deduped). */
  mode?: string;
  prefetchHits?: number;
  toolEmbeddings?: "warm" | "warming";
  durationMs?: number;
  /** Set when the warmup short-circuited. */
  reason?: "too_short" | "rate_limited" | "duplicate_draft";
}

// Server-side rate limit — the client hook already rate-limits to 2s
// but that's client-trust. This guards the lambda from a stuck or
// malicious tab hammering the endpoint.
const RATE_LIMIT_WINDOW_MS = 1_500;
const DUPE_WINDOW_MS = 2_500;
const recentFires = new Map<string, number>();
const recentDrafts = new Map<string, number>();

function shouldRateLimit(key: string): boolean {
  const now = Date.now();
  const last = recentFires.get(key) || 0;
  if (now - last < RATE_LIMIT_WINDOW_MS) return true;
  recentFires.set(key, now);
  if (recentFires.size > 200) {
    for (const [k, t] of recentFires.entries()) {
      if (now - t > 10 * RATE_LIMIT_WINDOW_MS) recentFires.delete(k);
    }
  }
  return false;
}

function isDuplicateDraft(draftHash: string): boolean {
  const now = Date.now();
  const last = recentDrafts.get(draftHash) || 0;
  if (now - last < DUPE_WINDOW_MS) return true;
  recentDrafts.set(draftHash, now);
  if (recentDrafts.size > 500) {
    for (const [k, t] of recentDrafts.entries()) {
      if (now - t > 10 * DUPE_WINDOW_MS) recentDrafts.delete(k);
    }
  }
  return false;
}

function hashDraft(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Run the chat warm-up for a draft. `clientId` (one per tab from
 * sessionStorage) keys the rate-limit + dedupe so two devices typing
 * the same draft each get their own warmup. Returns a short-circuit
 * `reason` when the draft is too short / rate-limited / a duplicate.
 */
export async function runChatPrefetch(args: {
  draft: string;
  clientId?: string | null;
}): Promise<ChatPrefetchResult> {
  const draft = (args.draft || "").trim();

  if (draft.length < 3) {
    return { ok: true, warmed: false, reason: "too_short" };
  }

  const rateKey = args.clientId ? `cid::${args.clientId}` : "cid::anon";
  if (shouldRateLimit(rateKey)) {
    return { ok: true, warmed: false, reason: "rate_limited" };
  }

  const draftHash = hashDraft(draft);
  const dupeKey = `${rateKey}::${draftHash}`;
  if (isDuplicateDraft(dupeKey)) {
    return { ok: true, warmed: false, reason: "duplicate_draft" };
  }

  const { provider } = getActiveProviderInfo();
  const t0 = Date.now();

  // Warm the system prompt cache if cold. Prefetch always builds the
  // full-tier prompt so the user's first real message — whatever tier
  // it ends up being — at worst pays for the lighter tier-specific
  // build, never the full one.
  const cached = getCachedPrompt(provider, "full");
  let promptWarmed = !!cached;
  if (!cached) {
    try {
      const prompt = await buildSystemPrompt();
      setCachedPrompt(provider, "full", prompt);
      promptWarmed = true;
    } catch {
      promptWarmed = false;
    }
  }

  const mode = detectChatMode(draft, 0);

  // Run predictive prefetch — results thrown away, we're just warming
  // Prisma's query plan cache + lambda imports.
  let prefetchHits = 0;
  if (draft.length >= 8) {
    try {
      const results = await prefetchIntents(draft);
      prefetchHits = results.length;
    } catch (e) {
      logError("services.chat-prefetch", e, { stage: "prefetch-intents" }, "warn");
    }
  }

  // Kick off tool embedding warm-up in the background (no await).
  if (!isToolEmbeddingCacheWarm()) {
    warmToolEmbeddings().catch(() => {});
  }

  return {
    ok: true,
    warmed: promptWarmed,
    mode,
    prefetchHits,
    toolEmbeddings: isToolEmbeddingCacheWarm() ? "warm" : "warming",
    durationMs: Date.now() - t0,
  };
}
