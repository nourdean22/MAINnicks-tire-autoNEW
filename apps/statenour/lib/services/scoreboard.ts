import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";
import { serializeForJson } from "@/lib/utils/serialize";
// ET-correct day boundaries. The prior local `new Date(y,m,d)` floored to
// midnight in the SERVER zone (UTC). See lib/utils/datetime.ts.
import {
  startOfDayET as startOfLocalDay,
  endOfDayET as endOfLocalDay,
} from "@/lib/utils/datetime";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sumExpectedValue(entries: Array<{ expectedValue: number | null }>) {
  return entries.reduce((sum, entry) => sum + (entry.expectedValue || 0), 0);
}

function getDirection(current: number, previous?: number) {
  if (previous == null) {
    return "flat";
  }

  const delta = current - previous;
  if (delta >= 4) {
    return "up";
  }
  if (delta <= -4) {
    return "down";
  }
  return "flat";
}

function buildRecommendation(input: {
  moneyScore: number;
  healthScore: number;
  personalScore: number;
  moneyDetail: Record<string, unknown>;
  healthDetail: Record<string, unknown>;
  personalDetail: Record<string, unknown>;
}) {
  const weakest = [
    { lane: "money", score: input.moneyScore },
    { lane: "health", score: input.healthScore },
    { lane: "personal", score: input.personalScore }
  ].sort((left, right) => left.score - right.score)[0];

  if (weakest.lane === "money") {
    const dueToday = Number(input.moneyDetail.closedCallbacks || 0);
    return dueToday > 0
      ? "Keep the callback lane hot until the recovery stack is cleared."
      : "Open Recovery first and close the most valuable callback before admin.";
  }

  if (weakest.lane === "health") {
    return Number(input.healthDetail.deepWorkBlocks || 0) < 2
      ? "Protect one deep-work block and one recovery habit before the day fragments."
      : "Keep drift low and preserve the current body rhythm before chasing more output.";
  }

  return input.personalScore < 55
    ? "Close one command, triage the loose input, and lock tomorrow's first move."
    : "Keep the personal lane clean so the machine stays sharp tomorrow.";
}

export async function getDailyEmpireScoreboard(date = new Date()) {
  const snapshotDate = startOfLocalDay(date);

  if (isDemoMode) {
    return {
      snapshotDate: snapshotDate.toISOString(),
      money: { score: 48, label: "Money", detail: { recoveryTouches: 0, bookedCount: 0, estimatedValue: 0 } },
      health: { score: 52, label: "Health", detail: { note: "Log the day to track sleep, drift, and deep work." } },
      personal: { score: 50, label: "Personal", detail: { note: "Lock one mission and one family/personal move." } },
      trend: []
    };
  }

  const dayStart = snapshotDate;
  const dayEnd = endOfLocalDay(date);

  // v10.0.59 · Wave A part 2 · leads + jobs sourced via legacy-shims
  // (currently empty; no nickstire bridge query exposes ranged lists
  // yet). Scoreboard consumers iterate `leads.length` + `jobs.length`
  // for top-level counters; with empty shop-shim returns those
  // counters show 0 — same as pre-fix BUT the canary at /api/cron/
  // data-source-health now tracks the empty-streak so we'll see
  // when bridge wires up.
  const [executionState, personalLog, recoveryLogs, leads, jobs, commandResolutions, captureItems] = await Promise.all([
    prisma.dailyExecutionState.findUnique({
      where: { stateDate: dayStart }
    }),
    prisma.personalDailyLog.findUnique({
      where: { logDate: dayStart }
    }),
    prisma.recoveryActionLog.findMany({
      where: {
        createdAt: {
          gte: dayStart,
          lt: dayEnd
        }
      }
    }),
    (async () => {
      const { recentShopLeads } = await import("@/lib/brain/legacy-shims");
      return recentShopLeads(1);
    })(),
    (async () => {
      const { recentShopJobs } = await import("@/lib/brain/legacy-shims");
      return recentShopJobs(1);
    })(),
    prisma.commandResolution.findMany({
      where: {
        createdAt: {
          gte: dayStart,
          lt: dayEnd
        }
      }
    }),
    prisma.captureInboxItem.findMany({
      where: {
        capturedAt: {
          gte: dayStart,
          lt: dayEnd
        }
      }
    })
  ]);

  const recoveryTouches = recoveryLogs.length;
  const bookedCount = recoveryLogs.filter((log) => ["booked", "done"].includes(log.action)).length;
  // v10.0.59 · LegacyShopLead doesn't surface lastContactAt or
  // bookingValue (the bridge query that returns those isn't exposed
  // yet). Cast through unknown so the existing math compiles; both
  // counters degrade to 0 cleanly when leads is empty.
  const typedLeads = leads as unknown as Array<{
    lastContactAt: Date | null;
    bookingValue: number | null;
  }>;
  const leadsContacted = typedLeads.filter((lead) => lead.lastContactAt && lead.lastContactAt >= dayStart && lead.lastContactAt < dayEnd).length;
  const closedCallbacks = recoveryLogs.filter((log) => ["done", "booked", "not_interested"].includes(log.action)).length;
  const bookedRevenue = jobs.reduce((sum, job) => sum + Number(job.totalRevenue), 0);
  const leadBookingValue = typedLeads.reduce((sum, lead) => sum + (lead.bookingValue || 0), 0);
  const recoveryValue = sumExpectedValue(recoveryLogs);
  const estimatedValue = Math.round(bookedRevenue + leadBookingValue + recoveryValue);
  const moneyScore = clampScore(recoveryTouches * 8 + leadsContacted * 10 + bookedCount * 16 + closedCallbacks * 8 + (estimatedValue > 0 ? 12 : 0));

  const healthScore = clampScore(
    (personalLog?.dailyScore || 0) * 0.7 +
      (personalLog?.workoutCompleted ? 14 : 0) +
      Math.min((personalLog?.deepWorkBlocks || 0) * 8, 24) -
      Math.min((personalLog?.driftIncidents || 0) * 8, 24)
  );

  const doneCommands = commandResolutions.filter((item) => item.resolutionType === "DONE").length;
  const triagedCaptures = captureItems.filter((item) => item.triageStatus !== "NEW").length;
  const personalScore = clampScore(
    (executionState?.missionMoved ? 28 : 0) +
      (executionState?.tomorrowFirstMove ? 18 : 0) +
      (personalLog?.socialFamilyAction ? 22 : 0) +
      Math.min(doneCommands * 8, 24) +
      Math.min(triagedCaptures * 4, 12)
  );

  const moneyDetail = {
    recoveryTouches,
    leadsContacted,
    bookedCount,
    closedCallbacks,
    estimatedValue
  };
  const healthDetail = {
    sleepHours: personalLog?.sleepHours ? Number(personalLog.sleepHours) : null,
    workoutCompleted: personalLog?.workoutCompleted || false,
    deepWorkBlocks: personalLog?.deepWorkBlocks || 0,
    driftIncidents: personalLog?.driftIncidents || 0,
    dailyScore: personalLog?.dailyScore || null
  };
  const personalDetail = {
    missionMoved: executionState?.missionMoved || false,
    tomorrowFirstMove: executionState?.tomorrowFirstMove || null,
    socialFamilyAction: personalLog?.socialFamilyAction || false,
    doneCommands,
    triagedCaptures
  };

  const snapshot = await prisma.dailyEmpireSnapshot.upsert({
    where: { snapshotDate: dayStart },
    update: {
      moneyScore,
      healthScore,
      personalScore,
      moneyDetail,
      healthDetail,
      personalDetail
    },
    create: {
      snapshotDate: dayStart,
      moneyScore,
      healthScore,
      personalScore,
      moneyDetail,
      healthDetail,
      personalDetail
    }
  });

  const recentSnapshots = await prisma.dailyEmpireSnapshot.findMany({
    orderBy: { snapshotDate: "desc" },
    take: 7
  });
  const chronologicalTrend = recentSnapshots.reverse();
  const previous = chronologicalTrend.length > 1 ? chronologicalTrend[chronologicalTrend.length - 2] : undefined;
  const trendMeta = {
    moneyDirection: getDirection(snapshot.moneyScore, previous?.moneyScore),
    healthDirection: getDirection(snapshot.healthScore, previous?.healthScore),
    personalDirection: getDirection(snapshot.personalScore, previous?.personalScore),
    recommendation: buildRecommendation({
      moneyScore: snapshot.moneyScore,
      healthScore: snapshot.healthScore,
      personalScore: snapshot.personalScore,
      moneyDetail,
      healthDetail,
      personalDetail
    })
  };

  return serializeForJson({
    snapshotDate: snapshot.snapshotDate,
    money: {
      score: snapshot.moneyScore,
      label: "Money",
      detail: snapshot.moneyDetail
    },
    health: {
      score: snapshot.healthScore,
      label: "Health",
      detail: snapshot.healthDetail
    },
    personal: {
      score: snapshot.personalScore,
      label: "Personal",
      detail: snapshot.personalDetail
    },
    trend: chronologicalTrend
      .map((item) => ({
        date: item.snapshotDate,
        moneyScore: item.moneyScore,
        healthScore: item.healthScore,
        personalScore: item.personalScore
      })),
    trendMeta
  });
}
