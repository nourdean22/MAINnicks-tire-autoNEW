import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

// GET: Return latest system state for local PowerShell pull sync
export const GET = apiHandler(async () => {
  // v10.0.60 · Wave A part 3 · score + habits via legacy-shims
  // (DailyScore + HabitLog retired). Local PowerShell agent's pull
  // sync now sees real engagement signal instead of always-null.
  const { recentScoreSnapshots, recentDailyHabits } = await import(
    "@/lib/brain/legacy-shims"
  );
  const [
    latestScoreArr,
    habits,
    driftAlerts,
    openLoops,
    commitments,
  ] = await Promise.all([
    recentScoreSnapshots(1),
    recentDailyHabits(1),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          deletedAt: null,
        },
        select: { metadata: true },
      })
      .then((rows) =>
        rows.filter((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return !meta.ackedAt;
        })
      )
      .catch(() => []),
    // Apr 18: OpenLoop retired → active Task queue.
    prisma.task.findMany({
      where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
      orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
      take: 20,
    }),
    prisma.commitment.findMany({
      where: { status: "active", deletedAt: null },
      take: 20,
    }),
  ]);

  const latestScore = latestScoreArr[0] ?? null;
  const completed = habits.filter((h) => h.completed).length;

  return {
    score: latestScore ? {
      date: latestScore.date,
      overall: latestScore.overallScore,
      energy: latestScore.energyLevel,
      focus: latestScore.focusQuality,
    } : null,
    habits: { completed, total: habits.length },
    drift_alerts: driftAlerts.length,
    active_tasks: openLoops.length,
    commitments: commitments.length,
    pulled_at: new Date().toISOString(),
  };
}, { auth: "sync" });
