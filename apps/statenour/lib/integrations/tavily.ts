/**
 * Tavily — Web-search verification source · v10.0.524
 *
 * Free tier: 1,000 searches/month. Used as a parallel cross-check
 * source alongside Perplexity + Exa to reduce factual fabrication
 * in chat replies (Perplexity-only ~5% fab rate · multi-source
 * cross-verification cuts that by quorum agreement).
 *
 * LIFTED-FROM-PERPLEXITY-PATTERN NOTE:
 *   Shape (options · response · withGuardian wrap · 25s timeout ·
 *   2 retries) mirrors lib/integrations/perplexity.ts EXACTLY so
 *   the multi-search orchestrator can treat all three sources as
 *   interchangeable. Same PerplexityResponse-compatible return:
 *   { content, citations[], model }.
 *
 * Tavily API: https://docs.tavily.com/docs/rest-api/api-reference
 * Endpoint: POST https://api.tavily.com/search
 *
 * Per /tool-use-guardian: failures classified + retried. Per
 * /error-handling-patterns: throws fast on missing-key (callers
 * are expected to detect-and-skip via try/catch in the orchestrator).
 */

import { withGuardian } from "@/lib/tools/guardian";

export interface TavilyCitation {
  url: string;
  title?: string;
}

export interface TavilyResponse {
  content: string;
  citations: TavilyCitation[];
  model: string;
}

export interface TavilyOptions {
  /** Allow only these domains */
  allowedDomains?: string[];
  /** Block these domains */
  blockedDomains?: string[];
  /** Time-window filter · Tavily accepts day/week/month/year */
  recency?: "day" | "week" | "month" | "year";
  /** Search depth · basic (cheap) / advanced (deeper · 2 credits) */
  depth?: "basic" | "advanced";
  /** Max results to include in the synthesis · default 5 */
  maxResults?: number;
  /** If true, include the AI-generated answer summary · default true */
  includeAnswer?: boolean;
}

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyApiBody {
  api_key: string;
  query: string;
  search_depth: "basic" | "advanced";
  include_answer: boolean;
  max_results: number;
  include_domains?: string[];
  exclude_domains?: string[];
  topic?: string;
  days?: number;
  time_range?: "day" | "week" | "month" | "year";
}

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY not configured");
  return key;
}

async function _askTavily(
  question: string,
  opts: TavilyOptions = {},
): Promise<TavilyResponse> {
  const depth = opts.depth ?? "basic";
  const maxResults = opts.maxResults ?? 5;

  const body: TavilyApiBody = {
    api_key: getApiKey(),
    query: question,
    search_depth: depth,
    include_answer: opts.includeAnswer ?? true,
    max_results: maxResults,
  };

  if (opts.allowedDomains?.length) {
    body.include_domains = opts.allowedDomains.slice(0, 20);
  }
  if (opts.blockedDomains?.length) {
    body.exclude_domains = opts.blockedDomains.slice(0, 20);
  }
  if (opts.recency) {
    body.time_range = opts.recency;
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), // wave-181.90 follow-up
  });

  if (!res.ok) {
    // v10.0.529.3 M7 fix · distinguish body-decode failure (transport
    // issue) from upstream non-2xx with empty body. Helps diagnose
    // flakey edge-runtime paths vs real provider degradation.
    const err = await res.text().catch((e) =>
      e instanceof Error
        ? `<body decode failed: ${e.message.slice(0, 100)}>`
        : "<body unreadable>",
    );
    const error: Error & { status?: number } = new Error(
      `Tavily API error ${res.status}: ${err.slice(0, 300)}`,
    );
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as {
    answer?: string;
    results?: TavilyRawResult[];
  };

  // Synthesize content · prefer Tavily's AI-generated answer if present,
  // otherwise concatenate the top result snippets. Either way, never
  // fabricate — every URL came from the API.
  const results = Array.isArray(data.results) ? data.results : [];
  const synthesized = data.answer && data.answer.trim().length > 0
    ? data.answer
    : results
        .slice(0, maxResults)
        .map((r, i) => `[${i + 1}] ${r.title ?? "Untitled"} — ${r.content ?? ""}`)
        .join("\n\n");

  const citations: TavilyCitation[] = results
    .filter((r): r is TavilyRawResult & { url: string } => typeof r.url === "string" && r.url.length > 0)
    .map((r) => ({
      url: r.url,
      title: typeof r.title === "string" ? r.title : undefined,
    }));

  return {
    content: synthesized,
    citations,
    model: `tavily-${depth}`,
  };
}

/**
 * Guardian-wrapped exterior · same 25s/2-retry profile as
 * Perplexity so the parallel orchestrator can treat all sources
 * identically.
 */
export const askTavily = withGuardian("tavily-search", _askTavily, {
  timeoutMs: 25_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal per-source sub-op behind web.search.verified
});
