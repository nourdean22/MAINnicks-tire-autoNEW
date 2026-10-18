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
 * Fallback (2026-10-18): when CAMOFOX_URL + CAMOFOX_API_KEY are set, a
 * self-hosted camofox-browser serves the page if Firecrawl has no key, is out
 * of credits (30-min in-process cooldown) or fails. See ./camofox.ts and
 * docs/runbooks/camofox-scrape-fallback.md. Unset, nothing changes.
 *
 * API: https://docs.firecrawl.dev
 * Package: @mendable/firecrawl-js
 *
 * Per /tool-use-guardian: failures classified + retried. Per
 * /error-handling-patterns: throws fast on missing-key.
 */

import { withGuardian } from "@/lib/tools/guardian";
import { isCamofoxConfigured, scrapeWithCamofox } from "@/lib/integrations/camofox";
import { logger } from "@/lib/logger";

const log = logger.withSurface("integrations/firecrawl");

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
  /** Which provider served the page (camofox is the self-hosted fallback) */
  provider?: "firecrawl" | "camofox";
  /** Requested options the serving provider could not apply (camofox: includeTags / excludeTags) */
  ignoredOptions?: string[];
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

/**
 * Thrown when the SSRF gate refuses a URL. Named so callers (and the
 * guardian's failure classifier) can tell "we refused" from "the network
 * or the vendor failed" — a refusal is deterministic and must not look
 * like a transient fault.
 */
export class UnsafeScrapeUrlError extends Error {
  readonly reason: string;
  constructor(url: string, reason: string) {
    super(`Refused to scrape ${url}: ${reason}`);
    this.name = "UnsafeScrapeUrlError";
    this.reason = reason;
  }
}

async function _scrapeUrl(
  url: string,
  opts: FirecrawlOptions = {},
): Promise<FirecrawlResult> {
  // ── SSRF gate, AT THE SINK (2026-09-02 deep-research audit, C-2) ──────
  // assertPublicUrl() shipped 2026-xx as the defense for exactly this sink,
  // and was called at only 2 of the 6 places that reach it: the scrapeWebPage
  // tool (lib/ai/tools/system.ts) and the Telegram URL path. deep-research.ts,
  // intelligence/ingest.ts, intelligence/change-detection.ts and
  // intelligence/connectors/competitor-watch.ts all called scrapeUrl() with a
  // URL that ultimately traces back to model output or a stored source row,
  // with no check at all. That is this repo's own recurring defect shape — a
  // control that exists, is correct, and is wired on some paths but not all
  // (the fencing wave, #2062/#2064/#2065, was the same lesson) — so the check
  // now lives where every caller must pass through it rather than at each
  // call site where the next caller can forget it.
  //
  // Callers that already assert stay correct: the check is idempotent and
  // costs one cached DNS lookup.
  //
  // The gate covers BOTH providers: nothing below it runs for a refused URL,
  // and a refusal never falls back.
  const { assertPublicUrl } = await import("@/lib/utils/url-safety");
  const safety = await assertPublicUrl(url);
  if (!safety.safe) {
    throw new UnsafeScrapeUrlError(url, safety.reason ?? "failed_url_safety_check");
  }

  // camofox unconfigured: exactly the pre-fallback path (same calls, same errors).
  if (!isCamofoxConfigured()) return scrapeWithFirecrawl(url, opts);

  // 2026-10-18 · Firecrawl ran out of credits; camofox (self-hosted, free) serves
  // the page when Firecrawl has no key, is inside its credit cooldown, or fails.
  let firecrawlCause: string;
  if (!isFirecrawlConfigured()) {
    firecrawlCause = "FIRECRAWL_API_KEY not configured";
  } else if (Date.now() < firecrawlCreditsBlockedUntil) {
    firecrawlCause = `skipped: credits exhausted, retry after ${new Date(firecrawlCreditsBlockedUntil).toISOString()}`;
  } else {
    try {
      return await scrapeWithFirecrawl(url, opts);
    } catch (err) {
      if (isCreditsExhausted(err)) firecrawlCreditsBlockedUntil = Date.now() + FIRECRAWL_CREDIT_COOLDOWN_MS;
      firecrawlCause = errorMessage(err);
    }
  }
  try {
    const page = await scrapeWithCamofox(url, opts);
    // The guardian records this sink as "firecrawl-scrape" either way; this line says who served it.
    log.info("scrape_served_by_camofox", { firecrawlCause: firecrawlCause.slice(0, 160) });
    return page;
  } catch (err) {
    if (err instanceof UnsafeScrapeUrlError) throw err;
    throw new Error(`Scrape failed on both providers · firecrawl: ${firecrawlCause} · camofox: ${errorMessage(err)}`);
  }
}

// A dead plan costs one failed Firecrawl call per cooldown, not one per scrape.
// In-process only: a restart pays one more failed call, which is free (402).
const FIRECRAWL_CREDIT_COOLDOWN_MS = 30 * 60_000;
let firecrawlCreditsBlockedUntil = 0;

/** Test-only · closes the credit breaker. */
export function __resetScrapeCreditBreaker(): void {
  firecrawlCreditsBlockedUntil = 0;
}

/** HTTP 402 from either SDK error shape (FirecrawlError.statusCode, SdkError.status), or the vendor's wording. */
function isCreditsExhausted(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string };
  if (e?.status === 402 || e?.statusCode === 402) return true;
  return /insufficient credits|payment required/i.test(String(e?.message ?? ""));
}

function errorMessage(err: unknown): string {
  return String((err as { message?: string })?.message ?? err).slice(0, 300);
}

async function scrapeWithFirecrawl(
  url: string,
  opts: FirecrawlOptions,
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

  // @mendable/firecrawl-js v4 returns the scraped Document DIRECTLY on success
  // ({ markdown, metadata, ... }) — there is NO top-level `success` field. The
  // old `if (!response.success)` check therefore threw on EVERY v4 call
  // (success === undefined), silently breaking every Firecrawl consumer with a
  // masked "unknown error". Only treat an EXPLICIT success:false (legacy shape)
  // as a failure; a genuine SDK error throws before we reach here.
  if (response?.success === false) {
    throw new Error(
      `Firecrawl scrape failed: ${response.error ?? "unknown error"}`,
    );
  }

  // v4 returns the doc at the top level; older/legacy shapes nest it under .data.
  const doc = response?.data ?? response ?? {};
  const markdown: string = doc.markdown ?? "";
  const metadata = doc.metadata ?? {};
  const maxLen = opts.maxLength ?? 12_000;

  return {
    markdown: markdown.length > maxLen
      ? markdown.slice(0, maxLen) + "\n\n...[truncated]"
      : markdown,
    title: metadata.title ?? null,
    description: metadata.description ?? null,
    sourceUrl: metadata.sourceURL ?? url,
    charCount: markdown.length,
    provider: "firecrawl",
  };
}

/**
 * Guardian-wrapped exterior — 30s timeout, 2 retries.
 * Slightly longer timeout than Tavily/Perplexity because Firecrawl
 * renders JS-heavy pages which can take 10-15s.
 *
 * shortcut: the 30s budget covers Firecrawl AND the camofox fallback in sequence,
 * so a Firecrawl failure that is slow (not the fast 402) leaves camofox less
 * time; raise timeoutMs if slow vendor errors show up in guardian_call_failed.
 */
export const scrapeUrl = withGuardian("firecrawl-scrape", _scrapeUrl, {
  timeoutMs: 30_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal sub-op behind the scrapeWebPage tool
});

/** Quick check if Firecrawl is configured */
export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

/** True when scrapeUrl has at least one provider (Firecrawl or camofox). Callers gate on this. */
export function isScrapeConfigured(): boolean {
  return isFirecrawlConfigured() || isCamofoxConfigured();
}
