import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth-guard";
import { buildMicroPlan, IntentTooShortError } from "@/lib/services/ultron-plan";
/**
 * POST /api/ultron/plan
 *
 * Micro-plan compiler. Takes free-text intent ("close out the day well")
 * and returns 3-6 concrete executable steps with suggested action types.
 *
 * Body:  { intent: string }
 * Returns:
 *   {
 *     steps: [{
 *       id: string,
 *       title: string,          // human-readable step ("log today's score")
 *       action: "task" | "capture" | "nav" | "reminder" | "toggle",
 *       target?: string,        // href for nav, task title for task, etc.
 *       effort?: "M5"|"M15"|"M30"|"H1"
 *     }],
 *     summary: string,
 *     reasoning: string,
 *   }
 *
 * The UI renders each step with a one-click "do it" button that interprets
 * the action kind (navigates, creates a task, opens capture, etc.). No
 * server-side execution — the client decides what to do, keeping the API
 * pure.
 *
 * Phase B.6a (2026-05-22) · the compiler body was extracted into
 * `lib/services/ultron-plan.ts` (buildMicroPlan) so the new
 * `operator.plan` tRPC procedure calls the SAME function · drift
 * impossible. This route stays mounted as the rollback path.
 */

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json().catch(() => ({}))) as { intent?: string };
    const parsed = await buildMicroPlan(body.intent ?? "");
    return NextResponse.json({ data: parsed });
  } catch (err) {
    if (err instanceof IntentTooShortError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
