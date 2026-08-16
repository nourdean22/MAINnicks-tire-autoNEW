/**
 * SearXNG — the metasearch layer, queried DIRECTLY.
 *
 * The stack is statenour → Perplexica → SearXNG. Perplexica's contribution over
 * raw SearXNG is an LLM synthesis pass: it folds 30-60 scraped sources into
 * prose. statenour then feeds that prose to its OWN model, which synthesizes
 * again — so the expensive middle pass is written for a reader that immediately
 * rewrites it.
 *
 * Measured on the live services, 2026-08-16, three queries each:
 *
 *   SearXNG (raw results)      2.4s ·  5.4s ·  6.1s     20-28 results
 *   Perplexica (with synthesis) 30.8s · 42.9s · 52.1s
 *
 * 25-46 seconds, every web search, for a paraphrase. This module skips it and
 * hands statenour's model the sources directly, which is what it needs.
 *
 * Perplexica is NOT removed — it remains the second rung of the primary chain
 * in `arsenalWebSearch`, so a SearXNG outage degrades to exactly the previous
 * behaviour rather than to nothing.
 *
 * Shaped identically to `PerplexicaResponse` so callers consume it unbranched.
 */

import { withGuardian } from "@/lib/tools/guardian";
import type { PerplexicaCitation, PerplexicaResponse } from "@/lib/integrations/perplexica";

// Unlike PERPLEXICA_API_URL — which deliberately refuses to guess, because an
// earlier revision silently aliased the MCP sidecar's host and pointed REST
// calls at the wrong service — this one defaults. There is exactly ONE SearXNG
// service, its private DNS name is assigned by Railway and verified live, and
// the failure mode of a MISSING var here is the bug this module exists to fix:
// the free lane silently never runs and metered providers carry every query.
const DEFAULT_URL = "http://searxng-perplexica.railway.internal:8080";

/** Enough sources for a synthesis pass; past ~10 the tail is near-duplicates. */
const MAX_SOURCES = 10;
/** Snippets are advisory context, not the article. Keeps the tool result small. */
const MAX_SNIPPET_CHARS = 400;

function baseUrl(): string {
  return (process.env.SEARXNG_API_URL || DEFAULT_URL).replace(/\/+$/, "");
}

/**
 * True when this process can actually REACH SearXNG.
 *
 * The default URL is a Railway *private* DNS name, resolvable only from inside
 * that network. Returning true unconditionally would make every local run and
 * every test fire a doomed fetch at an unreachable host and wait for it to fail
 * — slow, flaky, and noise in the logs. So: an explicit SEARXNG_API_URL always
 * wins, and the built-in default is trusted only where it resolves.
 */
export function hasSearxng(): boolean {
  if (process.env.SEARXNG_API_URL) return true;
  return Boolean(process.env.RAILWAY_ENVIRONMENT);
}

interface SearxngResult {
  url?: string;
  title?: string;
  content?: string;
}

async function _askSearxng(query: string): Promise<PerplexicaResponse> {
  const url = `${baseUrl()}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`SearXNG ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  const j = (await res.json()) as {
    results?: SearxngResult[];
    unresponsive_engines?: Array<[string, string]>;
  };

  const results = (j.results ?? []).filter((r) => (r.url ?? "").length > 0).slice(0, MAX_SOURCES);

  // A SearXNG instance whose engines are all blocked answers 200 with an EMPTY
  // result set and the reason buried in `unresponsive_engines` — which is how it
  // served zero web results for six weeks while every health check passed. Carry
  // the reason into the thrown error so the caller logs something actionable
  // instead of a bare "no results".
  if (results.length === 0) {
    const why = (j.unresponsive_engines ?? []).map((e) => e.join(":")).join(", ");
    throw new Error(`SearXNG returned no results${why ? ` · unresponsive: ${why}` : ""}`);
  }

  const citations: PerplexicaCitation[] = results.map((r) => ({
    url: r.url as string,
    title: r.title,
  }));

  const content = results
    .map((r, i) => {
      const snippet = (r.content ?? "").trim().slice(0, MAX_SNIPPET_CHARS);
      return `[${i + 1}] ${(r.title ?? "").trim()}\n${r.url}${snippet ? `\n${snippet}` : ""}`;
    })
    .join("\n\n");

  return { content, citations, model: "searxng" };
}

/**
 * Guardian-wrapped exterior. Internal sub-op → reliabilityOnly (skips the
 * AI-tool policy gate, keeps retry/timeout). 10s covers the measured 2.4-6.1s
 * with headroom for a slow engine, and still fails fast enough that the
 * Perplexica rung below it remains reachable inside an interactive turn.
 */
export const askSearxng = withGuardian("searxng-search", _askSearxng, {
  timeoutMs: 10_000,
  maxRetries: 1,
  reliabilityOnly: true,
});
