/**
 * POST /api/integrations/research — Multi-model research endpoint.
 * Routes to Perplexity (citations), Grok (real-time), or local model.
 *
 * actions-surface REST→tRPC slice (2026-05-22) · the routing +
 * arsenal-logging logic moved to the shared
 * `lib/services/ai-research.runResearch` service · this route AND the
 * new `trpc.ai.research` procedure call the same function · drift
 * impossible. The route stays mounted as the rollback path.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { runResearch, type ResearchTaskType } from "@/lib/services/ai-research";

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const { query, taskType, systemPrompt } = await req.json();
    if (!query)
      return NextResponse.json({ error: "query required" }, { status: 400 });

    const result = await runResearch({
      query,
      taskType: (taskType as ResearchTaskType) || "research",
      systemPrompt,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
