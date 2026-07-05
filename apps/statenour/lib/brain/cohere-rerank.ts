/**
 * Cohere cross-encoder reranker · v10.0.363
 *
 * Per /rag-implementation skill · the production-grade RAG pattern is:
 *   1. RRF or hybrid candidate generation (we have this · v10.0.361)
 *   2. Cross-encoder rerank on top-K candidates (this file)
 *   3. Format winners into the system prompt
 *
 * Why cross-encoder beats bi-encoder reranking:
 *   · Bi-encoder embeds query + doc independently · cosine similarity
 *     misses fine-grained relevance signals
 *   · Cross-encoder runs (query, doc) as a pair through a transformer ·
 *     captures explicit relevance reasoning
 *   · On benchmark RAG tasks, cross-encoder rerank lifts top-3 precision
 *     by 15-30%
 *
 * This is GATED on COHERE_API_KEY · without it, the function returns
 * the input unchanged (graceful degradation). Cohere offers a generous
 * free trial tier (1000 reranks/month) · once exhausted upgrade or
 * disable. Wrap the API call in the v10.0.357 guardian for retry safety.
 */

import { withGuardian, GuardianError } from "@/lib/tools/guardian";

interface CohereRerankResult {
  index: number;
  relevance_score: number;
  document?: { text: string };
}

interface CohereRerankResponse {
  results: CohereRerankResult[];
  meta?: { billed_units?: { search_units?: number } };
}

export interface RerankCandidate<T> {
  /** The item being reranked · returned untouched in the result. */
  item: T;
  /** The text representation that the cross-encoder sees. Should be
   *  ≤512 tokens for best results · longer is truncated by Cohere. */
  text: string;
}

export interface RerankResult<T> {
  item: T;
  /** Cohere's relevance score · 0-1, higher = more relevant. */
  score: number;
  /** Original index in the input array · useful for debugging. */
  originalIndex: number;
}

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";
const DEFAULT_MODEL = "rerank-english-v3.0";

async function _cohereRerank<T>(args: {
  query: string;
  candidates: RerankCandidate<T>[];
  topN?: number;
  model?: string;
}): Promise<RerankResult<T>[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) return null;
  if (args.candidates.length === 0) return [];

  const documents = args.candidates.map((c) => c.text);
  const topN = Math.min(args.topN ?? args.candidates.length, args.candidates.length);

  const res = await fetch(COHERE_RERANK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model ?? DEFAULT_MODEL,
      query: args.query,
      documents,
      top_n: topN,
    }),
    // Bound the fetch itself · withGuardian's timeoutMs races the
    // promise but does not abort the socket, so a hung Cohere brownout
    // would pin the connection past the guardian deadline. 7.5s sits
    // just under guardian's 8s so the abort fires first.
    signal: AbortSignal.timeout(7_500),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: Error & { status?: number } = new Error(
      `Cohere rerank ${res.status}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as CohereRerankResponse;

  // Success telemetry · the failure path already warns; this makes a
  // healthy rerank observable too — candidate counts plus Cohere's
  // billed search_units, so per-call rerank cost stops being invisible.
  console.log("[cohere-rerank]", {
    candidatesIn: args.candidates.length,
    topN,
    resultsOut: data.results.length,
    searchUnits: data.meta?.billed_units?.search_units ?? null,
  });

  return data.results.map((r) => ({
    item: args.candidates[r.index].item,
    score: r.relevance_score,
    originalIndex: r.index,
  }));
}

const guardedCohereRerank = withGuardian("cohere-rerank", _cohereRerank, {
  timeoutMs: 8_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal Stage-4 recall rerank sub-op
});

/**
 * Rerank candidates using Cohere · returns null if COHERE_API_KEY unset.
 *
 * Caller should fall back to original ordering on null return.
 */
export async function cohereRerank<T>(args: {
  query: string;
  candidates: RerankCandidate<T>[];
  topN?: number;
  model?: string;
}): Promise<RerankResult<T>[] | null> {
  if (!process.env.COHERE_API_KEY) return null;
  try {
    return await guardedCohereRerank(args);
  } catch (err) {
    // Guardian gives up · the brain still works without rerank ·
    // log and fall through to the caller's fallback path.
    if (err instanceof GuardianError) {
      // Auth / rate-limit are particularly informative
      console.warn(
        `[cohere-rerank] guardian gave up · ${err.category} · ${err.message.slice(0, 120)}`,
      );
    }
    return null;
  }
}

/**
 * Convenience · is the reranker available right now?
 */
export function isCohereRerankAvailable(): boolean {
  return Boolean(process.env.COHERE_API_KEY);
}
