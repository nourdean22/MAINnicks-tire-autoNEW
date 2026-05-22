/**
 * POST /api/ai/track-story
 *
 * Apr 27 — TRACK page footer story. Takes a snapshot of the week's
 * counters and returns a 1-paragraph summary in Nick's voice. Hit by
 * KommandoTrack on first load + the regen button.
 *
 * actions-surface REST→tRPC slice (2026-05-22) · the narration logic
 * moved to the shared `lib/services/ai-track-story.runTrackStory`
 * service · this route AND the new `trpc.ai.trackStory` procedure call
 * the same function · drift impossible. The route stays mounted as the
 * rollback path.
 *
 * Returns: { story: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { runTrackStory } from "@/lib/services/ai-track-story";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const schema = z.object({
  doneToday: z.number().int().nonnegative(),
  thisWkDone: z.number().int().nonnegative(),
  prevWkDone: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  goalCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  coldProjects: z.number().int().nonnegative(),
  behindGoals: z.number().int().nonnegative(),
  topStreak: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    const parsed = await safeParseBody(schema, req, "track-story");
    if (!parsed.ok) return parsed.response;
    return NextResponse.json(await runTrackStory(parsed.data));
  } catch (e) {
    return aiRouteError(e, "track-story", "story failed");
  }
}
