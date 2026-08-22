/**
 * GET /api/intelligence/briefs/today — owner-only · TODAY's Daily Executive Brief
 *
 * 2026-08-21 · this route was `findFirst({ where: { briefType: "daily" },
 * orderBy: { createdAt: "desc" } })` — the LATEST brief ever, with no date bound
 * at all, behind a route named `/today` feeding a screen that says "today's".
 * That is wrong in both directions and the dangerous one is latent:
 *
 *   · with zero rows (the state on 2026-08-21) it returns null and the screen
 *     shows "No Briefing Generated Today" — accidentally right;
 *   · the moment ONE brief exists it is rendered as the current brief forever,
 *     even if it is weeks old. The `COMPILED:` timestamp is the only tell, in
 *     small mono text. In an app with a five-layer fabrication-defense stack,
 *     a surface that presents stale output as current is the same defect class.
 *
 * Now bounded to the ET day (the shop/operator timezone — root AGENTS.md), and
 * it reports the difference between "no brief TODAY" and "no brief EVER". Those
 * two need completely different operator actions: the first means the scheduled
 * job stopped, the second means it has never once succeeded.
 */
import { prisma } from "@/lib/prisma";
import { startOfDayET, endOfDayET } from "@/lib/utils/datetime";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req) => {
  const now = new Date();

  const todaysBrief = await prisma.briefingLog.findFirst({
    where: {
      briefType: "daily",
      createdAt: { gte: startOfDayET(now), lt: endOfDayET(now) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (todaysBrief) {
    return { status: "success", brief: todaysBrief, isToday: true };
  }

  // No brief today. Report whether one has EVER been produced, so the empty
  // state can name the actual failure instead of a generic prompt.
  const latest = await prisma.briefingLog.findFirst({
    where: { briefType: "daily" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  // `status: "error"` is the house convention for an absent resource in a 200 body
  // (6 sibling routes + the version this replaced). An earlier draft invented a third
  // value, "empty" — semantically nicer, but a vocabulary no other route uses.
  return {
    status: "error",
    brief: null,
    isToday: false,
    lastBriefAt: latest?.createdAt ?? null,
    message: latest
      ? "No brief generated today. The scheduled job has not produced one since the date shown."
      : "No daily brief has ever been generated. The scheduled job has never completed successfully.",
  };
}, { auth: "owner" });
