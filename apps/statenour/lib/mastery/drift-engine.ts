import { prisma } from "@/lib/prisma";
import { DRIFT_RULES, type DriftContext } from "./config";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentDailyHabits } from "@/lib/brain/legacy-shims";
import { emitDriftFired } from "@/lib/db/brain-bus-emit";

export async function runDriftScan(): Promise<Array<{ rule_id: string; rule_name: string; severity: string; message: string }>> {
  const now = today();

  // v10.0.59 · Wave A part 2 · DriftContext sourced from legacy-shims
  // (DailyScore + HabitLog retired Apr 19). Drift rules read fields
  // like `workout_done`, `overall_score`, `habit_key`, etc. — those
  // map to identity_snapshot JSON fields + DAILY-task synthesis.
  // sleepTime + adderallTaken aren't surfaced through identity_snapshot
  // (that signal lives in BodyTracking), so we leave those null/0.
  // DriftContext.recentScores expects fully-typed numeric/string
  // fields (no nulls). Coalesce shim's nullables to 0/empty so the
  // shape matches; drift rules already gracefully handle 0/empty
  // (e.g. sleep_after_midnight_3d returns false on empty sleep_time).
  const recentScoresRaw = await recentScoreSnapshots(14);
  const recentScores: DriftContext["recentScores"] = recentScoresRaw.map((r) => ({
    date: r.date,
    workout_done: r.workoutDone ? 1 : 0,
    journal_done: r.journalDone ? 1 : 0,
    focus_quality: r.focusQuality ?? 0,
    sleep_time: "", // not on identity_snapshot — empty string per DriftContext shape
    adderall_taken: 0, // not on identity_snapshot
    overall_score: r.overallScore ?? 0,
  }));

  const recentHabitsRaw = await recentDailyHabits(14);
  const recentHabits = recentHabitsRaw.map((r) => ({
    date: r.date,
    habit_key: r.habitKey,
    completed: r.completed ? 1 : 0,
  })) as DriftContext["recentHabits"];

  // Last score = most recent identity_snapshot row (most recent first
  // in recentScoresRaw). When empty, no score logged in the window.
  const lastScore: DriftContext["lastScore"] = recentScoresRaw[0]
    ? { date: recentScoresRaw[0].date }
    : null;

  // Apr 18: OpenLoop retired → Task create-rate is the tool-shopping
  // signal. Variable name kept stable so DriftContext + drift rules
  // that reference openLoopsCreatedLast7d don't need refactoring.
  const openLoopsCreatedLast7d = await prisma.task.count({
    where: { createdAt: { gte: daysAgo(7) } },
  });

  const weightLast30dRaw = await prisma.bodyTracking.findMany({
    where: { date: { gte: toDateString(daysAgo(30)) } },
    orderBy: { date: "desc" },
    select: { date: true, weight: true },
  });
  const weightLast30d = weightLast30dRaw.map((r) => ({
    date: r.date,
    weight: r.weight,
  })) as DriftContext["weightLast30d"];

  const ctx: DriftContext = { recentScores, recentHabits, lastScore, openLoopsCreatedLast7d, weightLast30d };

  // Cooldown suppression — two cases to avoid:
  //   1. SAME-DAY re-fire: rule already fired today
  //   2. DISMISSED-RECENT re-fire: Nour dismissed/resolved/acknowledged
  //      the alert within the last 7 days. Without this, every day the
  //      rule keeps firing fresh rows that the user already said they
  //      saw — exactly the "keep coming back even when cleared" issue
  //      the notification bell was surfacing.
  //
  // Any rule whose condition genuinely persists will re-surface naturally
  // on day 8. Anything that clears in between gets a clean slate.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const recentAlerts = await prisma.driftAlert.findMany({
    where: {
      OR: [
        { date: now },
        {
          AND: [
            { createdAt: { gte: sevenDaysAgo } },
            { OR: [{ resolved: true }, { acknowledged: true }] },
          ],
        },
      ],
    },
    select: { ruleId: true },
  });
  const suppressedRuleIds = new Set(recentAlerts.map((a) => a.ruleId));

  const fired: Array<{ rule_id: string; rule_name: string; severity: string; message: string }> = [];

  for (const rule of DRIFT_RULES) {
    if (suppressedRuleIds.has(rule.id)) continue;

    try {
      if (rule.check(ctx)) {
        const alert = await prisma.driftAlert.create({
          data: {
            date: now,
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: rule.message,
          },
          select: { id: true },
        });

        // v10.0.63 · brain-bus producer · emit drift.fired event for
        // the durable replay log. Best-effort — failure is logged but
        // never blocks the primary alert write above.
        void emitDriftFired({
          alertId: alert.id,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: rule.message,
          date: now,
        });

        fired.push({
          rule_id: rule.id,
          rule_name: rule.name,
          severity: rule.severity,
          message: rule.message,
        });
      }
    } catch {
      // Skip rules that fail to evaluate
    }
  }

  return fired;
}

export async function getUnresolvedAlerts() {
  return prisma.driftAlert.findMany({
    where: { resolved: false },
    orderBy: [
      { severity: "asc" },
      { date: "desc" },
    ],
  });
}

export async function acknowledgeAlert(id: number) {
  await prisma.driftAlert.update({
    where: { id },
    data: { acknowledged: true },
  });
}

export async function resolveAlert(id: number) {
  await prisma.driftAlert.update({
    where: { id },
    data: { resolved: true, resolvedDate: today() },
  });
}
