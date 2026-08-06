/**
 * CONTEXT RERANKER — Apr 19.
 *
 * The chat route fires 7 brain-learning blocks per turn (recall, skills,
 * identity, ghost, qualitative, beliefs, nudges) in parallel with a 3s
 * timeout each, then concatenates ALL of them into the system prompt.
 * That's generous but unfocused: some blocks are gold for THIS turn,
 * others are background noise wasting 2-5K tokens of context window.
 *
 * This reranker:
 *   1. Takes the user embedding (already computed in route.ts for
 *      tool pruning)
 *   2. Embeds the first ~300 chars of each block (cheap — cached by
 *      Venice's prompt-cache if same block fires repeatedly)
 *   3. Computes cosine similarity per block against the user turn
 *   4. Sorts blocks by similarity DESCENDING — the sharpest block
 *      lands FIRST in the addendum, at the HEAD of the effective
 *      attention window (2026-08-06 · this bullet used to claim the
 *      opposite, "closest to the conversation". The sort has always
 *      been descending; the sentence was simply wrong)
 *   5. Optionally drops blocks below a cutoff threshold
 *
 * Net: same 7 blocks available, but the model sees the sharpest 3-4
 * FIRST in the effective attention window. Bonus: when we drop, we
 * save 500-2000 prompt tokens per turn on dozens of turns/day.
 *
 * Zero added latency: all embeddings are parallel with the existing
 * embedUserMessage call.
 */

import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { getEmbedding } from "./provider";

/**
 * Block-embedding cache. The 7 brain blocks (recall, skills, identity,
 * etc.) are largely stable across consecutive turns, yet rerankContextBlocks
 * re-embedded every block on every turn (~7 live embedding calls/turn).
 * Cache the per-block embedding keyed by a hash of the embedded window so
 * the same content hits cache instead of re-calling the embedder. Short
 * TTL keeps it fresh as blocks evolve; module-level so it survives within
 * a warm lambda and resets on cold start (same lifecycle as other in-mem
 * caches here).
 */
const EMBED_CACHE = new Map<string, { vec: number[]; expiresAt: number }>();
const EMBED_CACHE_TTL_MS = 2 * 60_000; // 2 min

// djb2 — tiny, fast, no deps. Only used as a cache key over the embed
// window, so collision risk is negligible and never affects correctness
// (a collision would at worst reuse a stale embedding for ~2 min).
function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/**
 * getEmbedding wrapped with the block cache. Preserves the same
 * fail-soft contract: any embedder error resolves to [] (callers treat
 * an empty vec as "couldn't score"). Failures are NOT cached so a
 * transient hiccup retries next turn.
 */
async function getBlockEmbeddingCached(text: string): Promise<number[]> {
  const now = Date.now();
  const key = hashContent(text);
  const hit = EMBED_CACHE.get(key);
  if (hit && hit.expiresAt > now) return hit.vec;

  const vec = await getEmbedding(text).catch((): number[] => []);
  if (vec.length > 0) {
    EMBED_CACHE.set(key, { vec, expiresAt: now + EMBED_CACHE_TTL_MS });
    // Lazy GC of expired entries when the map grows.
    if (EMBED_CACHE.size > 100) {
      for (const [k, v] of EMBED_CACHE) {
        if (v.expiresAt <= now) EMBED_CACHE.delete(k);
      }
    }
  }
  return vec;
}

export interface RerankedBlock {
  name: string;           // "recall" | "skills" | "identity" | etc
  content: string;
  similarity: number;     // 0-1
  kept: boolean;          // false if dropped by threshold
  critical?: boolean;     // true if block MUST NOT be dropped
}

export interface RerankOptions {
  /** Drop blocks below this similarity. Default 0.12 (low bar —
   *  we don't want to starve the model, just cut obvious noise). */
  dropThreshold?: number;
  /** Max chars to embed per block. Default 400 — longer doesn't
   *  improve relevance and costs more. */
  embedWindow?: number;
}

/**
 * Rerank an array of named blocks against a user turn. Returns them
 * sorted by similarity DESCENDING (most relevant first). Blocks below
 * dropThreshold get `kept: false` so the caller can filter.
 *
 * Pass the already-computed user embedding from the chat route to
 * avoid re-embedding.
 */
export async function rerankContextBlocks(
  userEmbedding: number[],
  blocks: Array<{ name: string; content: string; critical?: boolean }>,
  options: RerankOptions = {},
): Promise<RerankedBlock[]> {
  const { dropThreshold = 0.12, embedWindow = 400 } = options;

  // No user embedding → can't rerank, return as-is (all kept, similarity 0).
  if (userEmbedding.length === 0) {
    return blocks.map((b) => ({
      name: b.name,
      content: b.content,
      similarity: 0,
      kept: true,
      critical: b.critical,
    }));
  }

  // Embed each block's leading window in parallel. Stable blocks across
  // consecutive turns hit the 2-min EMBED_CACHE instead of re-embedding.
  const embeddings = await Promise.all(
    blocks.map((b) =>
      b.content.trim().length === 0
        ? Promise.resolve<number[]>([])
        : getBlockEmbeddingCached(b.content.slice(0, embedWindow)),
    ),
  );

  const scored: RerankedBlock[] = blocks.map((b, i) => {
    const vec = embeddings[i];
    const sim = vec.length > 0 ? cosineSimilarity(userEmbedding, vec) : 0;
    return {
      name: b.name,
      content: b.content,
      similarity: sim,
      kept: sim >= dropThreshold || b.content.trim().length > 0 && sim === 0,
      critical: b.critical,
      // ^ keep blocks even when embedding failed (sim=0, vec=[]) —
      // losing a whole block to a flaky embedder is worse than a bit
      // of noise. Drop only when we HAVE a score and it's below bar.
    };
  });

  // Fix the "kept" logic: when the block has content BUT we got a real
  // similarity score (vec non-empty), the similarity alone decides.
  for (let i = 0; i < scored.length; i++) {
    const vec = embeddings[i];
    if (vec.length > 0) {
      scored[i].kept = scored[i].critical || scored[i].similarity >= dropThreshold;
    }
  }

  // 2026-08-06 · DESCENDING is INTENTIONAL — highest similarity first.
  // brain-context.ts appends in exactly this order, so the sharpest block
  // OPENS the addendum (see the header note). Flipping to `a.similarity -
  // b.similarity` would invert the intended attention placement silently,
  // with every test still green — nothing here asserts the direction.
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored;
}

/**
 * Helper — format a rerank result for console logging so the chat
 * route can emit a one-line summary of what ordering won.
 */
export function formatRerankSummary(ranked: RerankedBlock[]): string {
  return ranked
    .map((r) => `${r.name}${r.critical ? "!" : ""}=${r.similarity.toFixed(2)}${r.kept ? "" : "*DROP"}`)
    .join(" · ");
}
