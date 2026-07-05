/**
 * Exa — Semantic-search verification source · v10.0.524
 *
 * Dev-grade semantic index (Metaphor-era). Used as a parallel
 * cross-check source alongside Perplexity + Tavily to reduce
 * factual fabrication in chat replies.
 *
 * LIFTED-FROM-PERPLEXITY-PATTERN NOTE:
 *   Shape (options · response · withGuardian wrap · 25s timeout ·
 *   2 retries) mirrors lib/integrations/perplexity.ts EXACTLY so
 *   the multi-search orchestrator can treat all three sources as
 *   interchangeable. Same PerplexityResponse-compatible return:
 *   { content, citations[], model }.
 *
 * Exa API: https://docs.exa.ai
 * Endpoint: POST https://api.exa.ai/search
 * Endpoint (combined): POST https://api.exa.ai/contents
 *
 * Exa exposes /search (links) + /contents (full text). For
 * cross-verification we want both, so we call /search with
 * `contents: { text: { maxCharacters: ~1500 } }` to get URLs +
 * snippets in one round-trip.
 */

import { withGuardian } from "@/lib/tools/guardian";

export interface ExaCitation {
  url: string;
  title?: string;
}

export interface ExaResponse {
  content: string;
  citations: ExaCitation[];
  model: string;
}

export interface ExaOptions {
  /** Allow only these domains */
  allowedDomains?: string[];
  /** Block these domains */
  blockedDomains?: string[];
  /** Time-window filter · maps to startPublishedDate */
  recency?: "day" | "week" | "month" | "year";
  /** Search type · neural (semantic) / keyword / auto */
  type?: "neural" | "keyword" | "auto";
  /** Max results · default 5 */
  maxResults?: number;
  /** Snippet text length per result · default 1500 chars */
  textChars?: number;
}

interface ExaSearchResult {
  url?: string;
  title?: string;
  text?: string;
  publishedDate?: string;
  score?: number;
}

interface ExaApiBody {
  query: string;
  type: "neural" | "keyword" | "auto";
  numResults: number;
  contents: {
    text: { maxCharacters: number };
  };
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
}

function getApiKey(): string {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY not configured");
  return key;
}

/**
 * Convert recency keyword to ISO date `recency` days ago.
 * Pure helper · no fabrication, no clock skew tricks.
 */
function recencyToIsoDate(recency: ExaOptions["recency"]): string | undefined {
  if (!recency) return undefined;
  const dayMs = 24 * 60 * 60 * 1000;
  const offsets: Record<NonNullable<ExaOptions["recency"]>, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  const offsetDays = offsets[recency];
  return new Date(Date.now() - offsetDays * dayMs).toISOString();
}

async function _askExa(
  question: string,
  opts: ExaOptions = {},
): Promise<ExaResponse> {
  const maxResults = opts.maxResults ?? 5;
  const textChars = opts.textChars ?? 1500;
  const type = opts.type ?? "auto";

  const body: ExaApiBody = {
    query: question,
    type,
    numResults: maxResults,
    contents: { text: { maxCharacters: textChars } },
  };

  if (opts.allowedDomains?.length) {
    body.includeDomains = opts.allowedDomains.slice(0, 20);
  }
  if (opts.blockedDomains?.length) {
    body.excludeDomains = opts.blockedDomains.slice(0, 20);
  }
  const isoDate = recencyToIsoDate(opts.recency);
  if (isoDate) {
    body.startPublishedDate = isoDate;
  }

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), // wave-181.90 follow-up
  });

  if (!res.ok) {
    // v10.0.529.3 M7 fix · distinguish body-decode failure (transport
    // issue) from upstream non-2xx with empty body. Same shape as
    // tavily.ts + perplexity.ts.
    const err = await res.text().catch((e) =>
      e instanceof Error
        ? `<body decode failed: ${e.message.slice(0, 100)}>`
        : "<body unreadable>",
    );
    const error: Error & { status?: number } = new Error(
      `Exa API error ${res.status}: ${err.slice(0, 300)}`,
    );
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as { results?: ExaSearchResult[] };
  const results = Array.isArray(data.results) ? data.results : [];

  // Synthesize content from result snippets · no AI summary layer
  // (Exa is a raw retrieval index). Format matches the [N] citation
  // markers that downstream prompts already key off of.
  const content = results
    .slice(0, maxResults)
    .map((r, i) => `[${i + 1}] ${r.title ?? "Untitled"} — ${r.text ?? ""}`)
    .join("\n\n");

  const citations: ExaCitation[] = results
    .filter((r): r is ExaSearchResult & { url: string } => typeof r.url === "string" && r.url.length > 0)
    .map((r) => ({
      url: r.url,
      title: typeof r.title === "string" ? r.title : undefined,
    }));

  return {
    content,
    citations,
    model: `exa-${type}`,
  };
}

/**
 * Guardian-wrapped exterior · same 25s/2-retry profile as
 * Perplexity so the parallel orchestrator can treat all sources
 * identically.
 */
export const askExa = withGuardian("exa-search", _askExa, {
  timeoutMs: 25_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal per-source sub-op behind web.search.verified
});
