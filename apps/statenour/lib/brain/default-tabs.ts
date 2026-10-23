/**
 * The tab a tabbed page SHOWS when the URL carries no ?tab= (2026-10-23, usage telemetry). PageTracker
 * logs it as a page_tab_visit so a plain visit to /brain or /stats is a measured tab view, not a hole.
 * /stats uses the page's own resolver; /brain's page passes BRAIN_DEFAULT_TAB to PageTabs as defaultKey
 * (pinned by tests/brain/default-tabs.test.ts). Add a row here when another page gains URL-synced tabs.
 */
import { resolveStatsTab } from "@/lib/stats/resolve-tab";

export const BRAIN_DEFAULT_TAB = "memory";

export function defaultTabFor(pathname: string): string | null {
  if (pathname === "/brain") return BRAIN_DEFAULT_TAB;
  if (pathname === "/stats") return resolveStatsTab(null);
  return null;
}
