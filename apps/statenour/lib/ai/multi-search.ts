/**
 * Multi-source web-search verification orchestrator · v10.0.524
 *
 * Fan-out web search to Perplexity + Tavily + Exa in parallel,
 * fold results into a consensus + disagreement + confidence
 * signal that downstream chat tooling consumes via the new
 * `searchWebVerified` arsenal tool.
 *
 * LIFTED-FROM-PERPLEXITY-PATTERN NOTE:
 *   The three source adapters (lib/integrations/perplexity|tavily|exa.ts)
 *   were intentionally shaped identical — same options surface,
 *   same { content, citations, model } return — so this orchestrator
 *   stays simple: dispatch, settle, fold. No per-source branching
 *   downstream.
 *
 * WHY: chat surface fabricates ~5% of factual claims when only
 * Perplexity answers (single point of truth → single point of
 * fabrication). Quorum across 3 independent retrieval stacks
 * catches the fabrications that only show up on one source.
 *
 * STANCE (karpathy + kaizen + error-handling-patterns):
 *   - Promise.allSettled · partial failure is the common case, not
 *     the exception. Never let one source's outage poison the others.
 *   - 8s per-source timeout · cap blast radius. Guardian's 25s is
 *     too generous for an interactive chat path.
 *   - Missing API key → skip silently. Not an error, just a smaller
 *     quorum. (Operator may not have provisioned all three keys.)
 *   - Consensus = lexical-overlap heuristic on top-claim sentences.
 *     Cheap, deterministic, no LLM call required. Good enough for
 *     "do 2/3 sources agree on the headline fact?".
 */

import { askPerplexity, type PerplexityResponse } from "@/lib/integrations/perplexity";
import { askTavily, type TavilyResponse } from "@/lib/integrations/tavily";
import { askExa, type ExaResponse } from "@/lib/integrations/exa";
import { askGoogleSearch } from "@/lib/integrations/google-search";
import { askPerplexica, hasPerplexica } from "@/lib/integrations/perplexica";
// v10.0.525 · #12 silent-failure-hunter H1 fix · the all-sources-
// failed path was returning empty without any log surface, which
// risks the very fabrication searchWebVerified exists to prevent.
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/multi-search");

export type SourceName = "perplexity" | "tavily" | "exa" | "google" | "perplexica";

export interface MultiSourceCitation {
  url: string;
  title?: string;
  source: SourceName;
}

export interface MultiSourceSourceResult {
  name: SourceName;
  content: string;
  citations: Array<{ url: string; title?: string }>;
  model: string;
}

export interface MultiSourceResult {
  /** Synthesized consensus answer · null when sources disagree. */
  consensus: string | null;
  /** Each source that returned successfully. */
  sources: MultiSourceSourceResult[];
  /** Human-readable disagreement note · null when consensus exists. */
  disagreement: string | null;
  /** 0..1 · fraction-of-quorum × agreement-strength. */
  confidence: number;
  /** Deduped citation list across all sources, with provenance. */
  citations: MultiSourceCitation[];
}

export interface MultiSourceOptions {
  /** Same domain filter passed through to all sources. */
  domains?: { allow?: string[]; block?: string[] };
  /** Recency filter passed through. */
  recency?: "day" | "week" | "month" | "year";
  /** Restrict to a subset of sources · default = all three. */
  sources?: SourceName[];
  /** Per-source wall-clock budget · default 8000ms (interactive chat). */
  timeoutMs?: number;
}

/* ---------- internals ---------- */

const DEFAULT_TIMEOUT_MS = 8_000;
// 2026-07-05 improvement · Perplexica added LAST so dedupCitations (keep-first)
// preserves the metered sources' authoritative order (perplexity > tavily >
// exa); the free self-hosted source is lowest dedup precedence — no reorder.
const ALL_SOURCES: SourceName[] = ["perplexity", "tavily", "exa", "google", "perplexica"];

/**
 * Race a promise against a timeout. Resolves to the promise's
 * result, or rejects with a timeout error. Independent of guardian's
 * inner timeout (which is per-attempt, not per-source).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function hasApiKey(source: SourceName): boolean {
  if (source === "perplexity") return Boolean(process.env.PERPLEXITY_API_KEY);
  if (source === "tavily") return Boolean(process.env.TAVILY_API_KEY);
  if (source === "exa") return Boolean(process.env.EXA_API_KEY);
  if (source === "google") return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (source === "perplexica") return hasPerplexica();
  return false;
}

/**
 * Tokenize for lexical-overlap scoring. Lowercases, strips
 * punctuation, drops common stop-words and 1-char tokens. Pure.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on",
  "for", "with", "by", "is", "are", "was", "were", "be", "been",
  "as", "at", "it", "its", "that", "this", "these", "those", "from",
  "has", "have", "had", "do", "does", "did", "will", "would", "can",
  "could", "should", "may", "might", "about", "than", "then",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

/**
 * Jaccard similarity over content-token sets. 0..1 · symmetric.
 * Cheap proxy for "do these answers cover the same facts?".
 */
function jaccardSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection += 1;
  }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Pick the longest content among results — used as consensus body when sources agree. */
function pickConsensusBody(results: MultiSourceSourceResult[]): string {
  if (results.length === 0) return "";
  return results.reduce((longest, r) =>
    r.content.length > longest.content.length ? r : longest,
  ).content;
}

/**
 * Dedupe citations across sources while preserving provenance.
 * Same URL from two sources → one entry, second source's name
 * appended via a comma-joined string would mutate shape · instead
 * we keep the FIRST occurrence (which carries the more authoritative
 * source order: perplexity > tavily > exa for sourced research).
 */
function dedupCitations(results: MultiSourceSourceResult[]): MultiSourceCitation[] {
  const seen = new Set<string>();
  const out: MultiSourceCitation[] = [];
  for (const r of results) {
    for (const c of r.citations) {
      if (!c.url) continue;
      const key = c.url.replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: c.url, title: c.title, source: r.name });
    }
  }
  return out;
}

/**
 * Threshold tuning: jaccard >= 0.18 between two source contents
 * is a strong "they agree on the facts" signal in practice (chat
 * answers share ~20-40% of content tokens when they hit the same
 * claim, ~5-12% when they diverge).
 */
const AGREEMENT_THRESHOLD = 0.18;

/* ---------- public API ---------- */

/**
 * Fan-out web search to Perplexity + Tavily + Exa, return a folded
 * consensus + confidence signal. Never throws on partial failure
 * (allSettled · missing-key skip · per-source timeout).
 *
 * Confidence formula:
 *   sourcesReturned/sourcesAttempted × meanPairwiseJaccard
 *   clipped to [0, 1].
 *
 * When sources < 2 returned · confidence falls back to
 * sourcesReturned/sourcesAttempted (no pairwise agreement to compute).
 */
export async function multiSourceSearch(
  query: string,
  opts: MultiSourceOptions = {},
): Promise<MultiSourceResult> {
  // 2026-07-05 · Perplexica joins the DEFAULT quorum only when actually
  // configured. Confidence = successes / requested.length, so listing an
  // unconfigured source in the default set would DILUTE every score on
  // deployments that don't run Perplexica (weakening the anti-fabrication
  // signal) — it never succeeds but still grows the denominator. Explicit
  // `opts.sources` is always honored verbatim.
  const requested = opts.sources?.length
    ? opts.sources
    : ALL_SOURCES.filter((s) => s !== "perplexica" || hasPerplexica());
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Skip sources whose API key isn't configured · not an error.
  const available = requested.filter(hasApiKey);

  if (available.length === 0) {
    return {
      consensus: null,
      sources: [],
      disagreement: "No search sources are configured (missing all API keys).",
      confidence: 0,
      citations: [],
    };
  }

  // Build the parallel dispatches. Each source maps onto a uniform
  // shape so downstream folding is per-source-agnostic.
  const dispatches = available.map(async (name): Promise<MultiSourceSourceResult> => {
    const baseOpts = {
      allowedDomains: opts.domains?.allow,
      blockedDomains: opts.domains?.block,
      recency: opts.recency,
    };

    if (name === "perplexity") {
      const r: PerplexityResponse = await withTimeout(
        askPerplexity(query, baseOpts),
        timeoutMs,
        "perplexity",
      );
      return {
        name,
        content: r.content,
        citations: r.citations,
        model: r.model,
      };
    }
    if (name === "tavily") {
      const r: TavilyResponse = await withTimeout(
        askTavily(query, baseOpts),
        timeoutMs,
        "tavily",
      );
      return {
        name,
        content: r.content,
        citations: r.citations,
        model: r.model,
      };
    }
    if (name === "exa") {
      const r: ExaResponse = await withTimeout(
        askExa(query, baseOpts),
        timeoutMs,
        "exa",
      );
      return {
        name,
        content: r.content,
        citations: r.citations,
        model: r.model,
      };
    }
    if (name === "perplexica") {
      // Free self-hosted 5th source. askPerplexica is already withGuardian-
      // wrapped (reliabilityOnly); the withTimeout here is the same per-source
      // budget the metered sources get. 'balanced' mode trades a little speed
      // for better retrieval on verification queries.
      const r = await withTimeout(
        askPerplexica(query, { optimizationMode: "balanced" }),
        timeoutMs,
        "perplexica",
      );
      return {
        name,
        content: r.content,
        citations: r.citations,
        model: r.model,
      };
    }
    // google search grounding
    const r = await withTimeout(
      askGoogleSearch(query),
      timeoutMs,
      "google",
    );
    return {
      name,
      content: r.content,
      citations: r.citations,
      model: r.model,
    };
  });

  const settled = await Promise.allSettled(dispatches);

  const successes: MultiSourceSourceResult[] = [];
  const failures: Array<{ name: SourceName; reason: string }> = [];
  settled.forEach((s, idx) => {
    const name = available[idx];
    if (s.status === "fulfilled" && s.value.content.trim().length > 0) {
      successes.push(s.value);
    } else if (s.status === "fulfilled") {
      // Fulfilled-but-empty · counts as a soft failure for quorum.
      failures.push({ name, reason: "empty content" });
      log.warn("multi_search_source_empty", { source: name });
    } else {
      const reason =
        s.reason instanceof Error ? s.reason.message : String(s.reason);
      // v10.0.529.3 M5 fix · discriminate timeout vs other failures so
      // the operator can spot "tavily timed out 8 times this hour" and
      // tune the per-source budget. Pre-fix · all failures went into
      // a single in-memory `failures` array surfaced only via the
      // disagreement field on all-source failure.
      const isTimeout = reason.includes("timed out after");
      if (isTimeout) {
        log.warn("multi_search_source_timeout", { source: name });
      } else {
        log.warn("multi_search_source_failed", {
          source: name,
          reason: reason.slice(0, 200),
        });
      }
      failures.push({ name, reason });
    }
  });

  const citations = dedupCitations(successes);

  // Quorum analysis.
  if (successes.length === 0) {
    // v10.0.525 H1 fix · log.error so the operator dashboard
    // surfaces the failure. Pre-fix this path was silent · the
    // chat model saw "empty result" and was free to fabricate.
    log.error("all_sources_failed", {
      query: query.slice(0, 200),
      failures: failures.map((f) => ({
        name: f.name,
        reason: f.reason.slice(0, 200),
      })),
    });
    return {
      consensus: null,
      sources: [],
      disagreement: `All sources failed: ${failures.map((f) => `${f.name}(${f.reason})`).join(" · ")}`,
      confidence: 0,
      citations,
    };
  }

  if (successes.length === 1) {
    // Single source · pass content through, low confidence.
    const only = successes[0];
    return {
      consensus: only.content,
      sources: successes,
      disagreement: failures.length
        ? `Only ${only.name} returned. Failures: ${failures.map((f) => f.name).join(", ")}.`
        : null,
      confidence: 1 / requested.length,
      citations,
    };
  }

  // ≥ 2 sources · compute pairwise agreement. We track BOTH mean
  // (for the divergence message + a quality signal) and MAX (so a
  // single strong-agreement pair forms a quorum even when one
  // outlier source disagrees · v10.0.524 fix from smoke test).
  let pairCount = 0;
  let pairSum = 0;
  let maxPairJaccard = 0;
  let agreeingPair: [number, number] | null = null;
  for (let i = 0; i < successes.length; i++) {
    for (let j = i + 1; j < successes.length; j++) {
      const sim = jaccardSimilarity(successes[i].content, successes[j].content);
      pairSum += sim;
      pairCount += 1;
      if (sim > maxPairJaccard) {
        maxPairJaccard = sim;
        agreeingPair = [i, j];
      }
    }
  }
  const meanAgreement = pairCount === 0 ? 0 : pairSum / pairCount;
  const quorumFrac = successes.length / requested.length;

  // Quorum detected when a pair agrees strongly · the dissenting
  // source becomes a citation but doesn't kill consensus.
  if (maxPairJaccard >= AGREEMENT_THRESHOLD && agreeingPair) {
    const [a, b] = agreeingPair;
    const agreeing = [successes[a], successes[b]];
    // Confidence reflects the agreeing pair's strength + quorum
    // breadth. 2/3 with strong agreement = ~0.66+ as documented.
    const confidence = Math.max(
      0,
      Math.min(1, quorumFrac * (0.5 + 0.5 * maxPairJaccard)),
    );
    return {
      consensus: pickConsensusBody(agreeing),
      sources: successes,
      disagreement: null,
      confidence,
      citations,
    };
  }

  // No agreeing pair · genuine divergence.
  const confidence = Math.max(
    0,
    Math.min(1, quorumFrac * (0.5 + 0.5 * meanAgreement)),
  );

  // Divergence · surface each source's view for downstream chat to
  // present transparently rather than picking a winner blindly.
  const diverg = successes
    .map((s) => `${s.name}: "${s.content.slice(0, 220)}${s.content.length > 220 ? "…" : ""}"`)
    .join("\n");
  return {
    consensus: null,
    sources: successes,
    disagreement: `Sources diverged (mean agreement ${meanAgreement.toFixed(2)} < threshold ${AGREEMENT_THRESHOLD}):\n${diverg}`,
    confidence,
    citations,
  };
}

/* ---------- test-only exports ----------
 * Exposed so the test suite can exercise pure helpers without
 * hitting the network. NOT part of the public chat-tool contract.
 */
export const __test__ = {
  tokenize,
  jaccardSimilarity,
  dedupCitations,
  AGREEMENT_THRESHOLD,
};
