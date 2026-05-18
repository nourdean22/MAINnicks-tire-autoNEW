/**
 * GET /api/nick/suggest · Wave 29 (v10.0.529.85)
 *
 * The brain of Nick's proactive layer. Aggregates cross-system signals
 * into ranked, actionable suggestions for the chat homepage. Each
 * suggestion ships with a `seedPrompt` · tapping the chip seeds the
 * chat input · the operator hits send · Nick already has the right
 * intent + context to execute.
 *
 * Sources (all server-side cheap reads):
 *   · MasteryScore latest per domain · weakest axis surface
 *   · Task list · stuck DOING + overdue + orphan
 *   · GoalEvent recency · stalled goals
 *   · BrainMemory(orphan_tasks_nudge) from W24 cron
 *   · BrainMemory(task_pattern) from W23 pattern clusterer
 *   · DriftAlert + Contradictions unresolved counts
 *
 * Output shape:
 *   {
 *     suggestions: [
 *       {
 *         id: "weak-axis-fitness",
 *         kind: "weak-axis" | "stuck-task" | "overdue" | "stalled-goal"
 *               | "pattern" | "orphan-nudge" | "contradiction" | "drift",
 *         severity: "high" | "med" | "low",
 *         label: "fitness is at 23/100 · biggest leverage today",
 *         seedPrompt: "what 3 fitness tasks would lift my fitness axis fastest?",
 *         actionHint: "ask · or tap and I'll create them",
 *         sourceContext: { ... } // optional · for the operator to inspect
 *       }, ...
 *     ],
 *     generatedAt: ISO,
 *   }
 *
 * Capped at 5 suggestions · ranked by severity desc + recency.
 * Auto-hides when nothing is actionable.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { today as todayET } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";

interface Suggestion {
  id: string;
  kind:
    | "weak-axis"
    | "stuck-task"
    | "overdue"
    | "stalled-goal"
    | "pattern"
    | "orphan-nudge"
    | "contradiction"
    | "drift"
    // v10.0.529.89 · Wave 33 · 3 new proactive sources mining the
    // surfaces Waves 30-32 wired. unresolved-reflection: Reflection
    // rows with actionable=true acknowledged=false. broken-promise:
    // PROMISE-kind Tasks past dueDate (high operator-trust signal).
    // stale-pin: BrainMemory pinned_user rows untouched > 30d.
    | "unresolved-reflection"
    | "broken-promise"
    | "stale-pin";
  severity: "high" | "med" | "low";
  label: string;
  seedPrompt: string;
  actionHint?: string;
  sourceContext?: Record<string, unknown>;
}

const SEVERITY_RANK: Record<Suggestion["severity"], number> = {
  high: 3,
  med: 2,
  low: 1,
};

export const GET = apiHandler(
  async () => {
    const suggestions: Suggestion[] = [];
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // v10.0.529.89 · Wave 33 · 3 new signal sources alongside the
    // original 7. Each gracefully fails to []/0 so a single failed
    // query doesn't bury the rest.
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    // ─── Read all signals in parallel · each gracefully fails to []
    const [
      latestScores,
      stuckTasks,
      overdueTasks,
      stalledGoals,
      patterns,
      orphanNudge,
      contradictions,
      unresolvedReflections,
      brokenPromises,
      stalePins,
    ] = await Promise.all([
      prisma.masteryScore
        .findMany({
          orderBy: { date: "desc" },
          take: 100,
          select: { domain: true, score: true, delta: true, date: true },
        })
        .catch((): Array<{ domain: string; score: number; delta: number; date: string }> => []),

      prisma.task
        .findMany({
          where: {
            status: "DOING",
            startedAt: { not: null, lte: twoHoursAgo },
            deletedAt: null,
          },
          select: { id: true, title: true, startedAt: true },
          take: 5,
        })
        .catch((): Array<{ id: string; title: string; startedAt: Date | null }> => []),

      prisma.task
        .findMany({
          where: {
            status: { in: ["INBOX", "READY", "DOING"] },
            dueDate: { not: null, lt: now },
            deletedAt: null,
          },
          select: { id: true, title: true, dueDate: true },
          orderBy: { dueDate: "asc" },
          take: 5,
        })
        .catch((): Array<{ id: string; title: string; dueDate: Date | null }> => []),

      prisma.lifeGoal
        .findMany({
          where: {
            status: "active",
            deletedAt: null,
            updatedAt: { lte: new Date(now.getTime() - 7 * 86400000) },
          },
          select: { id: true, title: true, currentValue: true, targetValue: true, unit: true, updatedAt: true },
          orderBy: { updatedAt: "asc" },
          take: 3,
        })
        .catch((): Array<{
          id: string;
          title: string;
          currentValue: number;
          targetValue: number;
          unit: string;
          updatedAt: Date;
        }> => []),

      prisma.brainMemory
        .findMany({
          where: {
            category: "task_pattern",
            deletedAt: null,
          },
          orderBy: { confidence: "desc" },
          take: 2,
          select: { metadata: true },
        })
        .catch((): Array<{ metadata: unknown }> => []),

      prisma.brainMemory
        .findFirst({
          where: {
            category: "orphan_tasks_nudge",
            key: "current",
            deletedAt: null,
          },
          select: { metadata: true },
        })
        .catch(() => null),

      prisma.brainMemory
        .count({
          where: {
            category: BRAIN_CATEGORIES.CONTRADICTION,
            deletedAt: null,
            confidence: { gte: 0.6 },
          },
        })
        .catch(() => 0),

      // v10.0.529.89 · Wave 33 · Reflection rows actionable AND
      // unacknowledged. The /journal flow surfaces these inline but
      // they pile up when the operator skims-without-acting. Top 5.
      prisma.reflection
        .findMany({
          where: {
            actionable: true,
            acknowledged: false,
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, insight: true, category: true, date: true },
        })
        .catch((): Array<{ id: string; insight: string; category: string; date: string }> => []),

      // v10.0.529.89 · Wave 33 · PROMISE-kind tasks past dueDate.
      // Highest-trust signal · operator promised someone (incl self)
      // and the clock ran out. Sorted by how-overdue, take 3 worst.
      prisma.task
        .findMany({
          where: {
            loopKind: "PROMISE",
            status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
            dueDate: { not: null, lt: now },
            deletedAt: null,
          },
          orderBy: { dueDate: "asc" },
          take: 3,
          select: { id: true, title: true, dueDate: true, promiseTo: true },
        })
        .catch((): Array<{ id: string; title: string; dueDate: Date | null; promiseTo: string | null }> => []),

      // v10.0.529.89 · Wave 33 · pinned_user BrainMemory rows
      // untouched > 30d. Top-5 pins inject into every system prompt ·
      // a stale pin is dead context budget. Operator should review
      // and either deprecate or re-confirm.
      prisma.brainMemory
        .findMany({
          where: {
            category: BRAIN_CATEGORIES.PINNED_USER,
            updatedAt: { lt: thirtyDaysAgo },
            deletedAt: null,
          },
          orderBy: { updatedAt: "asc" },
          take: 3,
          select: { id: true, content: true, updatedAt: true },
        })
        .catch((): Array<{ id: string; content: string; updatedAt: Date }> => []),
    ]);

    // ─── 1 · Weakest mastery axis (high-leverage)
    if (latestScores.length > 0) {
      const latestByDomain = new Map<string, { score: number; delta: number }>();
      for (const row of latestScores) {
        if (!latestByDomain.has(row.domain)) {
          latestByDomain.set(row.domain, { score: row.score, delta: row.delta });
        }
      }
      const ordered = [...latestByDomain.entries()].sort((a, b) => a[1].score - b[1].score);
      const weakest = ordered[0];
      if (weakest && weakest[1].score < 50) {
        suggestions.push({
          id: `weak-axis-${weakest[0]}`,
          kind: "weak-axis",
          severity: weakest[1].score < 30 ? "high" : "med",
          label: `${weakest[0]} at ${weakest[1].score}/100 · biggest growth lever today`,
          seedPrompt: `what 3 ${weakest[0]} tasks would lift my mastery axis fastest? suggest them and add them to today if i say yes`,
          actionHint: "ask · or tap to plan it",
          sourceContext: { domain: weakest[0], score: weakest[1].score },
        });
      }
    }

    // ─── 2 · Stuck DOING tasks
    if (stuckTasks.length > 0) {
      const top = stuckTasks[0]!;
      const titles = stuckTasks.slice(0, 3).map((t) => `"${t.title.slice(0, 40)}"`).join(" · ");
      suggestions.push({
        id: "stuck-doing",
        kind: "stuck-task",
        severity: stuckTasks.length >= 3 ? "high" : "med",
        label:
          stuckTasks.length === 1
            ? `stuck on "${top.title.slice(0, 50)}" for 2h+`
            : `${stuckTasks.length} tasks stuck DOING > 2h`,
        seedPrompt:
          stuckTasks.length === 1
            ? `i'm stuck on "${top.title}" · help me re-frame it as a smaller next physical action`
            : `i'm stuck on ${stuckTasks.length} tasks · help me re-frame them: ${titles}`,
        actionHint: "ask for re-frame help",
        sourceContext: { stuckCount: stuckTasks.length, taskIds: stuckTasks.map((t) => t.id) },
      });
    }

    // ─── 3 · Overdue tasks
    if (overdueTasks.length >= 3) {
      suggestions.push({
        id: "overdue-pile",
        kind: "overdue",
        severity: overdueTasks.length >= 5 ? "high" : "med",
        label: `${overdueTasks.length} tasks overdue · stacking up`,
        seedPrompt: `walk me through my overdue pile · for each one decide: do today · snooze · or drop`,
        actionHint: "triage with me",
        sourceContext: { count: overdueTasks.length },
      });
    }

    // ─── 4 · Stalled goals (no progress in 7d)
    if (stalledGoals.length > 0) {
      const top = stalledGoals[0]!;
      suggestions.push({
        id: `stalled-goal-${top.id}`,
        kind: "stalled-goal",
        severity: "med",
        label: `"${top.title.slice(0, 50)}" hasn't moved in 7+ days`,
        seedPrompt: `${stalledGoals.length === 1 ? `coach me on "${top.title}" · what would move it today` : `coach me on my ${stalledGoals.length} stalled goals · pick the highest-leverage one`}`,
        actionHint: "ask for a coach session",
        sourceContext: {
          goalId: top.id,
          currentValue: top.currentValue,
          targetValue: top.targetValue,
        },
      });
    }

    // ─── 5 · Pattern from /brain pattern-clusterer (W23)
    if (patterns.length > 0) {
      const meta = patterns[0]?.metadata as {
        axis?: string;
        memberCount?: number;
        dominantWisdomQuery?: string | null;
      } | null;
      if (meta?.axis && meta?.memberCount && meta.memberCount >= 3) {
        suggestions.push({
          id: `pattern-${meta.axis}`,
          kind: "pattern",
          severity: "med",
          label: `${meta.memberCount} ${meta.axis} insights this week · pattern detected`,
          seedPrompt: meta.dominantWisdomQuery
            ? `i've been circling ${meta.axis} · the thread is "${meta.dominantWisdomQuery}" · help me ship instead of researching`
            : `i've been circling ${meta.axis} for ${meta.memberCount} tasks this week · what's the real move?`,
          actionHint: "discuss the thread",
          sourceContext: meta,
        });
      }
    }

    // ─── 6 · Orphan nudge from W24 cron
    if (orphanNudge) {
      const meta = orphanNudge.metadata as { orphanCount?: number } | null;
      if (meta?.orphanCount && meta.orphanCount >= 3) {
        suggestions.push({
          id: "orphan-nudge",
          kind: "orphan-nudge",
          severity: "low",
          label: `${meta.orphanCount} tasks today aren't tagged · auto-learn loop leaks`,
          seedPrompt: `help me tag the ${meta.orphanCount} untagged tasks i completed today · ask me one at a time and learn from my answers`,
          actionHint: "tag together",
          sourceContext: meta,
        });
      }
    }

    // ─── 7 · Contradictions to resolve
    if (contradictions > 0) {
      suggestions.push({
        id: "contradictions",
        kind: "contradiction",
        severity: "low",
        label: `${contradictions} unresolved contradiction${contradictions === 1 ? "" : "s"}`,
        seedPrompt: `walk me through my unresolved contradictions one by one · ask which side i still believe`,
        actionHint: "resolve them",
        sourceContext: { count: contradictions },
      });
    }

    // ─── 8 · Unresolved reflections (Wave 33)
    //
    // Reflection rows with actionable=true acknowledged=false pile up
    // when the operator skims /journal without acting on the call-to-
    // action. Surface the most-recent so it doesn't drift into oblivion.
    if (unresolvedReflections.length > 0) {
      const top = unresolvedReflections[0]!;
      suggestions.push({
        id: `unresolved-reflection-${top.id}`,
        kind: "unresolved-reflection",
        severity: unresolvedReflections.length >= 3 ? "med" : "low",
        label:
          unresolvedReflections.length === 1
            ? `unresolved · "${top.insight.slice(0, 60)}"`
            : `${unresolvedReflections.length} unresolved reflections · top: "${top.insight.slice(0, 45)}"`,
        seedPrompt:
          unresolvedReflections.length === 1
            ? `help me act on this reflection · "${top.insight.slice(0, 120)}" · what's the smallest concrete next move?`
            : `walk me through my ${unresolvedReflections.length} unresolved reflections · for each, decide: act now · convert to a task · or acknowledge and let go`,
        actionHint: "act or convert to a task",
        sourceContext: {
          reflectionId: top.id,
          category: top.category,
          count: unresolvedReflections.length,
        },
      });
    }

    // ─── 9 · Broken promises (Wave 33) · highest operator-trust signal
    //
    // PROMISE-kind tasks past dueDate are a trust violation against
    // self (or someone else) that quietly erodes integrity. Surface
    // as HIGH severity always · breaking promises is rarely OK to
    // ignore.
    if (brokenPromises.length > 0) {
      const top = brokenPromises[0]!;
      const dueDate = top.dueDate ? new Date(top.dueDate) : null;
      const daysOverdue = dueDate ? Math.floor((now.getTime() - dueDate.getTime()) / 86400000) : 0;
      const promiseToLabel = top.promiseTo ? `to ${top.promiseTo}` : "to yourself";
      suggestions.push({
        id: `broken-promise-${top.id}`,
        kind: "broken-promise",
        severity: "high",
        label:
          brokenPromises.length === 1
            ? `broken promise ${promiseToLabel} · "${top.title.slice(0, 40)}" · ${daysOverdue}d overdue`
            : `${brokenPromises.length} broken promises · top ${promiseToLabel} · ${daysOverdue}d overdue`,
        seedPrompt:
          brokenPromises.length === 1
            ? `i broke my promise ${promiseToLabel} on "${top.title}" · ${daysOverdue} days overdue · help me decide: deliver it today · re-promise with a real date · or close it honestly`
            : `i have ${brokenPromises.length} broken promises · walk me through each one and decide deliver/re-promise/close`,
        actionHint: "honor or close it",
        sourceContext: {
          taskId: top.id,
          daysOverdue,
          promiseTo: top.promiseTo,
          count: brokenPromises.length,
        },
      });
    }

    // ─── 10 · Stale pins (Wave 33)
    //
    // pinned_user BrainMemory rows untouched > 30d are dead context
    // budget in every prompt. Operator should re-confirm or deprecate.
    if (stalePins.length > 0) {
      const top = stalePins[0]!;
      const daysStale = Math.floor((now.getTime() - new Date(top.updatedAt).getTime()) / 86400000);
      suggestions.push({
        id: `stale-pin-${top.id}`,
        kind: "stale-pin",
        severity: "low",
        label:
          stalePins.length === 1
            ? `stale pin · ${daysStale}d · "${top.content.slice(0, 50)}"`
            : `${stalePins.length} stale pins · oldest ${daysStale}d`,
        seedPrompt:
          stalePins.length === 1
            ? `this pin is ${daysStale} days old · "${top.content.slice(0, 120)}" · do i still believe this · refresh it · or unpin it?`
            : `walk me through my ${stalePins.length} stale pins (>30d untouched) · for each one decide: keep · refresh wording · unpin`,
        actionHint: "audit your pins",
        sourceContext: { pinId: top.id, daysStale, count: stalePins.length },
      });
    }

    // Sort by severity then by id for stability, cap at 5
    suggestions.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    return {
      suggestions: suggestions.slice(0, 5),
      generatedAt: now.toISOString(),
      date: todayET(),
    };
  },
  { auth: "owner" },
);
