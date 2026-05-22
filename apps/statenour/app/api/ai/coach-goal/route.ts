/**
 * POST /api/ai/coach-goal
 *
 * Goal-level coach. Given a LifeGoal id, Nick pulls the goal's
 * current state + all linked Tasks + recent progress data and
 * returns a one-line read, one next action, current blocker, and
 * risks. Appends the response to LifeGoal.coachLog so the goal's
 * coaching history is visible in Plan mode.
 *
 * Think of this as /api/ai/plan-project mode=guide but at the
 * goal level — one rung higher in the lineage.
 *
 * Body: { goalId: string, currentState?: string }
 *
 * scattered-components REST→tRPC slice (2026-05-22) · the coach logic
 * moved to the shared `lib/services/ai-coach-goal.runCoachGoal` service
 * · this route AND the new `trpc.ai.coachGoal` procedure call the same
 * function · drift impossible. The route stays mounted as the
 * coexistence / rollback path.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { runCoachGoal, CoachGoalError } from "@/lib/services/ai-coach-goal";

export const maxDuration = 120;

const schema = z.object({
  goalId: z.string().min(1),
  currentState: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed_in = await safeParseBody(schema, req, "coach-goal");
    if (!parsed_in.ok) return parsed_in.response;
    const result = await runCoachGoal(parsed_in.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CoachGoalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return aiRouteError(err, "coach-goal", "coach failed");
  }
}
