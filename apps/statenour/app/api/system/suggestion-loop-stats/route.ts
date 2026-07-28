/**
 * GET /api/system/suggestion-loop-stats
 *
 * Read-only stats over the suggestion-loop supervised-signal capture.
 *
 * Query params:
 *   ?days=30 (default · max 365)
 *
 * Response:
 *   {
 *     window: { days, since },
 *     totalSignals: number,
 *     byKind: Record<kind, { acted, dismissed, modified, deferred,
 *                            positive, negative, neutral }>,
 *     actionRate: Record<kind, number>,        // 0-1 · acted / surfaced
 *     positiveOutcomeRate: Record<kind, number> // 0-1 · positive / outcome
 *   }
 *
 * Surfaces the data captured by /api/brain/suggestion-loop · operator
 * can `curl` this to verify the loop is alive without opening a UI.
 *
 * NextAuth-gated like the rest of /api/system/*.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { suggestionLoopStats } from "@/lib/brain/suggestion-loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  // 2026-07-28 · standardized from `await auth()` to the canonical
  // requireSession so the sensitive-GET checker recognizes the gate
  // without widening its signal list (one grep-able idiom for all).
  try { await requireSession(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const parsedDays = daysParam ? Number(daysParam) : 30;
  const days =
    Number.isFinite(parsedDays) && parsedDays > 0 && parsedDays <= 365
      ? Math.floor(parsedDays)
      : 30;

  try {
    const stats = await suggestionLoopStats(days);
    return NextResponse.json({
      window: {
        days,
        since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      },
      ...stats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
