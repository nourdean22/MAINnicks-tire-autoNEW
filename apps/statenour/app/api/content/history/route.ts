/**
 * /api/content/history — search past content scored by the 7-axis critic.
 *
 * v6 · BATCH 3 · Apr 28. Query interface for the brain_memory rows
 * written by the chat post-process critic (category=nick_quality).
 * Lets Nour search "all 80+ scoring brake-related posts last 30 days"
 * or "lowest-scoring story copy this week" — pattern-mining on
 * shipped content quality.
 *
 * Query params:
 *   q       — free-text search across content snippet
 *   minScore — only show posts with overall ≥ N (default 0)
 *   maxScore — only show posts with overall ≤ N (default 100)
 *   shape   — filter by output shape (prose/email/sms/list/...)
 *   intent  — filter by turn intent (content/work/personal/...)
 *   contentMode — boolean, only 7-axis content scores
 *   days    — last N days (default 30)
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getContentHistory } from "@/lib/services/content-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// misc-pages slice (2026-05-22) · the query + in-memory metadata
// filter + aggregate stats moved to the shared `getContentHistory`
// service the `operator.contentHistory` tRPC procedure also calls ·
// drift structurally impossible.
export async function GET(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { searchParams } = new URL(req.url);
  const payload = await getContentHistory({
    q: searchParams.get("q") ?? undefined,
    minScore: searchParams.has("minScore")
      ? Number(searchParams.get("minScore"))
      : undefined,
    maxScore: searchParams.has("maxScore")
      ? Number(searchParams.get("maxScore"))
      : undefined,
    shape: searchParams.get("shape") ?? undefined,
    intent: searchParams.get("intent") ?? undefined,
    contentModeOnly: searchParams.get("contentMode") === "true",
    days: searchParams.has("days")
      ? Number(searchParams.get("days"))
      : undefined,
  });

  return NextResponse.json(payload);
}
