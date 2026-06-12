import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysAgo, today } from "@/lib/utils/datetime";
import { auditUpdate } from "@/lib/db/actor";
import { logUpdate } from "@/lib/db/entity-audit";
import { emitDriftFired } from "@/lib/db/brain-bus-emit";
import { recordCoachEvent } from "@/lib/services/coach-events";
export const maxDuration = 60;

/**
 * GET /api/cron/stale-tasks — Flag tasks not touched in 5+ days
 * - Increment driftRisk for stale tasks
 * - Create DriftAlert when driftRisk > 3
 * - Mark overdue ScheduledActions
 * Schedule: 8am daily
 */
export const GET = cronHandler(async () => {
  const fiveDaysAgo = daysAgo(5);
  const todayStr = today();

  // Find active tasks not touched in 5+ days
  // v8.24 · soft-delete retrofit: don't pile drift risk on tasks Nour
  // already deleted but the row still lingers for audit.
  // v10.0.42 — bounded scan. Pre-fix no `take`. After a vacation
  // / hiatus the active backlog could pile to 500+ stale tasks;
  // this then issued N individual prisma.task.update calls in a
  // loop, blowing the 60s function envelope and leaving partial
  // updates with no way to know which tasks landed. 100-row cap
  // per run; the next run picks up the rest naturally since drift-
  // risk only matters incrementally.
  const staleTasks = await prisma.task.findMany({
    where: {
      status: { in: ["DOING", "READY"] },
      deletedAt: null,
      lastTouchedAt: { lt: fiveDaysAgo },
    },
    select: { id: true, title: true, driftRisk: true, missionId: true },
    orderBy: { lastTouchedAt: "asc" },
    take: 100,
  });

  let driftAlertsCreated = 0;

  for (const task of staleTasks) {
    const newDriftRisk = task.driftRisk + 1;

    // v9.1.19 · attach actor (cron will land here as "cron:stale-tasks"
    // via withActor in cronHandler) + entity-audit log so the drift-
    // risk bumps show up in the Task's audit trail.
    await prisma.task.update({
      where: { id: task.id },
      data: { driftRisk: newDriftRisk, ...auditUpdate() },
    });
    void logUpdate(
      "task",
      task.id,
      { driftRisk: task.driftRisk } as Record<string, unknown>,
      { driftRisk: newDriftRisk } as Record<string, unknown>,
      { source: "cron:stale-tasks", reason: "drift risk auto-bump" },
    );

      // Create drift alert when risk exceeds threshold
      if (newDriftRisk > 3 && task.driftRisk <= 3) {
        const severity = newDriftRisk > 5 ? "high" : "medium";
        const priority = severity === "high" ? "P0" : "P1";
        const message = `Task "${task.title}" hasn't been touched in ${5 + newDriftRisk - 1} days. Drift risk: ${newDriftRisk}`;
        const event = await recordCoachEvent({
          kind: "drift-recovery",
          subjectId: `stale_task_${task.id}`,
          priority,
          title: "Stale Task Detection",
          body: message,
          surfaces: ["tasks", "goals", "journal", "brain", "scoreboard", "home"],
        });
        // v10.0.63 · brain-bus producer · emit drift.fired for the
        // durable replay log. Dedupe key in emit handles same-rule-
        // same-day so per-task fires within stale-tasks dedupe at the
        // row level (we only fire when threshold transitions, so this
        // is naturally bounded).
        if (event) {
          void emitDriftFired({
            alertId: event.eventId,
            ruleId: "stale_task",
            ruleName: "Stale Task Detection",
            severity,
            message,
            date: todayStr,
          });
          driftAlertsCreated++;
        }
      }
  }

  // Mark overdue scheduled actions
  const overdueActions = await prisma.scheduledAction.updateMany({
    where: {
      status: "pending",
      scheduledFor: { lt: new Date() },
    },
    data: { status: "overdue" },
  });

  return {
    staleTasks: staleTasks.length,
    driftAlertsCreated,
    overdueActions: overdueActions.count,
  };
});
