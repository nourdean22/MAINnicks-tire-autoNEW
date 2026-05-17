/**
 * GET /api/cron/proactive-push — v10.0.529.106 · Wave 66.
 *
 * Hour-aware dispatcher · single endpoint serves the 3 daily push
 * slots (morning/afternoon/evening). The cron manifest schedules
 * this every 3 hours during waking hours · the function routes
 * based on current ET hour and fires the right slot's payload.
 *
 * Idempotent per slot per day via BrainMemory marker · multiple
 * fires of the same slot on the same day are no-ops.
 */

import { cronHandler } from "@/lib/utils/http";
import { fireSlotForCurrentHour } from "@/lib/brain/proactive-pushes";

export const GET = cronHandler(async () => {
  const result = await fireSlotForCurrentHour();
  return result;
});
