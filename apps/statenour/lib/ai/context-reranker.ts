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
 *   4. Reorders blocks so the most relevant sit CLOSEST to the
 *      conversation (models weight late-prompt instructions more)
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

export interface RerankedBlock {
  name: string;           // "recall" | "skills" | "identity" | etc
  content: string;
  similarity: number;     // 0-1
  kept: boolean;          // false if dropped by threshold
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
  blocks: Array<{ name: string; content: string }>,
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
    }));
  }

  // Embed each block's leading window in parallel.
  const embeddings = await Promise.all(
    blocks.map((b) =>
      b.content.trim().length === 0
        ? Promise.resolve<number[]>([])
        : getEmbedding(b.content.slice(0, embedWindow)).catch((): number[] => []),
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
      scored[i].kept = scored[i].similarity >= dropThreshold;
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored;
}

/**
 * Helper — format a rerank result for console logging so the chat
 * route can emit a one-line summary of what ordering won.
 */
export function formatRerankSummary(ranked: RerankedBlock[]): string {
  return ranked
    .map((r) => `${r.name}=${r.similarity.toFixed(2)}${r.kept ? "" : "*DROP"}`)
    .join(" · ");
}
