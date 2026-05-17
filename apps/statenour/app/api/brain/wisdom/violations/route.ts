/**
 * GET /api/brain/wisdom/violations · v10.0.399
 *
 * Returns wisdoms the operator has been ACTING AGAINST in the last
 * 7 days. Per direction B5 · the advice you keep ignoring is often
 * the advice you most need surfaced.
 *
 * Query params:
 *   ?days=N · window size · default 7 · max 30
 *   ?limit=N · top N · default 10 · max 30
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { computeWisdomViolations } from "@/lib/brain/wisdom-violations";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const url = new URL(req.url);
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") ?? "7", 10)));
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10)));

  try {
    const violations = await computeWisdomViolations({ daysBack: days, limit });
    return NextResponse.json({
      windowDays: days,
      total: violations.length,
      violations,
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
export const GET = withTracing(handler, { name: "/api/brain/wisdom/violations" });
