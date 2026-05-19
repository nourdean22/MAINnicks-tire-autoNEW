/**
 * GET /api/actions-brain — Smart suggestions engine for the Actions page
 * Reads all data sources, processes patterns, generates contextual suggestions
 * Called on page load + every 15s refresh (cached for 2min)
 *
 * Phase PP (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/actions-brain.buildActionsBrain` so both this REST
 * endpoint AND the new `trpc.task.actionsBrain` query call the same
 * function · drift between consumers structurally impossible. Stays
 * mounted for back-compat with any non-tRPC consumer.
 *
 * Returns:
 * - pinnedItems: items user has pinned to top
 * - aiInsights: smart observations about patterns, risks, opportunities
 * - suggestedRoutines: habits to add/modify based on patterns
 * - suggestedTasks: tasks AI thinks you should do based on all data
 * - streakData: habit streaks with trend analysis
 * - dailyFocus: THE one thing to focus on right now
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { buildActionsBrain } from "@/lib/services/actions-brain";

export const dynamic = "force-dynamic";

// v10.0.44 — auth gate. Pre-fix unauthed callers could enumerate
// daily tasks, identity-snapshot axes, active commitments, recent
// decisions, and brain insights. CRITICAL privacy hole.
export async function GET(req: Request) {
  await requireSession(req);
  try {
    return NextResponse.json(await buildActionsBrain());
  } catch (err) {
    console.error("[actions-brain]", err);
    return NextResponse.json({ ok: false, error: "Brain failed" }, { status: 500 });
  }
}
