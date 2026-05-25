/**
 * Rerank orchestrator · routes between BGE (HF) and Cohere based on
 * the BGE_RERANK env flag.
 *
 * Why this layer exists:
 *   - Cohere is the legacy reranker (lib/brain/cohere-rerank.ts).
 *   - BGE on HF Inference is 5000× cheaper per call and matches/beats
 *     Cohere quality on benchmark RAG tasks.
 *   - Operator wants a clean A/B switch via env flag · this orchestrator
 *     is the single entry point all retrieval callers use.
 *
 * Routing logic:
 *   - BGE_RERANK=true + HF_API_KEY set → try BGE first, fall back to Cohere
 *   - BGE_RERANK=false (default) → try Cohere first, fall back to BGE (if HF set)
 *   - Neither available → return null · caller uses identity ordering
 *
 * Cross-ref: apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md
 *            apps/nickstire/docs/eval-rubrics/enterprise-search.md (Stage 4)
 *            docs/runbooks/bge-rerank-cutover.md (operator runbook · this PR)
 */

import { cohereRerank, isCohereRerankAvailable } from "./cohere-rerank";
import { bgeRerank, isBgeRerankAvailable } from "./bge-rerank";

export interface RerankCandidate<T> {
  item: T;
  text: string;
}

export interface RerankResult<T> {
  item: T;
  score: number;
  originalIndex: number;
  /** Which backend produced this result · "bge" | "cohere" | "none" */
  source: "bge" | "cohere" | "none";
}

interface BackendResult<T> {
  item: T;
  score: number;
  originalIndex: number;
}

function tagSource<T>(arr: BackendResult<T>[] | null, source: "bge" | "cohere"): RerankResult<T>[] | null {
  if (!arr) return null;
  return arr.map((r) => ({ ...r, source }));
}

/**
 * Read the BGE_RERANK flag. Operator-flippable env var:
 *   BGE_RERANK=true  → prefer BGE
 *   BGE_RERANK=false → prefer Cohere (default)
 *   unset            → prefer Cohere (default)
 */
function preferBge(): boolean {
  const v = process.env.BGE_RERANK;
  return v === "true" || v === "1";
}

/**
 * Rerank candidates · single entry point for the brain pipeline.
 *
 * Returns null when no reranker is available · caller should fall
 * back to identity-ordering on a null result (the existing behavior
 * in lib/brain/contextual-recall.ts is correct).
 */
export async function rerank<T>(args: {
  query: string;
  candidates: RerankCandidate<T>[];
  topN?: number;
}): Promise<RerankResult<T>[] | null> {
  if (args.candidates.length === 0) return [];

  const useBgeFirst = preferBge() && isBgeRerankAvailable();
  const cohereAvail = isCohereRerankAvailable();
  const bgeAvail = isBgeRerankAvailable();

  if (useBgeFirst) {
    const bgeResult = await bgeRerank<T>(args);
    if (bgeResult && bgeResult.length > 0) {
      return tagSource(bgeResult, "bge");
    }
    // BGE failed · try Cohere as fallback
    if (cohereAvail) {
      const cohereResult = await cohereRerank<T>(args);
      if (cohereResult && cohereResult.length > 0) {
        return tagSource(cohereResult, "cohere");
      }
    }
    return null;
  }

  // Default · Cohere first, BGE fallback
  if (cohereAvail) {
    const cohereResult = await cohereRerank<T>(args);
    if (cohereResult && cohereResult.length > 0) {
      return tagSource(cohereResult, "cohere");
    }
  }
  if (bgeAvail) {
    const bgeResult = await bgeRerank<T>(args);
    if (bgeResult && bgeResult.length > 0) {
      return tagSource(bgeResult, "bge");
    }
  }
  return null;
}

/**
 * True if ANY reranker is available · use to gate the rerank stage.
 * Matches the existing isCohereRerankAvailable() contract so the
 * caller can swap to this without behavior change.
 */
export function isRerankAvailable(): boolean {
  return isBgeRerankAvailable() || isCohereRerankAvailable();
}

/**
 * Diagnostic · which reranker WOULD be tried first right now? Used
 * by /system/migrations + the operator dashboard to surface the
 * current routing decision without flipping anything.
 */
export function getActiveRerankBackend(): "bge" | "cohere" | "none" {
  if (preferBge() && isBgeRerankAvailable()) return "bge";
  if (isCohereRerankAvailable()) return "cohere";
  if (isBgeRerankAvailable()) return "bge";
  return "none";
}
