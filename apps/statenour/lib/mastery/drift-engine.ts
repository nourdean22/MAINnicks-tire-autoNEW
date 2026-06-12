import { prisma } from "@/lib/prisma";
import { DRIFT_RULES, type DriftContext } from "./config";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentDailyHabits } from "@/lib/brain/legacy-shims";
import { emitDriftFired } from "@/lib/db/brain-bus-emit";
import { recordCoachEvent, ackCoachEvent } from "@/lib/services/coach-events";

export type RegressionSeverity = "info" | "warn" | "critical";

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
  //      the alert within the last 7 days.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const recentEvents = await prisma.brainMemory.findMany({
    where: {
      category: "coach_event",
      key: { startsWith: "coach:drift-recovery:" },
    },
    select: { key: true, createdAt: true, updatedAt: true, metadata: true },
  });

  const suppressedRuleIds = new Set<string>();
  const nowStr = now;
  for (const event of recentEvents) {
    const ruleId = event.key.replace("coach:drift-recovery:", "");
    const meta = (event.metadata ?? {}) as Record<string, unknown>;

    // Check if updated today
    const eventDate = new Date(event.updatedAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const firedToday = eventDate === nowStr;

    // Check if acked/resolved within the last 7 days
    const ackedAtStr = meta.ackedAt as string | undefined;
    let ackedRecently = false;
    if (ackedAtStr) {
      const ackedTime = Date.parse(ackedAtStr);
      if (!Number.isNaN(ackedTime) && ackedTime >= sevenDaysAgo.getTime()) {
        ackedRecently = true;
      }
    }

    if (firedToday || ackedRecently) {
      suppressedRuleIds.add(ruleId);
    }
  }

  const fired: Array<{ rule_id: string; rule_name: string; severity: string; message: string }> = [];

  const severityMap: Record<string, "P0" | "P1" | "P2"> = {
    critical: "P0",
    alert: "P1",
    warning: "P2",
  };

  for (const rule of DRIFT_RULES) {
    if (suppressedRuleIds.has(rule.id)) continue;

    try {
      if (rule.check(ctx)) {
        const priority = severityMap[rule.severity] ?? "P2";
        const event = await recordCoachEvent({
          kind: "drift-recovery",
          subjectId: rule.id,
          priority,
          title: rule.name,
          body: rule.message,
          surfaces: ["tasks", "goals", "journal", "brain", "scoreboard", "home"],
        });

        if (event) {
          // v10.0.63 · brain-bus producer · emit drift.fired event for
          // the durable replay log. Best-effort — failure is logged but
          // never blocks the primary alert write above.
          void emitDriftFired({
            alertId: event.eventId,
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: rule.message,
            date: now,
          });
        }

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
  const events = await prisma.brainMemory.findMany({
    where: {
      category: "coach_event",
      key: { startsWith: "coach:drift-recovery:" },
    },
    orderBy: { updatedAt: "desc" },
    select: { key: true, content: true, metadata: true, createdAt: true, updatedAt: true },
  });

  const unresolved = events.filter((e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    return !meta.ackedAt;
  });

  return unresolved.map((e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const ruleId = e.key.replace("coach:drift-recovery:", "");
    return {
      id: e.key,
      date: new Date(e.updatedAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
      ruleId,
      ruleName: e.content,
      severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
      message: typeof meta.body === "string" ? meta.body : "",
      resolved: false,
      acknowledged: false,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  });
}

export async function acknowledgeAlert(id: string | number) {
  const idStr = String(id);
  const key = idStr.startsWith("coach:") ? idStr : `coach:drift-recovery:${idStr}`;
  await ackCoachEvent(key);
}

export async function resolveAlert(id: string | number) {
  const idStr = String(id);
  const key = idStr.startsWith("coach:") ? idStr : `coach:drift-recovery:${idStr}`;
  await ackCoachEvent(key);
}
