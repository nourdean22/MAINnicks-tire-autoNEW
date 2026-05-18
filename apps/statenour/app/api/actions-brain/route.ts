/**
 * GET /api/actions-brain — Smart suggestions engine for the Actions page
 * Reads all data sources, processes patterns, generates contextual suggestions
 * Called on page load + every 15s refresh (cached for 2min)
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
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// v10.0.44 — auth gate. Pre-fix unauthed callers could enumerate
// daily tasks, identity-snapshot axes, active commitments, recent
// decisions, and brain insights. CRITICAL privacy hole.
export async function GET(req: Request) {
  await requireSession(req);
  try {
    const today = todayStr();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    // Parallel data fetch
    // Apr 19 · DailyScore + MasteryHabit retired. Streak data sourced
    // from DAILY Task rows (streakCount + lastCompletedAt). Identity
    // snapshot replaces overallScore trend.
    const [
      dailyTasks, identitySnap, loops, commitments, tasks, memories,
      recentDecisions, dueReplays,
    ] = await Promise.all([
      // v7.9 — actions-brain feeds the AI; never surface soft-deleted rows.
      prisma.task.findMany({
        where: { loopKind: "DAILY", status: { in: ["READY", "DOING"] }, deletedAt: null },
        select: { title: true, streakCount: true, lastCompletedAt: true },
      }).catch(() => [] as Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }>),
      prisma.brainMemory
        .findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
          select: { content: true, deletedAt: true },
        })
        .then((r) => (r && r.deletedAt ? null : r))
        .catch(() => null),
      prisma.task.findMany({
        where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
        orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
        take: 30,
        select: { id: true, title: true, autoPriority: true, status: true },
      }),
      prisma.commitment.findMany({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } }),
      prisma.task.findMany({ where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null }, include: { mission: { select: { title: true, domain: true } } }, orderBy: { autoPriority: "desc" } }),
      prisma.brainMemory.findMany({ where: { category: { in: ["lesson", "pattern", "insight"] }, deletedAt: null }, orderBy: { confidence: "desc" }, take: 10 }),
      prisma.masteryDecision.findMany({ where: { deletedAt: null }, orderBy: { date: "desc" }, take: 5, select: { title: true, chosen: true, date: true } }),
      prisma.decisionReplay.findMany({ where: { reviewed: false, reviewAt: { lte: new Date() } }, take: 5 }),
    ]);

    // ── Streak analysis (from DAILY Task streakCount) ──
    const streakMap: Record<string, { current: number; best: number; trend: "up" | "down" | "flat"; todayDone: boolean }> = {};
    for (const t of dailyTasks) {
      const daysSince = t.lastCompletedAt
        ? (Date.now() - t.lastCompletedAt.getTime()) / 86400_000
        : 999;
      const todayDone = daysSince < 1;
      const trend: "up" | "down" | "flat" =
        t.streakCount >= 7 ? "up" : t.streakCount >= 3 ? "flat" : "down";
      streakMap[t.title] = {
        current: t.streakCount,
        best: t.streakCount,
        trend,
        todayDone,
      };
    }

    // ── AI Insights (pattern-based, no LLM call needed) ──
    const insights: { text: string; type: "info" | "warning" | "success" | "action"; priority: number }[] = [];

    // Check habit consistency
    const weakHabits = Object.entries(streakMap).filter(([, v]) => v.trend === "down" && !v.todayDone);
    if (weakHabits.length > 0) {
      insights.push({ text: `${weakHabits.map(([k]) => k).join(", ")} trending down — do them NOW before the day gets away`, type: "warning", priority: 1 });
    }

    // Check overdue tasks
    const overdueTasks = tasks.filter(t => {
      const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
      return age > 7;
    });
    if (overdueTasks.length > 3) {
      insights.push({ text: `${overdueTasks.length} tasks overdue — either do them, delegate them, or delete them. Carrying dead tasks kills momentum.`, type: "action", priority: 2 });
    }

    // Check commitment load
    if (commitments.length > 12) {
      insights.push({ text: `${commitments.length} active commitments — too many. Pick the top 5 that actually matter. Mark the rest as kept or broken.`, type: "warning", priority: 3 });
    }

    // Brain-maturity check (replaces daily-score check).
    let maturity: number | null = null;
    let weakAxis: string | null = null;
    if (identitySnap?.content) {
      try {
        const snap = JSON.parse(identitySnap.content) as { axes: Record<string, { value: number; manual: number | null }> };
        const axes = Object.entries(snap.axes ?? {});
        if (axes.length > 0) {
          maturity = Math.round(axes.reduce((s, [, a]) => s + (a.manual ?? a.value), 0) / axes.length);
          const weak = [...axes].sort(([, a], [, b]) => (a.manual ?? a.value) - (b.manual ?? b.value))[0];
          if (weak && (weak[1].manual ?? weak[1].value) < 40) {
            weakAxis = weak[0];
          }
        }
      } catch {
        // skip
      }
    }
    if (maturity !== null && maturity < 40) {
      insights.push({ text: `Brain maturity at ${maturity}/100 — self-model is thin. Open /brain · review candidates + identity pins.`, type: "info", priority: 4 });
    }
    if (weakAxis) {
      insights.push({ text: `Weakest axis: ${weakAxis}. Focus this week on the behaviors that move it.`, type: "warning", priority: 4 });
    }

    // Perfect streaks to protect
    const hotStreaks = Object.entries(streakMap).filter(([, v]) => v.current >= 7);
    if (hotStreaks.length > 0) {
      insights.push({ text: `Protect these streaks: ${hotStreaks.map(([k, v]) => `${k} (${v.current}d 🔥)`).join(", ")}`, type: "success", priority: 5 });
    }

    // Decision replays due
    if (dueReplays.length > 0) {
      insights.push({ text: `${dueReplays.length} decision${dueReplays.length > 1 ? "s" : ""} due for replay review — reflect on past choices`, type: "info", priority: 6 });
    }

    // Daily focus — THE one thing
    let dailyFocus = "Complete your non-negotiable routines first.";
    if (weakHabits.length > 0) dailyFocus = `Fix this first: ${weakHabits[0][0]} is slipping.`;
    else if (overdueTasks.length > 0) dailyFocus = `Clear the oldest overdue task: "${overdueTasks[0].title}"`;
    else if (maturity !== null && maturity >= 70) dailyFocus = "Brain maturity solid — tackle something hard.";

    // Relevant memories
    const relevantMemories = memories.slice(0, 3).map(m => m.content.slice(0, 100));

    return NextResponse.json({
      ok: true,
      data: {
        // v10.0.274 · surface maturity + weakAxis at the top level so
        // /tasks page can render a "weak axis: X" chip near the operator
        // headline. Pre-fix these were only inside `insights[]` array,
        // mixed with other system-prompt-style strings.
        maturity,
        weakAxis,
        streaks: streakMap,
        insights: insights.sort((a, b) => a.priority - b.priority),
        dailyFocus,
        stats: {
          openTasks: tasks.length,
          activeCommitments: commitments.length,
          brainMaturity: maturity,
          weakestAxis: weakAxis,
          dueReplays: dueReplays.length,
        },
        relevantMemories,
        overdueTasks: overdueTasks.slice(0, 3).map(t => ({ id: t.id, title: t.title, age: Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000) })),
      },
    });
  } catch (err) {
    console.error("[actions-brain]", err);
    return NextResponse.json({ ok: false, error: "Brain failed" }, { status: 500 });
  }
}
