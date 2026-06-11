import { cronHandler } from "@/lib/utils/http";
import { fireSlotForCurrentHour, checkAndNudgeApprovals } from "@/lib/brain/proactive-pushes";

export const maxDuration = 60;

/**
 * GET /api/cron/proactive-push
 * Runs hourly to fire slot-based Telegram micro-pushes
 * and nudge pending approvals if any exist.
 */
export const GET = cronHandler(async () => {
  const [pushResult, nudgeResult] = await Promise.all([
    fireSlotForCurrentHour(),
    checkAndNudgeApprovals(),
  ]);

  return {
    push: pushResult,
    nudge: nudgeResult,
  };
});
