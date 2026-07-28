/**
 * Retrieval evaluation harness (spine-8, 2026-07-28).
 *
 * The recall stack (RRF + category/source/recency weights + reranker)
 * is hand-tuned with NO ground truth — every multiplier is a stated
 * prior. This harness is the measurement side: a versioned case corpus
 * with expected-relevant and forbidden (contradiction/stale) memory
 * keys, run against ANY retriever via an injectable function, scoring
 * the metrics the audit named. Tuning changes are promotable only when
 * they improve REAL cases — the corpus grows from real corrections and
 * misses (the outcome ledger's future job), not from invented fixtures.
 *
 * Pure math — no DB, no LLM. scripts/recall-eval.ts wires the live
 * contextual-recall pipeline in as the retriever for operator-run
 * evaluations.
 */

export const RECALL_EVAL_CORPUS_VERSION = "v1";

export interface RecallEvalCase {
  id: string;
  /** The user-shaped query the retriever will be asked. */
  query: string;
  /** Memory keys that SHOULD appear in the top-k. */
  relevantKeys: string[];
  /** Keys that must NOT appear (known-stale / contradicted / wrong-person). */
  forbiddenKeys: string[];
  /** exact_fact | temporal | preference | contradiction | name_number */
  kind: string;
  /** Where this case came from — 'synthetic-seed' until real corrections land. */
  provenance: string;
}

export interface RetrievedMemory {
  key: string;
  score?: number;
}

export type Retriever = (query: string, k: number) => Promise<RetrievedMemory[]>;

export interface RecallCaseResult {
  caseId: string;
  kind: string;
  precisionAtK: number;
  relevantFound: number;
  relevantExpected: number;
  forbiddenInjected: number;
  retrievedKeys: string[];
}

export interface RecallEvalReport {
  corpusVersion: string;
  k: number;
  cases: RecallCaseResult[];
  /** Mean precision@k across cases with at least one relevant key. */
  meanPrecisionAtK: number;
  /** Fraction of cases where ALL expected relevant keys were found. */
  fullRecallRate: number;
  /** Fraction of cases where ANY forbidden key surfaced. */
  contradictionInjectionRate: number;
  casesRun: number;
}

/** precision@k over one case: relevant retrieved ÷ min(k, expected). */
export function precisionAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (relevant.length === 0) return 1;
  const top = retrieved.slice(0, k);
  const hit = relevant.filter((r) => top.includes(r)).length;
  return hit / Math.min(k, relevant.length);
}

export async function runRecallEval(
  cases: readonly RecallEvalCase[],
  retrieve: Retriever,
  k = 5,
): Promise<RecallEvalReport> {
  const results: RecallCaseResult[] = [];
  for (const c of cases) {
    const rows = await retrieve(c.query, k);
    const keys = rows.map((r) => r.key);
    const relevantFound = c.relevantKeys.filter((r) => keys.slice(0, k).includes(r)).length;
    const forbiddenInjected = c.forbiddenKeys.filter((f) => keys.slice(0, k).includes(f)).length;
    results.push({
      caseId: c.id,
      kind: c.kind,
      precisionAtK: precisionAtK(keys, c.relevantKeys, k),
      relevantFound,
      relevantExpected: c.relevantKeys.length,
      forbiddenInjected,
      retrievedKeys: keys.slice(0, k),
    });
  }
  const scored = results.filter((r) => r.relevantExpected > 0);
  const meanPrecisionAtK =
    scored.length > 0 ? scored.reduce((s, r) => s + r.precisionAtK, 0) / scored.length : 0;
  const fullRecallRate =
    scored.length > 0
      ? scored.filter((r) => r.relevantFound === r.relevantExpected).length / scored.length
      : 0;
  const contradictionInjectionRate =
    results.length > 0 ? results.filter((r) => r.forbiddenInjected > 0).length / results.length : 0;
  return {
    corpusVersion: RECALL_EVAL_CORPUS_VERSION,
    k,
    cases: results,
    meanPrecisionAtK: Math.round(meanPrecisionAtK * 1000) / 1000,
    fullRecallRate: Math.round(fullRecallRate * 1000) / 1000,
    contradictionInjectionRate: Math.round(contradictionInjectionRate * 1000) / 1000,
    casesRun: results.length,
  };
}

/**
 * Seed corpus — SYNTHETIC. These exist so the harness runs end-to-end
 * from day one; they are NOT a quality benchmark. Every real recall
 * correction (wrong fact recalled, relevant memory missed, stale fact
 * injected) should be added here with provenance describing the actual
 * conversation, and only then do the numbers mean anything.
 */
export const SEED_CASES: readonly RecallEvalCase[] = [
  {
    id: "seed-exact-fact-1",
    query: "what shop does Nour own",
    relevantKeys: ["business_identity"],
    forbiddenKeys: [],
    kind: "exact_fact",
    provenance: "synthetic-seed",
  },
  {
    id: "seed-preference-1",
    query: "how does Nour like updates delivered",
    relevantKeys: ["communication_preference"],
    forbiddenKeys: [],
    kind: "preference",
    provenance: "synthetic-seed",
  },
  {
    id: "seed-contradiction-guard-1",
    query: "current review count",
    relevantKeys: [],
    forbiddenKeys: ["stale_review_count"],
    kind: "contradiction",
    provenance: "synthetic-seed",
  },
];
