/**
 * POST /api/integrations/research — Multi-model research endpoint.
 * Routes to Perplexity (citations), Grok (real-time), or local model.
 */

import { NextRequest, NextResponse } from "next/server";
import { routeQuery } from "@/lib/ai/router";
import { logArsenalActivity } from "@/lib/integrations/arsenal-log";

import { requireSession } from "@/lib/auth-guard";
export async function POST(req: NextRequest) {
  await requireSession(req);
  const start = Date.now();
  try {
    const { query, taskType, systemPrompt } = await req.json();
    if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

    const result = await routeQuery(query, taskType || "research", systemPrompt);

    logArsenalActivity({
      toolId: result?.provider || "multi-model",
      action: "research",
      status: "success",
      durationMs: Date.now() - start,
      inputPreview: query?.slice(0, 200),
      resultPreview: (result?.content ?? JSON.stringify(result))?.slice(0, 1000),
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logArsenalActivity({
      toolId: "multi-model",
      action: "research",
      status: "error",
      durationMs: Date.now() - start,
      errorMessage: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
