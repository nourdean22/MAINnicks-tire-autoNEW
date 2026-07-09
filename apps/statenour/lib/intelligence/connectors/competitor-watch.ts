/**
 * Competitor web watch · AG-44 (2026-07-09).
 *
 * Scrapes the public deals/promo pages of the two competitors the
 * operator actually loses tire quotes to (Discount Tire national,
 * Conrad's Tire Express Cleveland-local) via Firecrawl, so the daily
 * intelligence brief's competitor section carries LIVE promo signals
 * instead of only SEC filings.
 *
 * AG-02 grounding rule applies: Firecrawl unkeyed or a scrape failing
 * → that snapshot is simply ABSENT. Never mocked, never summarized
 * from memory. Each snapshot carries the URL it actually fetched.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/competitor-watch");

export interface CompetitorPageSnapshot {
  competitor: string;
  url: string;
  title: string | null;
  /** First ~1200 chars of the page markdown — promo headlines live at the top. */
  excerpt: string;
  fetchedAt: string;
}

const WATCH_TARGETS: ReadonlyArray<{ competitor: string; url: string }> = [
  { competitor: "Discount Tire", url: "https://www.discounttire.com/deals" },
  { competitor: "Conrad's Tire Express", url: "https://www.econrads.com/coupons" },
];

export async function fetchCompetitorPages(): Promise<CompetitorPageSnapshot[]> {
  const { isFirecrawlConfigured, scrapeUrl } = await import("@/lib/integrations/firecrawl");
  if (!isFirecrawlConfigured()) {
    log.info("FIRECRAWL_API_KEY not configured; emitting no competitor snapshots rather than mock promos.");
    return [];
  }

  const snapshots = await Promise.all(
    WATCH_TARGETS.map(async (t) => {
      try {
        const page = await scrapeUrl(t.url, { maxLength: 4000 });
        const excerpt = (page.markdown ?? "").trim().slice(0, 1200);
        if (!excerpt) return null;
        return {
          competitor: t.competitor,
          url: page.sourceUrl || t.url,
          title: page.title,
          excerpt,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        log.warn("competitor_scrape_failed", {
          competitor: t.competitor,
          url: t.url,
          err: err instanceof Error ? err.message.slice(0, 160) : String(err),
        });
        return null;
      }
    }),
  );

  return snapshots.filter((s): s is CompetitorPageSnapshot => s !== null);
}
