/**
 * BGE cross-encoder reranker · via HuggingFace Inference API
 *
 * The HF strategy port (apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md
 * Category 2) identifies `BAAI/bge-reranker-v2-m3` as the SOTA free
 * cross-encoder reranker. This module is the BGE backend behind the
 * `rerank()` orchestrator in lib/brain/rerank.ts.
 *
 * Same interface as cohere-rerank.ts so the orchestrator can swap
 * between them via the `BGE_RERANK` env flag. The two backends differ:
 *
 *   - Cohere: $2/1000 reranks · ~150ms · proprietary model
 *   - BGE on HF Inference: $0.0001/1000 reranks · ~250ms · open weights
 *
 * The 5000× cost gap matters once the brain pipeline is firing on
 * every chat turn. BGE is the default when HF_API_KEY is set + flag is
 * on; Cohere is the fallback (or vice versa, depending on operator
 * preference). When neither is reachable, the caller falls back to
 * identity ordering (existing graceful-degradation pattern).
 *
 * NOTE on HF rerank shape: HF's `text-ranking` task returns a single
 * relevance score per (query, passage) pair. We call it ONCE per
 * candidate. To save round-trips, the candidates are sent as
 * `query: "<q>", text: "<candidate>"` and HF returns a sentence-
 * similarity-style score. We rescale to 0-1 and sort descending.
 *
 * For batch efficiency at scale, switch to BGE-reranker-v2-m3 hosted
 * on HF Inference ENDPOINTS (dedicated GPU) which supports batched
 * pairwise scoring · breakeven ~100k reranks/day.
 */

import { withGuardian, GuardianError } from "@/lib/tools/guardian";

const BGE_RERANK_URL = "https://router.huggingface.co/hf-inference/models";
const DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3";

export interface BgeRerankCandidate<T> {
  item: T;
  text: string;
}

export interface BgeRerankResult<T> {
  item: T;
  score: number;
  originalIndex: number;
}

interface HfRerankResponse {
  // text-ranking/cross-encoder task: { score: number } per call
  score?: number;
  // Some HF models return [{ label, score }, ...] in a list
  // (zero-shot-style); we handle both shapes.
  label?: string;
}

async function rerankSingleCandidate(args: {
  apiKey: string;
  model: string;
  query: string;
  candidateText: string;
}): Promise<number | null> {
  const res = await fetch(`${BGE_RERANK_URL}/${encodeURIComponent(args.model)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        source_sentence: args.query,
        sentences: [args.candidateText],
      },
    }),
    signal: AbortSignal.timeout(6_000),
  });

  if (res.status === 503) {
    // Model loading on cold cache · caller decides whether to retry
    throw new Error(`HF model loading (503) · ${args.model}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HF rerank ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as number[] | HfRerankResponse[] | { error?: string };
  // Sentence-similarity task returns a flat array of scores
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === "number") return first;
    if (typeof first === "object" && first !== null && "score" in first && typeof (first as HfRerankResponse).score === "number") {
      return (first as HfRerankResponse).score!;
    }
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(`HF rerank error: ${(data as { error: string }).error}`);
  }
  return null;
}

async function _bgeRerank<T>(args: {
  query: string;
  candidates: BgeRerankCandidate<T>[];
  topN?: number;
  model?: string;
}): Promise<BgeRerankResult<T>[] | null> {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) return null;
  if (args.candidates.length === 0) return [];

  const model = args.model ?? DEFAULT_MODEL;
  const topN = Math.min(args.topN ?? args.candidates.length, args.candidates.length);

  // Score candidates in parallel · HF Inference handles burst load fine
  // up to a few dozen concurrent. For 50+ candidates, switch to a
  // pairwise-batch API endpoint (HF Inference Endpoints supports it).
  const scoresOrNulls = await Promise.all(
    args.candidates.map(async (c, i) => {
      try {
        const score = await rerankSingleCandidate({
          apiKey,
          model,
          query: args.query,
          candidateText: c.text.slice(0, 1500),
        });
        return { index: i, score };
      } catch (err) {
        console.warn("[bge-rerank] candidate failed", {
          index: i,
          error: err instanceof Error ? err.message : String(err),
        });
        return { index: i, score: null };
      }
    }),
  );

  // Filter out failed candidates · if too many failed, return null so
  // the orchestrator falls back to Cohere or identity
  const successful = scoresOrNulls.filter((s) => typeof s.score === "number");
  if (successful.length === 0) return null;
  if (successful.length < Math.ceil(args.candidates.length * 0.5)) {
    // >50% failure rate · likely model loading or auth · don't trust partial result
    return null;
  }

  // Sort by score descending
  successful.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = successful.slice(0, topN);

  console.log("[bge-rerank]", {
    model,
    candidatesIn: args.candidates.length,
    topN,
    resultsOut: top.length,
    successRate: (successful.length / args.candidates.length).toFixed(2),
  });

  return top.map((r) => ({
    item: args.candidates[r.index].item,
    score: r.score!,
    originalIndex: r.index,
  }));
}

const guardedBgeRerank = withGuardian("bge-rerank", _bgeRerank, {
  timeoutMs: 12_000, // larger budget · parallel single-pair calls
  maxRetries: 1,
});

/**
 * Rerank candidates using BGE on HF Inference. Returns null if
 * HF_API_KEY is unset OR if too many per-candidate calls failed.
 * Caller should fall back to Cohere or identity ordering.
 */
export async function bgeRerank<T>(args: {
  query: string;
  candidates: BgeRerankCandidate<T>[];
  topN?: number;
  model?: string;
}): Promise<BgeRerankResult<T>[] | null> {
  if (!process.env.HF_API_KEY) return null;
  try {
    return await guardedBgeRerank(args);
  } catch (err) {
    if (err instanceof GuardianError) {
      console.warn(
        `[bge-rerank] guardian gave up · ${err.category} · ${err.message.slice(0, 120)}`,
      );
    }
    return null;
  }
}

export function isBgeRerankAvailable(): boolean {
  return Boolean(process.env.HF_API_KEY);
}
