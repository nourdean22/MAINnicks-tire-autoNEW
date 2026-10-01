/**
 * Page Intelligence — Analyzes Nour's page visit patterns for the brain.
 *
 * Detects:
 * - What Nour focuses on most (priorities)
 * - What Nour avoids (blind spots → potential drift)
 * - Time-of-day patterns (late night usage = potential overthinking)
 * - Correlation signals (not checking drift + not logging scores = Phase 2)
 */

import { prisma } from "@/lib/prisma";
import { hourET, toDateString } from "@/lib/utils/datetime";

export interface PagePattern {
  topPages: Array<{ page: string; count: number }>;
  blindSpots: string[];
  /** Kept for existing callers; it is `lateNightCount > 3`, a judgement. */
  lateNightUsage: boolean;
  /**
   * The COUNT behind `lateNightUsage`. Exported 2026-08-26 because the boolean
   * bakes a threshold in: ">3 visits after 11pm" is someone's opinion about what
   * is a lot, and a surface that shows the number lets the reader form their
   * own. The brief renders the count, never the boolean.
   */
  lateNightCount: number;
  /** Views per ACTIVE day, not per calendar day — `activeDays` is the divisor. */
  avgDailyVisits: number;
  /** Distinct ET dates with at least one visit. The denominator of `avgDailyVisits`. */
  activeDays: number;
  lastActive: string | null;
  /**
   * INFERENCE, not measurement — "Nour may be using conversation as
   * procrastination". Deliberately NOT rendered in the daily brief: that
   * surface's measured failure is unearned claims, and an inference printed as
   * a fact is that failure with a new source. Kept for the chat prompt, where a
   * hypothesis is a reasonable thing to hand a model.
   */
  insights: string[];
}

/** Exported for tests/repo/retired-routes-gate.test.ts: every path here must be a page. */
export const IMPORTANT_PAGES = [
  { path: "/missions", label: "Missions", critical: true },
  { path: "/stats", label: "Stats", critical: false },
  { path: "/chat", label: "Nick AI", critical: false },
  // "/business" (deleted 2026-09-02) and "/strategy" (no page for months) removed:
  // a listed page that cannot be visited becomes a PERMANENT false blind spot in
  // the daily brief and in Nick's prompt (#2069 review).
];

/**
 * Analyze page visits from the last 7 days and generate intelligence.
 */
export async function analyzePagePatterns(): Promise<PagePattern> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const visits = await prisma.auditEvent.findMany({
    where: {
      eventType: "page_visit",
      createdAt: { gte: sevenDaysAgo },
    },
    select: { detail: true, payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  }).catch(() => []);

  const pageCounts: Record<string, number> = {};
  const lastVisited: Record<string, Date> = {};
  let lateNightCount = 0;
  const uniqueDays = new Set<string>();

  for (const v of visits) {
    const page = v.detail || "unknown";
    pageCounts[page] = (pageCounts[page] || 0) + 1;
    if (!lastVisited[page] || v.createdAt > lastVisited[page]) {
      lastVisited[page] = v.createdAt;
    }

    // DERIVE THE HOUR, NEVER READ THE STORED COPY.
    //
    // Each row carries the same fact twice: `createdAt` (stamped by the DB)
    // and `payload.hour` (computed by app code at write time and frozen).
    // This line used to prefer the frozen copy, so a writer bug got baked into
    // the archive permanently.
    //
    // Measured 2026-08-26 over the last 30 days: 691 of 719 rows carry a UTC
    // hour in `payload.hour` while `createdAt` says ET — a clean +4h (the EDT
    // offset). Every day from 07-28 to 08-24 is 100% affected; 08-25 flips
    // mid-day; 08-26 is 100% correct.
    //
    // CAUSE (found 2026-08-27): `1202bdd0f`, "Nick reads the operator's clock,
    // not the server's", merged 2026-08-25T15:17:30Z. It moved the writer in
    // lib/services/brain-domain.ts onto the ET helper. What it replaced was a
    // bare `new Date().getHours()`, which on a Railway container reads the
    // server's zone, not Cleveland's — hence the +4h.
    //
    // The last row of the old shape is 14:56:52Z and the first of the new is
    // 15:26:35Z: that interval CONTAINS the merge, and no row contradicts it.
    // It does not time the rollout — these rows are user activity, not a
    // deployment probe, so the gap is only when a page was next opened.
    //
    // (An earlier note here called the flip environmental. That was wrong,
    // and wrong for an avoidable reason: `git log` was run against this stale
    // checkout's HEAD, which is days behind origin/main and does not contain
    // the commit.)
    //
    // The fix is unchanged by the cause. The stored copy is redundant with an
    // authoritative timestamp, cannot be re-derived once wrong, and those rows
    // stay wrong forever.
    //
    // Cost while it was live: the daily brief read 21 late-night visits where
    // ET says 12. A UTC hour of 23-04 is really ET 19-00, so "after 11pm" was
    // silently counting from 7pm.
    const hour = hourET(v.createdAt);
    if (hour >= 23 || hour <= 4) lateNightCount++;

    // ET, like every other bucket here. `toISOString()` buckets by UTC date,
    // so a 9pm ET Monday visit landed on Tuesday and inflated the day count
    // that divides into avgDailyVisits.
    uniqueDays.add(toDateString(v.createdAt));
  }

  // Top pages
  const topPages = Object.entries(pageCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([page, count]) => ({ page, count }));

  // Blind spots — important pages not visited in 3+ days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const blindSpots: string[] = [];
  for (const p of IMPORTANT_PAGES) {
    const last = lastVisited[p.path];
    if (!last || last < threeDaysAgo) {
      blindSpots.push(p.label);
    }
  }

  // Generate insights
  const insights: string[] = [];

  if (blindSpots.length > 0) {
    const criticalBlind = IMPORTANT_PAGES.filter(p => p.critical && blindSpots.includes(p.label));
    if (criticalBlind.length > 0) {
      insights.push(`BLIND SPOT WARNING: Nour hasn't checked ${criticalBlind.map(p => p.label).join(", ")} in 3+ days. This is a drift signal.`);
    }
  }

  if (lateNightCount > 5) {
    insights.push(`LATE NIGHT PATTERN: ${lateNightCount} visits after 11pm this week. This correlates with overthinking and poor next-day performance.`);
  }

  // Wave 2 (2026-06-03) · the old "/command + /tasks monitoring" insight was
  // dropped here too — /command and /tasks are both retired/redirected routes,
  // so their pageCounts are permanently 0 and the heuristic never fires.
  //
  // Wave 2 (2026-06-03) · the old "/drift + /body avoidance" insight was
  // dropped here: both are now redirected routes (/drift retired; /body
  // folded into /stats?tab=body), so pageCounts for them are permanently 0 and
  // the heuristic would fire false every run. Body is a /stats section now,
  // so "avoiding body" can no longer be inferred from page-visit counts.

  const chatVisits = pageCounts["/chat"] || 0;
  if (chatVisits > 20) {
    insights.push(`High Nick AI usage (${chatVisits} chats this week) — Nour may be using conversation as procrastination.`);
  }

  return {
    topPages,
    blindSpots,
    lateNightUsage: lateNightCount > 3,
    lateNightCount,
    avgDailyVisits: uniqueDays.size > 0 ? Math.round(visits.length / uniqueDays.size) : 0,
    activeDays: uniqueDays.size,
    lastActive: visits[0]?.createdAt.toISOString() || null,
    insights,
  };
}

/**
 * Returns formatted page intelligence for injection into the system prompt.
 */
export async function getPageVisitIntelligence(): Promise<string | null> {
  try {
    const patterns = await analyzePagePatterns();

    if (patterns.topPages.length === 0) return null;

    const lines: string[] = [];
    lines.push("# PAGE VISIT INTELLIGENCE (what Nour is paying attention to)");

    if (patterns.topPages.length > 0) {
      lines.push(`Most visited (7d): ${patterns.topPages.slice(0, 5).map(p => `${p.page}(${p.count})`).join(", ")}`);
    }

    if (patterns.avgDailyVisits > 0) {
      lines.push(`Avg ${patterns.avgDailyVisits} page views/day.`);
    }

    if (patterns.blindSpots.length > 0) {
      lines.push(`BLIND SPOTS (not visited in 3+ days): ${patterns.blindSpots.join(", ")}`);
    }

    if (patterns.insights.length > 0) {
      lines.push("");
      lines.push("## Pattern Insights:");
      for (const insight of patterns.insights) {
        lines.push(`- ${insight}`);
      }
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}
