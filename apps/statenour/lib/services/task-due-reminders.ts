/**
 * task-due-reminders — emitter half of the due-time reminder lane
 * (Execution Deck, 2026-09-01; consumer: lib/inngest/functions/
 * task-due-reminder.ts).
 *
 * Contract: on ANY due-date change, send `task/due.rescheduled` first —
 * it cancels every sleeper armed for this task — then, if a future due
 * date exists, arm one fresh `task/due.scheduled` sleeper. Callers fire
 * this and forget it: a reminder must never block or fail a mutation.
 */
import { getInngest } from "@/lib/inngest/client";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("task-due-reminders");

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

export type DueReminderPlan =
  | { action: "none" }
  | { action: "cancel" }
  | { action: "reschedule"; dueAt: string };

/**
 * Pure decision core — pinned by tests/lib/services/task-due-reminders.test.ts.
 * cancel-first is the contract: `reschedule` implies the cancel event too.
 */
export function dueReminderPlan(
  prevDue: Date | string | null | undefined,
  nextDue: Date | string | null | undefined,
  now: Date = new Date(),
): DueReminderPlan {
  const prev = prevDue ? new Date(prevDue) : null;
  const next = nextDue ? new Date(nextDue) : null;
  if (sameInstant(prev, next)) return { action: "none" };
  if (next && next.getTime() > now.getTime()) {
    return { action: "reschedule", dueAt: next.toISOString() };
  }
  // Cleared, or moved into the past — kill the sleeper, arm nothing.
  return { action: "cancel" };
}

export async function syncDueReminder(
  taskId: string,
  prevDue: Date | string | null | undefined,
  nextDue: Date | string | null | undefined,
): Promise<void> {
  // Unit tests mock prisma, not the Inngest transport — an event POST
  // from inside a vitest worker is noise, never coverage (the decision
  // core above is what the tests pin).
  if (process.env.VITEST) return;

  const plan = dueReminderPlan(prevDue, nextDue);
  if (plan.action === "none") return;

  try {
    const inngest = getInngest();
    await inngest.send({ name: "task/due.rescheduled", data: { taskId } });
    if (plan.action === "reschedule") {
      await inngest.send({
        name: "task/due.scheduled",
        data: { taskId, dueAt: plan.dueAt },
      });
    }
  } catch (err) {
    // Fire-and-forget by contract — log, never throw into the mutation.
    log.warn("due_reminder_sync_failed", { taskId, err });
  }
}
