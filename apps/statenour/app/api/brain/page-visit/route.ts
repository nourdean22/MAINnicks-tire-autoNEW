import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hourET } from "@/lib/utils/datetime";

import { requireSession } from "@/lib/auth-guard";
import { recordPageVisit } from "@/lib/services/brain-domain";
export const dynamic = "force-dynamic";

/**
 * Track page visits for brain pattern detection.
 * Lightweight — fires on every page load.
 * The brain uses this to detect:
 * - Which pages Nour visits most (priorities)
 * - Which pages Nour avoids (blind spots)
 * - Time patterns (morning = command, late night = drift?)
 * - Frequency patterns (hasn't checked drift in 3 days)
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline auditEvent write moved to
 * `lib/services/brain-domain.recordPageVisit` so this route AND the new
 * `trpc.brain.pageVisit` procedure call the same function · drift
 * impossible.
 */
export async function POST(req: Request) {
  await requireSession(req);
  const body = await req.json().catch(() => ({}));
  const { page, referrer } = body as { page?: unknown; referrer?: unknown };

  if (!page || typeof page !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = await recordPageVisit({
    page,
    referrer: typeof referrer === "string" ? referrer : null,
  });
  return NextResponse.json(result);
}

/**
 * GET: Return page visit patterns for the brain to analyze.
 */
export async function GET(req: Request) {
  // v10.0.183 · auth was on POST but missing from GET. Page-visit
  // history (URLs visited, timestamps) is private operator data.
  await requireSession(req);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const visits = await prisma.auditEvent.findMany({
    where: {
      eventType: "page_visit",
      createdAt: { gte: sevenDaysAgo },
    },
    select: { detail: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  }).catch(() => []);

  // Aggregate by page
  const pageCounts: Record<string, number> = {};
  const lastVisited: Record<string, string> = {};
  const hourDistribution: Record<number, number> = {};

  for (const v of visits) {
    const page = v.detail || "unknown";
    pageCounts[page] = (pageCounts[page] || 0) + 1;
    if (!lastVisited[page]) lastVisited[page] = v.createdAt.toISOString();
    // Derived from the timestamp, never from the stored `payload.hour`: 691 of
    // 719 rows measured 2026-08-26 carry a UTC hour against an ET timestamp
    // (a clean +4h). Cause: `1202bdd0f` (merged 2026-08-25T15:17:30Z) changed
    // the writer off `new Date().getHours()`, which is the UTC hour on a
    // Railway container. Rows written before that deploy stay wrong forever.
    // `createdAt` is the row's own authority.
    {
      const h = hourET(v.createdAt);
      hourDistribution[h] = (hourDistribution[h] || 0) + 1;
    }
  }

  // Detect blind spots (important pages not visited in 3+ days).
  // v10 Ultron cleanup: /command and /drift retired — they redirect to /.
  // Wave 2 (2026-06-03): /body folded into /stats#body (a section, not a page),
  // so it's dropped here — its visits now register as /stats.
  // Updated list reflects the current live page set.
  // "/business" dropped 2026-09-02 · page deleted on operator verdict (plan R7).
  const importantPages = ["/", "/missions", "/stats", "/chat", "/journal"];
  const blindSpots: string[] = [];
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

  for (const page of importantPages) {
    const last = lastVisited[page];
    if (!last || new Date(last).getTime() < threeDaysAgo) {
      blindSpots.push(page);
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      totalVisits: visits.length,
      pageCounts,
      lastVisited,
      hourDistribution,
      blindSpots,
      topPages: Object.entries(pageCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([page, count]) => ({ page, count })),
    },
  });
}
