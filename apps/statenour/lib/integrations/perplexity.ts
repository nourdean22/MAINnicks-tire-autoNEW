/**
 * Perplexity AI — Research engine with citations.
 * Free tier: limited queries/day via API.
 * Used for: competitor research, market analysis, customer question answering.
 *
 * v10.0.358 · upgraded with /search-specialist options:
 *   · allowedDomains / blockedDomains · target authoritative sources
 *   · recency filter · last day/week/month/year
 *   · explicit citation return · so Nick can cite in chat replies
 *   · model tier · sonar (cheap) / sonar-pro (deeper) / sonar-reasoning
 *   · wrapped with tool-use-guardian (v10.0.357) · auto-retry transient
 *     failures, classify on persistent fail
 */

import { withGuardian } from "@/lib/tools/guardian";

interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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

async function _askPerplexity(
  question: string,
  opts: PerplexityOptions = {},
): Promise<PerplexityResponse> {
  const messages: PerplexityMessage[] = [];

  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: question });

  // Domain filter · Perplexity supports up to 10 domains, prefix "-" to block
  const domainFilter: string[] = [];
  if (opts.allowedDomains?.length) {
    domainFilter.push(...opts.allowedDomains.slice(0, 10));
  }
  if (opts.blockedDomains?.length) {
    domainFilter.push(...opts.blockedDomains.slice(0, 10).map((d) => `-${d}`));
  }

  const body: Record<string, unknown> = {
    model: opts.tier ?? "sonar",
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    return_citations: true,
  };
  if (domainFilter.length > 0) body.search_domain_filter = domainFilter;
  if (opts.recency) body.search_recency_filter = opts.recency;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // wave-181.90 follow-up · 30s · perplexity's online search can be slow
    // when it pulls many sources · give it more room than exa/tavily.
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    // v10.0.529.3 M7 fix · distinguish body-decode failure (transport
    // issue) from upstream non-2xx with empty body. Same shape as
    // tavily.ts + exa.ts.
    const err = await res.text().catch((e) =>
      e instanceof Error
        ? `<body decode failed: ${e.message.slice(0, 100)}>`
        : "<body unreadable>",
    );
    const error: Error & { status?: number } = new Error(
      `Perplexity API error ${res.status}: ${err.slice(0, 300)}`,
    );
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || "",
    citations: (data.citations || []).map((c: unknown) =>
      typeof c === "string" ? { url: c } : (c as PerplexityCitation),
    ),
    model: data.model || (opts.tier ?? "sonar"),
  };
}

/**
 * Guardian-wrapped exterior · auto-retries network/timeout/rate-limit
 * failures up to 2 times with backoff. Auth + 4xx fail fast.
 */
export const askPerplexity = withGuardian("perplexity-search", _askPerplexity, {
  timeoutMs: 25_000,
  maxRetries: 2,
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
