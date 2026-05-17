/**
 * GET /api/brain/improve-agent · v10.0.405
 *
 * Closes the eval feedback loop · surfaces concrete improvement
 * hypotheses derived from the last N days of LLM-as-judge scores.
 *
 * Query params:
 *   ?days=N · window size · default 7 · max 30
 *   ?persist=1 · also write hypotheses as brain memories (default
 *                read-only · safer when called from operator UI)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  getRecentJudgments,
  analyzeJudgments,
  persistHypotheses,
} from "@/lib/brain/improve-agent";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const url = new URL(req.url);
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") ?? "7", 10)));
  const persist = url.searchParams.get("persist") === "1";

  try {
    const judgments = await getRecentJudgments(days);
    const hypotheses = analyzeJudgments(judgments);
    let persistedCount = 0;
    if (persist && hypotheses.length > 0) {
      persistedCount = await persistHypotheses(hypotheses);
    }
    return NextResponse.json({
      windowDays: days,
      judgmentCount: judgments.length,
      hypotheses,
      persisted: persistedCount,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "computation failed" },
      { status: 500 },
    );
  }
}

// Auth: handler above invokes requireSession on first line.
export const GET = withTracing(handler, { name: "/api/brain/improve-agent" });
