import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { fireSlotForCurrentHour, checkAndNudgeApprovals, fireDueReminders } from "@/lib/brain/proactive-pushes";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/proactive-push");
const inngest = getInngest();

export const proactivePushCron = inngest.createFunction(
  {
    id: "proactive-push-cron",
    name: "Proactive Telegram pushes & governance nudges",
    retries: 2,
    triggers: [{ cron: "0 * * * *" }], // runs hourly
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const pushResult = await step.run("fire-push", async () => {
      return await fireSlotForCurrentHour();
    });

    const nudgeResult = await step.run("check-nudges", async () => {
      return await checkAndNudgeApprovals();
    });

    // AG-41 · /remind due-check. Hourly so "in 2h" fires within the
    // hour; the daily task-resurface sweep stays as backstop.
    const reminderResult = await step.run("fire-due-reminders", async () => {
      return await fireDueReminders();
    });

    log.info("proactive_push_cron_done", { push: pushResult, nudge: nudgeResult, reminders: reminderResult });

    // Both approval counts unreadable = the database is failing, and the nudge step returned (so the
    // reminders step above still ran) instead of throwing. Fail the run HERE so onInngestFailure and the
    // cron log carry it; a green run would hide a day-long outage behind log.info.
    if ("reason" in nudgeResult && nudgeResult.reason === "approval_count_unreadable") {
      throw new Error("approvals nudge could not read either approval count (approval_count_unreadable)");
    }

    return {
      push: pushResult,
      nudge: nudgeResult,
      reminders: reminderResult,
    };
  },
);
