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

interface PagePattern {
  topPages: Array<{ page: string; count: number }>;
  blindSpots: string[];
  lateNightUsage: boolean;
  avgDailyVisits: number;
  lastActive: string | null;
  insights: string[];
}

const IMPORTANT_PAGES = [
  { path: "/missions", label: "Missions", critical: true },
  { path: "/stats", label: "Stats", critical: false },
  { path: "/business", label: "Business", critical: false },
  { path: "/chat", label: "Nick AI", critical: false },
  { path: "/strategy", label: "Strategy", critical: false },
];

/**
 * Analyze page visits from the last 7 days and generate intelligence.
 */
async function analyzePagePatterns(): Promise<PagePattern> {
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

    const payload = v.payload as any;
    const hour = payload?.hour ?? v.createdAt.getHours();
    if (hour >= 23 || hour <= 4) lateNightCount++;

    uniqueDays.add(v.createdAt.toISOString().slice(0, 10));
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

  const commandVisits = pageCounts["/command"] || 0;
  const taskVisits = pageCounts["/tasks"] || 0;
  if (commandVisits > 0 && taskVisits === 0) {
    insights.push("Nour checks Command but never opens Tasks — he's monitoring but not executing.");
  }

  // Wave 2 (2026-06-03) · the old "/drift + /body avoidance" insight was
  // dropped here: both are now redirected routes (/drift retired; /body
  // folded into /stats#body), so pageCounts for them are permanently 0 and
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
    avgDailyVisits: uniqueDays.size > 0 ? Math.round(visits.length / uniqueDays.size) : 0,
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
