import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { fireSlotForCurrentHour, checkAndNudgeApprovals } from "@/lib/brain/proactive-pushes";
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

    log.info("proactive_push_cron_done", { push: pushResult, nudge: nudgeResult });

    return {
      push: pushResult,
      nudge: nudgeResult,
    };
  },
);
