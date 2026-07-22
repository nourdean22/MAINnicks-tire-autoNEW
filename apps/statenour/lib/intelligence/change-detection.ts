/**
 * change-detection-lite — a cheap external-change SENSOR.
 *
 * The "changedetection.io, in-repo" the architecture review recommended:
 * Firecrawl scrapes each watched page, we hash the normalized content and
 * compare it to that url's previous snapshot, and persist a new PageSnapshot
 * with a `changed` flag. It is deliberately a SENSOR only — it OBSERVES
 * (scrape + record + log) and takes NO autonomous action on a change (no
 * Stagehand, no sends). Surfacing/acting on changes is a separate, gated step.
 *
 * Firecrawl-gated: no API key => no snapshots (never mocked, never summarized
 * from memory), matching the intelligence pipeline's AG-02 grounding rule.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/change-detection");

export interface WatchedPage {
  label: string;
  url: string;
}

/**
 * Pages worth watching for material external change. Extend as the shop's
 * intelligence needs grow (competitor pricing, regulatory pages, platform
 * policy, supplier rebates). Kept as a code const — the established watch-list
 * idiom in this repo (see connectors/competitor-watch.ts WATCH_TARGETS).
 */
export const WATCHED_PAGES: ReadonlyArray<WatchedPage> = [
  { label: "Discount Tire deals", url: "https://www.discounttire.com/deals" },
  { label: "Conrad's Tire Express coupons", url: "https://www.econrads.com/coupons" },
  { label: "Ohio E-Check program", url: "https://www.epa.ohio.gov/divisions-and-offices/air-pollution-control/mobile-sources/e-check" },
];

const MAX_CONTENT_CHARS = 8000;

/**
 * PURE. Normalize scraped markdown so trivial whitespace churn doesn't register
 * as a change (collapse whitespace runs, trim).
 */
export function normalizeContent(markdown: string): string {
  return (markdown ?? "").replace(/\s+/g, " ").trim();
}

/** PURE. Stable content fingerprint (sha256 hex of the normalized content). */
export function hashContent(markdown: string): string {
  return createHash("sha256").update(normalizeContent(markdown)).digest("hex");
}

/**
 * PURE. A change is only real when there IS a prior hash and it differs. The
 * first-ever snapshot of a url is the baseline, never a "change".
 */
export function isChange(previousHash: string | null | undefined, currentHash: string): boolean {
  return previousHash != null && previousHash !== currentHash;
}

export interface ChangeDetectionResult {
  checked: number;
  changes: Array<{ url: string; label: string }>;
  unchanged: number;
  failed: number;
  /** True when Firecrawl is unconfigured — nothing was scraped or recorded. */
  skipped: boolean;
}

/**
 * Scrape each watched page, hash it, compare to the last stored snapshot, and
 * persist a new snapshot with the `changed` flag. Records + logs changes;
 * takes no further action. Best-effort per page — one failure never aborts the run.
 */
export async function runChangeDetection(
  pages: ReadonlyArray<WatchedPage> = WATCHED_PAGES,
): Promise<ChangeDetectionResult> {
  const { isFirecrawlConfigured, scrapeUrl } = await import("@/lib/integrations/firecrawl");
  if (!isFirecrawlConfigured()) {
    log.info("FIRECRAWL_API_KEY not configured; change-detection skipped (no mock).");
    return { checked: 0, changes: [], unchanged: 0, failed: 0, skipped: true };
  }

  const changes: Array<{ url: string; label: string }> = [];
  let unchanged = 0;
  let failed = 0;
  let checked = 0;

  for (const page of pages) {
    try {
      const scraped = await scrapeUrl(page.url, { maxLength: MAX_CONTENT_CHARS });
      const content = (scraped.markdown ?? "").slice(0, MAX_CONTENT_CHARS);
      if (!normalizeContent(content)) {
        // Empty scrape => the snapshot is simply ABSENT, not a change.
        failed++;
        continue;
      }
      const currentHash = hashContent(content);
      const prev = await prisma.pageSnapshot.findFirst({
        where: { url: page.url },
        orderBy: { checkedAt: "desc" },
        select: { contentHash: true },
      });
      const changed = isChange(prev?.contentHash, currentHash);

      await prisma.pageSnapshot.create({
        data: { url: page.url, label: page.label, contentHash: currentHash, content, changed },
      });
      checked++;
      if (changed) {
        changes.push({ url: page.url, label: page.label });
        log.info("page_change_detected", { url: page.url, label: page.label });
      } else {
        unchanged++;
      }
    } catch (err) {
      failed++;
      log.warn("change_detection_scrape_failed", {
        url: page.url,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("change_detection_run", { checked, changed: changes.length, unchanged, failed });
  return { checked, changes, unchanged, failed, skipped: false };
}
