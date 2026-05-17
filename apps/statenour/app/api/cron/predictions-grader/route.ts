/**
 * GET /api/cron/predictions-grader · v10.0.91 · 2026-05-02.
 *
 * Daily auto-grader for past-due predictions. Folded into
 * mega-evening (single-fire daily). Closes the Ghost Nour
 * calibration gap by attempting to auto-derive grades from
 * subsequent memory evidence.
 */

import { cronHandler } from "@/lib/utils/http";
import { runPredictionsGrader } from "@/lib/brain/predictions-grader";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  return await runPredictionsGrader();
});
