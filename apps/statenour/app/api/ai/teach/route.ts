/**
 * POST /api/ai/teach
 *
 * The Learn-mode teach endpoint. Give it a topic and Nick generates a
 * tight micro-course that gets Nour from zero to operator-level
 * understanding in one read.
 *
 * Unlike /api/ai/plan-project mode=learn which is project-scoped, this
 * one is AD-HOC — Nour can ask "teach me options trading" without
 * creating a project.
 *
 * actions-surface REST→tRPC slice (2026-05-22) · the micro-course
 * generation moved to the shared `lib/services/ai-teach.runTeach`
 * service · this route AND the new `trpc.ai.teach` procedure call the
 * same function · drift impossible. The route stays mounted as the
 * rollback path.
 *
 * Body: { topic: string, depth?: "quick" | "standard" | "deep" }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { runTeach } from "@/lib/services/ai-teach";

export const maxDuration = 120;

const schema = z.object({
  topic: z.string().min(2).max(500),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    const parsed_in = await safeParseBody(schema, req, "teach");
    if (!parsed_in.ok) return parsed_in.response;
    const { topic, depth } = parsed_in.data;
    return NextResponse.json(await runTeach({ topic, depth }));
  } catch (err) {
    return aiRouteError(err, "teach", "teach failed");
  }
}
