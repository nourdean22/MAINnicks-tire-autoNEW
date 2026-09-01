/**
 * task-due-reminder — due-time push via Inngest sleepUntil (Execution
 * Deck §P1.5, 2026-09-01).
 *
 * WHY SERVER-SIDE: installed iOS PWAs have NO Background Sync of any
 * kind (WebKit never shipped it), so a service-worker timer cannot fire
 * a reminder — a durable server sleeper delivering web push is the only
 * reliable path. sleepUntil holds no compute while it waits (up to a
 * year), and cancelOn kills the sleeper the moment the task's due date
 * changes or clears (the emitter sends `task/due.rescheduled` before
 * every new schedule).
 *
 * Honesty guard: after waking, the task is RE-READ — completed, deleted,
 * snoozed-away or re-dated tasks get no push. A reminder that fires on
 * stale state is alarm-fatigue fuel (the deck's alert budget applies).
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";

const inngest = getInngest();

export const taskDueReminder = inngest.createFunction(
  {
    id: "task-due-reminder",
    name: "Task due-time reminder · web push",
    retries: 2,
    triggers: [{ event: "task/due.scheduled" }],
    cancelOn: [
      // Any reschedule/clear for the SAME task cancels this sleeper.
      { event: "task/due.rescheduled", if: "event.data.taskId == async.data.taskId" },
    ],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const { taskId, dueAt } = event.data as { taskId: string; dueAt: string };
    const due = new Date(dueAt);
    if (Number.isNaN(due.getTime())) return { skipped: "bad dueAt" };

    await step.sleepUntil("until-due", due);

    return await step.run("notify-if-still-open", async () => {
      const { prisma } = await import("@/lib/prisma");
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, title: true, status: true, dueDate: true, deletedAt: true },
      });

      if (!task || task.deletedAt) return { skipped: "gone" };
      if (!["INBOX", "READY", "DOING"].includes(task.status)) {
        return { skipped: `status ${task.status}` };
      }
      // Belt + suspenders beside cancelOn: if the stored due date moved
      // more than a minute from what this sleeper was armed with, a newer
      // sleeper owns the reminder.
      if (!task.dueDate || Math.abs(task.dueDate.getTime() - due.getTime()) > 60_000) {
        return { skipped: "due date moved" };
      }

      const { sendPush } = await import("@/lib/notifications/push");
      const res = await sendPush({
        title: "Due now",
        body: task.title,
        level: "high",
        url: "/missions",
        tag: `task-due-${task.id}`,
      });
      return { sent: res.sent, failed: res.failed };
    });
  },
);
