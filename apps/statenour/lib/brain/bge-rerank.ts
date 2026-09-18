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
 * NOTE on HF rerank shape — CORRECTED 2026-09-18 after measuring the live
 * endpoint. This paragraph previously described sending
 * `query: "<q>", text: "<candidate>"`, which the code NEVER sent; the code sent
 * the sentence-similarity shape `{inputs:{source_sentence,sentences}}` and
 * therefore 400'd on every candidate since the module shipped. Comment and
 * implementation had never agreed, and neither matched the API.
 *
 * The one shape that works, of seven probed:
 *     {inputs:[{text:"<query>", text_pair:"<candidate>"}]}
 * scoring relevant 0.9963 vs irrelevant 0.0000. One request PER CANDIDATE —
 * batching two pairs in a single request is untested (the account hit its
 * credit ceiling mid-probe) and would be the obvious next saving.
 *
 * For batch efficiency at scale, switch to BGE-reranker-v2-m3 hosted
 * on HF Inference ENDPOINTS (dedicated GPU) which supports batched
 * pairwise scoring · breakeven ~100k reranks/day.
 */

import { withGuardian, GuardianError } from "@/lib/tools/guardian";

const BGE_RERANK_URL = "https://router.huggingface.co/hf-inference/models";
const DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3";

/**
 * Pull the relevance score out of whatever HF returned, or null.
 *
 * ⚠ RECURSIVE ON PURPOSE. Text-classification endpoints return the score at
 * varying depths — `0.99`, `[0.99]`, `[{score}]`, and `[[{label,score}]]` are
 * all shapes this family of models emits, and the nesting is not stable across
 * router versions. The previous parser only inspected `data[0]` for a number or
 * an object-with-score, so a NESTED array silently returned null and the caller
 * counted it as a failed candidate — a payload fix alone would have kept
 * failing, just further from the cause.
 *
 * This exact function extracted 0.9963 from the live endpoint during the
 * 2026-09-18 probe, which is the only reason it is trusted. Exported for tests.
 */
export function extractRerankScore(data: unknown): number | null {
  if (typeof data === "number") return Number.isFinite(data) ? data : null;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    return extractRerankScore(data[0]);
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.score === "number" && Number.isFinite(o.score)) return o.score;
    if (typeof o.relevance_score === "number" && Number.isFinite(o.relevance_score)) {
      return o.relevance_score;
    }
  }
  return null;
}

export interface BgeRerankCandidate<T> {
  item: T;
  text: string;
}

export interface BgeRerankResult<T> {
  item: T;
  score: number;
  originalIndex: number;
}

// (The former `HfRerankResponse` interface was removed 2026-09-18. It declared
// the two response shapes this endpoint was BELIEVED to return, and the parser
// keyed off it — which is exactly why a third, NESTED shape read as "no score".
// extractRerankScore() now walks the value structurally instead, so a new
// nesting depth costs nothing rather than silently failing every candidate.)

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
    // ⚠ PAYLOAD SHAPE MEASURED AGAINST THE LIVE API 2026-09-18, NOT ASSUMED.
    //
    // This previously sent `{inputs:{source_sentence,sentences}}` — the
    // SENTENCE-SIMILARITY shape — to a cross-encoder that HF routes through
    // TextClassificationPipeline, so EVERY candidate 400'd with
    //   "TextClassificationPipeline.__call__() missing 1 required positional
    //    argument: 'inputs'"
    // and every rerank silently fell through to Cohere. Per this file's own
    // header that is a 5000x cost difference ($0.0001/1000 vs $2/1000) which
    // the module was built to capture and never did.
    //
    // ⚠ The header ALSO described a `query`/`text` shape the code never sent —
    // comment and implementation had disagreed since the module shipped.
    //
    // Seven shapes were probed against the real endpoint. Exactly one works,
    // and it discriminates properly (a scorer that returns the same number for
    // a relevant and an irrelevant passage is not a reranker):
    //   {inputs:[{text,text_pair}]}  ->  relevant 0.9963 · irrelevant 0.0000
    // All six others returned HTTP 400, including both /pipeline/<task>/ routes
    // ("Model not supported by provider hf-inference").
    body: JSON.stringify({
      inputs: [{ text: args.query, text_pair: args.candidateText }],
    }),
    signal: AbortSignal.timeout(6_000),
  });

  if (res.status === 503) {
    // Model loading on cold cache · caller decides whether to retry
    throw new Error(`HF model loading (503) · ${args.model}`);
  }
  if (res.status === 402) {
    // ⚠ NAME THIS ONE SPECIFICALLY. Observed live 2026-09-18: "You have
    // depleted your monthly included credits." A depleted quota is an OPERATOR
    // spend decision, not a bug, and it is indistinguishable from a code fault
    // inside a generic `HF rerank 402: ...` line — which is how a working
    // module reads as broken (and a broken one reads as merely unfunded).
    throw new Error(
      `HF INFERENCE CREDITS DEPLETED (402) · ${args.model} · bge-rerank cannot run until the HF account is topped up; the orchestrator is falling back to Cohere at ~5000x the per-rerank cost`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HF rerank ${res.status}: ${body.slice(0, 200)}`);
  }

  const data: unknown = await res.json();
  if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) {
    throw new Error(`HF rerank error: ${String((data as { error: unknown }).error)}`);
  }
  return extractRerankScore(data);
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
  if (successful.length === 0) {
    // ⚠ TOTAL failure — every candidate errored. This is the signal the breaker
    // exists for: a key that is present but dead produces exactly this, on every
    // single call, forever.
    noteBgeOutcome("total-failure");
    return null;
  }
  if (successful.length < Math.ceil(args.candidates.length * 0.5)) {
    // >50% failure rate · likely model loading or auth · don't trust partial
    // result. Deliberately NOT a breaker trip: some candidates DID score, so the
    // backend is reachable and the fault is per-request (oversized passage,
    // transient 503). Tripping here would disable a working backend over one
    // awkward batch — the opposite mistake to the one above.
    return null;
  }
  noteBgeOutcome("success");

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
  reliabilityOnly: true, // internal Stage-4 recall rerank sub-op
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

/* ════════════════════════════════════════════════════════════════════════════
 * CIRCUIT BREAKER — because A KEY BEING PRESENT IS NOT THE BACKEND WORKING
 * ════════════════════════════════════════════════════════════════════════════
 * isBgeRerankAvailable() used to be `Boolean(process.env.HF_API_KEY)`. A key
 * that is revoked, invalid, or — as observed live 2026-09-18 — OUT OF CREDITS
 * (HTTP 402) therefore read as AVAILABLE forever.
 *
 * The cost of that is not one failed call. rerank.ts routes to BGE first when
 * the flag is on, _bgeRerank fires ONE REQUEST PER CANDIDATE (25 on the
 * observed recall path), every one fails, and only then does Cohere run. That
 * whole doomed round trip is paid on EVERY rerank, on every chat turn, forever,
 * with a correct-looking fallback hiding it.
 *
 * So: after two consecutive TOTAL failures the backend goes cold for ten
 * minutes. Any success resets it immediately. This is deliberately not a
 * per-error-code policy — a 402 is persistent and a 503 is transient, but both
 * are answered correctly by "stop hammering, retry later", and one rule has no
 * branches to get wrong.
 *
 * ⚠ SCOPE, STATED: this is per-process state. On serverless each instance
 * learns independently, so it bounds waste WITHIN an instance's life rather
 * than globally. That is a real limit, not an oversight — a shared breaker
 * needs a store, and this is worth having before that is worth building.
 * ════════════════════════════════════════════════════════════════════════════ */

const BREAKER_TRIP_AFTER = 2;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

const breaker = { consecutiveTotalFailures: 0, coldUntilMs: 0 };

/** Record the outcome of one _bgeRerank attempt. Exported for tests. */
export function noteBgeOutcome(
  outcome: "success" | "total-failure",
  now: number = Date.now(),
): void {
  if (outcome === "success") {
    breaker.consecutiveTotalFailures = 0;
    breaker.coldUntilMs = 0;
    return;
  }
  breaker.consecutiveTotalFailures += 1;
  if (breaker.consecutiveTotalFailures >= BREAKER_TRIP_AFTER) {
    breaker.coldUntilMs = now + BREAKER_COOLDOWN_MS;
  }
}

/** Test seam only — never called in production paths. */
export function resetBgeBreaker(): void {
  breaker.consecutiveTotalFailures = 0;
  breaker.coldUntilMs = 0;
}

/** Inspect the breaker without mutating it. Exported for tests + diagnostics. */
export function bgeBreakerState(): { consecutiveTotalFailures: number; coldUntilMs: number } {
  return { ...breaker };
}

export function isBgeRerankAvailable(now: number = Date.now()): boolean {
  if (!process.env.HF_API_KEY) return false;
  return now >= breaker.coldUntilMs;
}
