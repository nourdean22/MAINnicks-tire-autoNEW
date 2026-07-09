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
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { runResearch, type ResearchTaskType } from "@/lib/services/ai-research";
import { ServiceError } from "@/lib/utils/service-error";

export const POST = apiHandler(async (req) => {
  const { query, taskType, systemPrompt } = await readRequestJson<{ query?: string; taskType?: string; systemPrompt?: string }>(req);
  if (!query) throw new ServiceError("query required", 400);

  return runResearch({
    query,
    taskType: (taskType as ResearchTaskType) || "research",
    systemPrompt,
  });
}, { auth: "owner" });
