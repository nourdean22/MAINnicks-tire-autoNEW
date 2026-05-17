/**
 * GET /api/cron/self-critique · v10.0.92 · 2026-05-02.
 *
 * Nightly self-critique pass over recent assistant chat messages.
 * Scores each on 4-axis (specificity, cliche, antiNour, length),
 * flags bottom 10% as `reply_to_improve` BrainMemory rows for
 * later review on /chat sidebar.
 *
 * Folded into mega-evening (single-fire daily).
 */

import { cronHandler } from "@/lib/utils/http";
import { runSelfCritique } from "@/lib/ai/self-critique";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  return await runSelfCritique();
});
