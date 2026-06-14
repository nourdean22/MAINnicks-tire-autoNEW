import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysAgo, today } from "@/lib/utils/datetime";
export const maxDuration = 60;

/**
 * GET /api/cron/daily-report — Aggregate daily activity summary
 * Schedule: 11pm daily
 */
export const GET = cronHandler(async () => {
  const todayStr = today();
  // v10.0.34 — compute startOfDay as midnight ET, NOT midnight UTC.
  // Pre-fix: `daysAgo(0)` returns the UTC `new Date()`, then
  // `.setHours(0,0,0,0)` zeroes UTC hours. At 11pm ET (when this
  // cron runs) UTC is 3am the NEXT day, so startOfDay landed at
  // UTC midnight of next-day = ~8pm ET TODAY. Tasks completed
  // earlier in the day were dropped from the report.
  // todayStr is already ET-anchored (today() uses America/New_York),
  // so we just attach midnight + the proper offset.
  const isDST = (() => {
    // Best-effort DST check — use EDT (-04:00) when the offset
    // matches; otherwise EST (-05:00). For Cleveland anything else
    // means a DST transition day, where either offset is acceptable
    // for an end-of-day report (1h slop is fine).
    const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset();
    const now = new Date().getTimezoneOffset();
    return now < Math.max(jan, jul);
  })();
  const offset = isDST ? "-04:00" : "-05:00";
  const startOfDay = new Date(`${todayStr}T00:00:00${offset}`);

  const [
    tasksCompleted,
    tasksCreated,
    leadsCreated,
    leadsConverted,
    jobsLogged,
    deviceEvents,
    aiGenerations,
    errors,
    driftAlerts,
  ] = await Promise.all([
    prisma.task.count({ where: { status: "DONE", updatedAt: { gte: startOfDay } } }),
    prisma.task.count({ where: { createdAt: { gte: startOfDay } } }),
    Promise.resolve(0),
    Promise.resolve(0),
    Promise.resolve(0),
    prisma.deviceEvent.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: startOfDay } },
      _count: { id: true },
      _sum: { costCents: true, promptTokens: true, outputTokens: true },
    }),
    prisma.errorLog.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.brainMemory.count({
      where: {
        category: "coach_event",
        key: { startsWith: "coach:drift-recovery:" },
        createdAt: { gte: startOfDay },
        deletedAt: null,
      },
    }),
  ]);

  // Store as empire snapshot
  const snapshot = await prisma.dailyEmpireSnapshot.upsert({
    where: { snapshotDate: new Date(todayStr) },
    create: {
      snapshotDate: new Date(todayStr),
      moneyScore: Math.min(10, jobsLogged * 2 + leadsConverted * 3),
      healthScore: 5, // Will be enriched by daily score data
      personalScore: Math.min(10, tasksCompleted),
      moneyDetail: { jobsLogged, leadsCreated, leadsConverted },
      healthDetail: { deviceEvents, errors },
      personalDetail: { tasksCompleted, tasksCreated, driftAlerts },
    },
    update: {
      moneyScore: Math.min(10, jobsLogged * 2 + leadsConverted * 3),
      moneyDetail: { jobsLogged, leadsCreated, leadsConverted },
      healthDetail: { deviceEvents, errors },
      personalDetail: { tasksCompleted, tasksCreated, driftAlerts },
    },
  });

  return {
    date: todayStr,
    tasks: { completed: tasksCompleted, created: tasksCreated },
    leads: { created: leadsCreated, converted: leadsConverted },
    jobs: jobsLogged,
    devices: { events: deviceEvents },
    ai: {
      generations: aiGenerations._count.id,
      costCents: aiGenerations._sum.costCents ?? 0,
      tokens: {
        prompt: aiGenerations._sum.promptTokens ?? 0,
        output: aiGenerations._sum.outputTokens ?? 0,
      },
    },
    errors,
    driftAlerts,
    snapshotId: snapshot.id,
  };
});
