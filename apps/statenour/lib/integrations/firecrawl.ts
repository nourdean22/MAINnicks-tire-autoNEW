/**
 * Firecrawl — Web scraping for LLM-ready markdown · v10.0.530
 *
 * Converts any URL into clean markdown optimized for AI consumption.
 * Used by the chat tool `scrapeWebPage` so Nick can read and understand
 * web pages the operator shares or references.
 *
 * Graceful degradation: when FIRECRAWL_API_KEY is not set, the tool
 * returns a clear error message instead of crashing. The multi-search
 * orchestrator and reasoning engine can still function via Perplexity /
 * Tavily / Exa — Firecrawl is an additive web-reading capability, not
 * a hard dependency.
 *
 * API: https://docs.firecrawl.dev
 * Package: @mendable/firecrawl-js
 *
 * Per /tool-use-guardian: failures classified + retried. Per
 * /error-handling-patterns: throws fast on missing-key.
 */

import { withGuardian } from "@/lib/tools/guardian";

export interface FirecrawlResult {
  /** Clean markdown content of the page */
  markdown: string;
  /** Page title if available */
  title: string | null;
  /** Page description / meta description */
  description: string | null;
  /** Final URL after redirects */
  sourceUrl: string;
  /** Number of characters in the markdown */
  charCount: number;
}

export interface FirecrawlOptions {
  /** Formats to request — defaults to ['markdown'] */
  formats?: ("markdown" | "html" | "rawHtml" | "links" | "screenshot")[];
  /** Wait time in ms for JS-heavy pages */
  waitFor?: number;
  /** CSS selectors to include exclusively */
  includeTags?: string[];
  /** CSS selectors to exclude */
  excludeTags?: string[];
  /** Maximum length of returned content (chars) */
  maxLength?: number;
}

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY not configured");
  return key;
}

async function _scrapeUrl(
  url: string,
  opts: FirecrawlOptions = {},
): Promise<FirecrawlResult> {
  // Dynamic import to avoid loading the SDK when FIRECRAWL_API_KEY is missing
  const FirecrawlApp = (await import("@mendable/firecrawl-js")).default;

  const app = new FirecrawlApp({ apiKey: getApiKey() });

  const response = await app.scrapeUrl(url, {
    formats: opts.formats ?? ["markdown"],
    waitFor: opts.waitFor,
    includeTags: opts.includeTags,
    excludeTags: opts.excludeTags,
  }) as any; // SDK returns a union type; cast to avoid brittle narrowing

  if (!response.success) {
    throw new Error(
      `Firecrawl scrape failed: ${response.error ?? "unknown error"}`,
    );
  }

  const markdown = response.markdown ?? "";
  const maxLen = opts.maxLength ?? 12_000;

  return {
    markdown: markdown.length > maxLen
      ? markdown.slice(0, maxLen) + "\n\n...[truncated]"
      : markdown,
    title: response.metadata?.title ?? null,
    description: response.metadata?.description ?? null,
    sourceUrl: response.metadata?.sourceURL ?? url,
    charCount: markdown.length,
  };
}

/**
 * Guardian-wrapped exterior — 30s timeout, 2 retries.
 * Slightly longer timeout than Tavily/Perplexity because Firecrawl
 * renders JS-heavy pages which can take 10-15s.
 */
export const scrapeUrl = withGuardian("firecrawl-scrape", _scrapeUrl, {
  timeoutMs: 30_000,
  maxRetries: 2,
});

/** Quick check if Firecrawl is configured */
export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}
