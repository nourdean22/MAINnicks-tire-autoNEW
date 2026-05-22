/**
 * POST /api/ai/plan-project — The project-intelligence engine.
 *
 * Five modes — clarify · plan · milestones · learn · guide. All pull
 * brain memory + past-decision context so the plan is informed by
 * Nour's actual situation. `plan` / `learn` / `guide` persist to
 * `Mission.planData` when a `missionId` is supplied.
 *
 * actions-surface REST→tRPC slice (2026-05-22) · the full engine moved
 * to the shared `lib/services/ai-plan-project.runPlanProject` service ·
 * this route AND the new `trpc.ai.planProject` procedure call the same
 * function · drift impossible. The route stays mounted as the rollback
 * path. `PlanProjectError` carries the 400/404 status verbatim.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import {
  runPlanProject,
  PlanProjectError,
} from "@/lib/services/ai-plan-project";

// v10.0.184 · 240s allows primary + one fallback within the Vercel
// Pro 300s cap (plan-project:plan runs long).
export const maxDuration = 240; // Pro plan

const schema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  domain: z.string().optional(),
  answers: z.string().max(5000).optional(),
  missionId: z.string().optional(),
  currentState: z.string().max(2000).optional(),
  mode: z
    .enum(["clarify", "plan", "learn", "guide", "milestones"])
    .default("plan"),
  milestones: z.array(z.string().min(1).max(200)).max(8).optional(),
  goalTarget: z.number().optional(),
  goalUnit: z.string().max(50).optional(),
  goalDeadline: z.string().optional(),
  goalMetric: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    const parsed_in = await safeParseBody(schema, req, "plan-project");
    if (!parsed_in.ok) return parsed_in.response;
    return NextResponse.json(await runPlanProject(parsed_in.data));
  } catch (err) {
    if (err instanceof PlanProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return aiRouteError(err, "plan-project", "Failed to plan project");
  }
}
