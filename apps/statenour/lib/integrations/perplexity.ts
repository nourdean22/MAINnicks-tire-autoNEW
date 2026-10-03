/**
 * Perplexity web intelligence adapter.
 *
 * Current architecture:
 *   · Search API for retrieval-first verified web search
 *   · Agent API for synthesized answers with web-search citations
 *   · domain + recency filters
 *   · Guardian retries / bounded timeouts
 *
 * Sonar Chat Completions support ended in September 2026, so the public
 * StateNour helper names remain stable while the transport uses current APIs.
 */

import { withGuardian } from "@/lib/tools/guardian";

export interface PerplexityCitation {
  url: string;
  title?: string;
}

export interface PerplexityResponse {
  content: string;
  citations: PerplexityCitation[];
  model: string;
}

export interface PerplexityOptions {
  /** System prompt prefix · default = research-assistant frame */
  systemPrompt?: string;
  /** Allow only these domains (e.g. ["wsj.com", "bloomberg.com"]) */
  allowedDomains?: string[];
  /** Block these domains */
  blockedDomains?: string[];
  /** Limit to results from a specific timeframe */
  recency?: "day" | "week" | "month" | "year";
  /** Model tier · sonar = cheap, sonar-pro = deeper, sonar-reasoning = analytic */
  tier?: "sonar" | "sonar-pro" | "sonar-reasoning";
  /** Max output tokens · default 1024 */
  maxTokens?: number;
}

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error("PERPLEXITY_API_KEY not configured");
  return key;
}

export interface PerplexitySearchResponse extends PerplexityResponse {
  results: Array<{ url: string; title?: string; snippet?: string; date?: string }>;
}

async function _searchPerplexity(
  query: string,
  opts: Pick<PerplexityOptions, "allowedDomains" | "blockedDomains" | "recency"> = {},
): Promise<PerplexitySearchResponse> {
  const body: Record<string, unknown> = { query, max_results: 10 };
  if (opts.allowedDomains?.length) {
    body.search_domain_filter = opts.allowedDomains.slice(0, 20);
  } else if (opts.blockedDomains?.length) {
    body.search_domain_filter = opts.blockedDomains.slice(0, 20).map((d) => `-${d}`);
  }
  if (opts.recency) body.search_recency_filter = opts.recency;

  const res = await fetch("https://api.perplexity.ai/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "<body unreadable>");
    const error: Error & { status?: number } = new Error(
      `Perplexity Search API error ${res.status}: ${err.slice(0, 300)}`,
    );
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as Record<string, unknown>;
  const rawResults: unknown[] = Array.isArray(data.results) ? data.results : [];
  const results = rawResults
    .filter((item: unknown): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      url: typeof item.url === "string" ? item.url : "",
      title: typeof item.title === "string" ? item.title : undefined,
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      date: typeof item.date === "string" ? item.date : undefined,
    }))
    .filter((item) => Boolean(item.url));

  return {
    content: results
      .slice(0, 8)
      .map((item, index) =>
        `[${index + 1}] ${item.title ?? item.url}\n${item.snippet ?? ""}`.trim(),
      )
      .join("\n\n"),
    citations: results.map((item) => ({ url: item.url, title: item.title })),
    model: "perplexity-search",
    results,
  };
}

export const searchPerplexity = withGuardian("perplexity-search-api", _searchPerplexity, {
  timeoutMs: 20_000,
  maxRetries: 2,
  reliabilityOnly: true,
});

async function _askPerplexity(
  question: string,
  opts: PerplexityOptions = {},
): Promise<PerplexityResponse> {
  // Sonar Chat Completions support ended 2026-09-27. Keep the public
  // StateNour option names stable, but map them onto Agent API presets.
  const preset =
    opts.tier === "sonar-reasoning"
      ? "low"
      : "fast";

  const filters: Record<string, unknown> = {};
  if (opts.allowedDomains?.length) {
    filters.search_domain_filter = opts.allowedDomains.slice(0, 20);
  } else if (opts.blockedDomains?.length) {
    filters.search_domain_filter = opts.blockedDomains
      .slice(0, 20)
      .map((d) => `-${d}`);
  }
  if (opts.recency) filters.search_recency_filter = opts.recency;

  const webSearchTool: Record<string, unknown> = { type: "web_search" };
  if (Object.keys(filters).length > 0) webSearchTool.filters = filters;

  const body: Record<string, unknown> = {
    preset,
    input: question,
    max_output_tokens: opts.maxTokens ?? 1024,
    tools: [webSearchTool],
  };
  if (opts.systemPrompt) body.instructions = opts.systemPrompt;

  const res = await fetch("https://api.perplexity.ai/v1/agent", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text().catch((e) =>
      e instanceof Error
        ? `<body decode failed: ${e.message.slice(0, 100)}>`
        : "<body unreadable>",
    );
    const error: Error & { status?: number } = new Error(
      `Perplexity Agent API error ${res.status}: ${err.slice(0, 300)}`,
    );
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as Record<string, unknown>;
  const responseStatus = typeof data.status === "string" ? data.status : undefined;
  if (responseStatus === "failed" || responseStatus === "cancelled") {
    const upstreamError =
      data.error && typeof data.error === "object"
        ? (data.error as Record<string, unknown>)
        : undefined;
    const message =
      typeof upstreamError?.message === "string"
        ? upstreamError.message
        : `Perplexity Agent API run ${responseStatus}`;
    const error: Error & { status?: string } = new Error(
      `Perplexity Agent API ${responseStatus}: ${message.slice(0, 300)}`,
    );
    error.status = responseStatus;
    throw error;
  }

  const output: unknown[] = Array.isArray(data.output) ? data.output : [];
  const content = output
    .filter((item: unknown): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && (item as Record<string, unknown>).type === "message",
    )
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((part: unknown): part is Record<string, unknown> =>
      Boolean(part) && typeof part === "object" && (part as Record<string, unknown>).type === "output_text",
    )
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");

  const citations: PerplexityCitation[] = [];
  const seen = new Set<string>();
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "search_results" || !Array.isArray(record.results)) continue;
    for (const result of record.results) {
      if (!result || typeof result !== "object") continue;
      const hit = result as Record<string, unknown>;
      const url = typeof hit.url === "string" ? hit.url : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      citations.push({
        url,
        title: typeof hit.title === "string" ? hit.title : undefined,
      });
    }
  }

  return {
    content,
    citations,
    model: typeof data.model === "string" ? data.model : `perplexity-agent:${preset}`,
  };
}

/**
 * Guardian-wrapped exterior · auto-retries network/timeout/rate-limit
 * failures up to 2 times with backoff. Auth + 4xx fail fast.
 */
export const askPerplexity = withGuardian("perplexity-search", _askPerplexity, {
  timeoutMs: 25_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal per-source sub-op behind web.search.* tools
});

/**
 * Backwards-compat overload · accepts (question, systemPrompt) for older callers.
 */
export async function askPerplexityLegacy(
  question: string,
  systemPrompt?: string,
): Promise<PerplexityResponse> {
  return askPerplexity(question, systemPrompt ? { systemPrompt } : {});
}

/**
 * Research a competitor for Nick's Tire & Auto.
 */
export async function researchCompetitor(competitorName: string): Promise<PerplexityResponse> {
  return askPerplexity(
    `Research "${competitorName}" auto repair shop in Cleveland/Euclid Ohio area. What are their prices, services, reviews, and competitive advantages? How do they compare to a shop with 4.9 stars and 1,700+ reviews?`,
    {
      systemPrompt:
        "You are a competitive intelligence analyst for an auto repair shop. Be specific with data points, prices, and actionable insights.",
      recency: "month",
    },
  );
}

/**
 * Research a topic relevant to the business.
 */
export async function researchTopic(topic: string): Promise<PerplexityResponse> {
  return askPerplexity(topic, {
    systemPrompt:
      "You are a research assistant for Nour, CEO of Nick's Tire & Auto in Cleveland OH. Provide actionable, data-backed insights. Include specific numbers, trends, and recommendations. Always cite sources.",
  });
}

/**
 * v10.0.358 · structured web-search entry point · used by Nick's
 * arsenal.webSearch tool call. Defaults to authoritative-source
 * preference + last-month recency for "current state of world"
 * questions.
 */
export async function smartWebSearch(args: {
  query: string;
  recency?: "day" | "week" | "month" | "year";
  allowedDomains?: string[];
  blockedDomains?: string[];
  tier?: "sonar" | "sonar-pro" | "sonar-reasoning";
}): Promise<PerplexityResponse> {
  return askPerplexity(args.query, {
    systemPrompt:
      "You are a research assistant for Nour, CEO of Nick's Tire & Auto in Cleveland OH. Be specific, cite sources inline (with [N] markers), and prioritize verifiable facts over speculation. If the data is uncertain or stale, say so.",
    recency: args.recency,
    allowedDomains: args.allowedDomains,
    blockedDomains: args.blockedDomains,
    tier: args.tier,
  });
}
