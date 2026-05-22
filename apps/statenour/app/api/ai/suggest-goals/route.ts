/**
 * POST /api/ai/suggest-goals
 *
 * Given a time horizon (DAY/WEEK/MONTH/QUARTER/YEAR/LIFE), ask Nick
 * to suggest 3-5 sharp goals Nour should be working toward at that
 * level. Uses brain memory + active missions + past decisions as
 * context so the suggestions aren't generic.
 *
 * The returned goals match the LifeGoal shape so the client can
 * one-click adopt them via the goals CRUD.
 *
 * Body:
 *   { horizon: "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "LIFE",
 *     domain?: string,   // optional filter
 *     context?: string   // optional Nour-written note
 *   }
 *
 * scattered-components REST→tRPC slice (2026-05-22) · the generation
 * logic moved to the shared `lib/services/ai-suggest-goals.runSuggestGoals`
 * service · this route AND the new `trpc.ai.suggestGoals` procedure
 * call the same function · drift impossible. The route stays mounted as
 * the coexistence / rollback path.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import {
  runSuggestGoals,
  SUGGEST_GOAL_HORIZONS,
} from "@/lib/services/ai-suggest-goals";
import { NextResponse } from "next/server";

export const maxDuration = 120;

const schema = z.object({
  horizon: z.enum(SUGGEST_GOAL_HORIZONS).default("WEEK"),
  domain: z.string().optional(),
  context: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed_in = await safeParseBody(schema, req, "suggest-goals");
    if (!parsed_in.ok) return parsed_in.response;
    const result = await runSuggestGoals(parsed_in.data);
    return NextResponse.json(result);
  } catch (err) {
    return aiRouteError(err, "suggest-goals", "suggest failed");
  }
}
