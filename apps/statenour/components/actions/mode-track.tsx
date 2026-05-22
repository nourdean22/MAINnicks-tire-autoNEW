"use client";

/**
 * KommandoTrack — TRACK mode v2 · Apr 27 rebuild.
 *
 * The "actually functional tracker" pass. Old TRACK was a wall of
 * stale numbers (drift count, streak leaderboard, mood line) with
 * nothing actionable on it. New TRACK is a live dashboard for every
 * dimension Nour cares about, with one-tap actions everywhere.
 *
 * Wording change: "loops" → "routines" everywhere visible. "drift"
 * → "warning" (with ⚠️ when tight on space). The data model still
 * uses LoopKind = ONCE | DAILY | PROMISE under the hood; we just
 * relabel for the user.
 *
 * Sections (top → bottom):
 *   1. Today's Pulse        — done · open · late · DOING · streak
 *   2. Weekly Delta         — this wk vs last wk across 4 dims
 *   3. Goal Pace Board      — every goal as a row with verdict
 *   4. Project Board        — every project with momentum chip
 *   5. Warning Queue (⚠️)   — stale routines + decaying goals +
 *                              cold projects + orphan tasks, ranked
 *   6. Routine Heatmap      — DAILY routines · 30-day grid
 *   7. Story Footer         — AI 1-paragraph weekly summary
 *
 * REVIEW button on NOW headline opens the ReviewWizard which is a
 * 4-step flow (triage warnings → confirm goals → confirm projects
 * → pick top 3 for next week). That component lives separately so
 * both NOW and TRACK can launch it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Flame,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  Handshake,
  Activity,
  Trophy,
  Clock,
  Sparkles,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { TipChip } from "@/components/ui/tip-chip";
import { LEARN_TIPS } from "@/lib/learn/tips";
import {
  domainClass,
  type Task,
} from "@/components/actions/shared";
import { onDataChanged, notifyDataChanged } from "@/lib/events/data-change";
import { computePace, paceLabelShort, formatRate, type PaceVerdict } from "@/lib/brain/goal-pace";
import { classifyStaleness } from "@/lib/brain/goal-staleness";
import {
  computeProjectMomentum,
  momentumLabel,
  momentumTone,
  type Momentum,
} from "@/lib/brain/project-momentum";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc/client";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
interface KommandoTrackProps {
  /** Cross-mode navigation — wired by KommandoShell. Lets track rows
   *  jump to NOW/PLAN/REVIEW with context. */
  onJumpMode?: (mode: string) => void;
  /** Optional callback to open the ReviewWizard. The shell wires this
   *  so both TRACK's "Run weekly review" CTA and the NOW headline's
   *  REVIEW button hit the same wizard. */
  onOpenReview?: () => void;
}

interface GoalRow {
  id: string;
  title: string;
  domain?: string | null;
  horizon?: string | null;
  progress: number;
  currentValue: number;
  targetValue: number;
  unit?: string;
  metric?: string;
  deadline?: string | null;
  status?: string;
  createdAt: string;
  updatedAt: string;
  linkedActiveCount?: number;
  linkedDoneCount?: number;
  loopsThisWeek?: number;
}

interface ProjectRow {
  id: string;
  title: string;
  domain?: string | null;
  status?: string;
  planData?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export function KommandoTrack({ onJumpMode, onOpenReview }: KommandoTrackProps = {}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<string | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);

  // task.* tRPC utils for the imperative coordinated fetch · the
  // legacy code ran a Promise.all of 3 authedFetch reads. utils.*.fetch
  // returns the payload directly (no apiHandler envelope to unwrap).
  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation();
  const goalsUpdate = trpc.task.goalsUpdate.useMutation();
  // ai.trackStory replaces POST /api/ai/track-story · the weekly-story
  // narrator. The AI domain now has a tRPC router; the story call rides
  // there. mutateAsync resolves with `{ story }`.
  const trackStoryMut = trpc.ai.trackStory.useMutation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Phase B.5 · fire all three tRPC reads concurrently, then await
      // each separately. The prior `await Promise.all([...])` form tripped
      // TS2589 ("excessively deep") once the chat-router slice grew the
      // AppRouter type — Promise.all's 3-tuple inference over three deep
      // tRPC fetch types crossed TS's instantiation-depth limit. Awaiting
      // the pre-started promises individually keeps the concurrency and
      // the resolved types identical, without the tuple inference.
      const tasksP = utils.task.list
        .fetch(undefined)
        .catch((): Task[] => []);
      const goalsP = utils.task.goals
        .fetch(undefined)
        .catch((): { goals: GoalRow[] } => ({ goals: [] }));
      const projectsP = utils.task.missions
        .fetch()
        .catch((): ProjectRow[] => []);
      const tArr = await tasksP;
      const gWrapped = await goalsP;
      const pArr = await projectsP;
      setTasks(Array.isArray(tArr) ? (tArr as Task[]) : []);
      const gArr = gWrapped?.goals ?? [];
      setGoals(Array.isArray(gArr) ? (gArr as GoalRow[]) : []);
      // v10.0.154 · filter out system-managed inboxes ("Inbox", "Inbox -
      // business", etc.) so Stats matches the Plan view + the user-
      // facing 3-project cap. Inboxes are catch-alls, not chosen
      // projects — counting them confused the operator (Plan said 3,
      // Stats said 4, and the cap blocked at 3).
      const { isUserProject } = await import("@/lib/services/mission-helpers");
      const projectsRaw = Array.isArray(pArr) ? (pArr as ProjectRow[]) : [];
      setProjects(projectsRaw.filter(isUserProject));
    } catch {}
    setLoading(false);
  }, [utils]);

  useEffect(() => {
    load();
  }, [load]);

  // Cross-tab reactive refresh — TRACK numbers update the moment NOW
  // completes a task, PLAN logs progress, or anything mutates state.
  useEffect(() => {
    const off = onDataChanged(["tasks", "goals", "missions", "projects"], () => {
      void load();
    });
    return off;
  }, [load]);

  // ─── Computed sections ────────────────────────────────────────────

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ms = (d: number) => d * 86_400_000;

    const active = tasks.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status));
    const doing = active.filter((t) => t.status === "DOING");
    const done = tasks.filter((t) => t.status === "DONE");
    const daily = active.filter((t) => t.loopKind === "DAILY");
    const promiseAll = tasks.filter((t) => t.loopKind === "PROMISE");
    const overdue = active.filter(
      (t) => t.dueDate && new Date(t.dueDate).getTime() < todayStart.getTime(),
    );

    // ── Today's Pulse ──
    const doneToday = done.filter((t) => {
      const w = t.updatedAt || t.lastTouchedAt;
      if (!w) return false;
      const d = new Date(w);
      return d >= todayStart;
    }).length;

    // 14-day sparkline (kept from old TRACK — visual continuity)
    const buckets14: number[] = new Array(14).fill(0);
    for (const t of done) {
      const w = t.updatedAt || t.lastTouchedAt;
      if (!w) continue;
      const d = new Date(w);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const daysAgo = Math.round((todayStart.getTime() - dayStart.getTime()) / 86_400_000);
      if (daysAgo >= 0 && daysAgo < 14) buckets14[13 - daysAgo]++;
    }

    // Top current streak — single number for the pulse banner
    const topStreak = Math.max(0, ...daily.map((t) => t.streakCount ?? 0));

    // ── Weekly Delta — this wk (last 7 days) vs prev wk (8-14 days ago) ──
    const thisWkDone = done.filter((t) => {
      const w = t.updatedAt || t.lastTouchedAt;
      if (!w) return false;
      return new Date(w).getTime() >= now.getTime() - ms(7);
    });
    const prevWkDone = done.filter((t) => {
      const w = t.updatedAt || t.lastTouchedAt;
      if (!w) return false;
      const t2 = new Date(w).getTime();
      return t2 >= now.getTime() - ms(14) && t2 < now.getTime() - ms(7);
    });
    const thisWkGoalLifting = thisWkDone.filter((t) => t.goalId).length;
    const prevWkGoalLifting = prevWkDone.filter((t) => t.goalId).length;
    const thisWkPromKept = thisWkDone.filter((t) => t.loopKind === "PROMISE").length;
    const prevWkPromKept = prevWkDone.filter((t) => t.loopKind === "PROMISE").length;
    const thisWkMinutes = thisWkDone.reduce((s, t) => s + (t.actualMinutes ?? 0), 0);
    const prevWkMinutes = prevWkDone.reduce((s, t) => s + (t.actualMinutes ?? 0), 0);

    const delta = (a: number, b: number) => {
      const diff = a - b;
      const pct = b > 0 ? Math.round((diff / b) * 100) : null;
      return { diff, pct };
    };

    // ── Goal Pace Board ──
    const goalRows = goals
      .filter((g) => g.status !== "completed" && g.status !== "achieved" && g.status !== "missed")
      .map((g) => {
        const verdict: PaceVerdict = computePace({
          currentValue: g.currentValue,
          targetValue: g.targetValue,
          deadline: g.deadline ?? null,
          createdAt: g.createdAt,
        });
        const stale = classifyStaleness({
          createdAt: g.createdAt,
          updatedAt: g.updatedAt,
          progress: g.progress,
          currentValue: g.currentValue,
          status: g.status ?? "active",
          linkedActiveCount: g.linkedActiveCount,
          linkedDoneCount: g.linkedDoneCount,
          loopsThisWeek: g.loopsThisWeek,
        });
        return { goal: g, verdict, stale };
      })
      .sort((a, b) => {
        const order: Record<string, number> = {
          missed: 0,
          behind: 1,
          needs: 2,
          "on-track": 3,
          ahead: 4,
          unscored: 5,
        };
        return (order[a.verdict.kind] ?? 9) - (order[b.verdict.kind] ?? 9);
      });

    // ── Project Board ──
    const projectRows = projects
      .filter((p) => (p.status ?? "ACTIVE") === "ACTIVE")
      .map((p) => {
        const m = computeProjectMomentum(p.id, tasks);
        const projTasks = tasks.filter((t) => t.missionId === p.id);
        const open = projTasks.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status)).length;
        const doneCt = projTasks.filter((t) => t.status === "DONE").length;
        const totalCt = projTasks.length;
        return {
          project: p,
          momentum: m,
          open,
          done: doneCt,
          total: totalCt,
          pct: totalCt > 0 ? Math.round((doneCt / totalCt) * 100) : 0,
        };
      })
      .sort((a, b) => {
        const order: Record<Momentum, number> = {
          dead: 0,
          cold: 1,
          stale: 2,
          steady: 3,
          warm: 4,
        };
        return order[a.momentum.momentum] - order[b.momentum.momentum];
      });

    // ── Warning Queue (renamed from Drift) ──
    interface Warning {
      kind: "stale-task" | "decaying-goal" | "cold-project" | "orphan-task" | "stale-promise";
      severity: "high" | "med" | "low";
      label: string;
      sub?: string;
      taskId?: string;
      goalId?: string;
      projectId?: string;
    }
    const warnings: Warning[] = [];

    // Stale routines (active >7d untouched)
    for (const t of active) {
      const w = t.lastTouchedAt || t.createdAt;
      if (!w) continue;
      const ageDays = Math.floor((now.getTime() - new Date(w).getTime()) / 86_400_000);
      if (ageDays >= 14) {
        warnings.push({
          kind: "stale-task",
          severity: "high",
          label: t.title,
          sub: `${ageDays}d untouched`,
          taskId: t.id,
        });
      } else if (ageDays >= 7) {
        warnings.push({
          kind: "stale-task",
          severity: "med",
          label: t.title,
          sub: `${ageDays}d untouched`,
          taskId: t.id,
        });
      }
    }
    // Decaying goals
    for (const { goal, stale } of goalRows) {
      if (stale.kind === "stale") {
        warnings.push({
          kind: "decaying-goal",
          severity: "high",
          label: goal.title,
          sub: stale.reason,
          goalId: goal.id,
        });
      } else if (stale.kind === "decaying") {
        warnings.push({
          kind: "decaying-goal",
          severity: "med",
          label: goal.title,
          sub: stale.reason,
          goalId: goal.id,
        });
      }
    }
    // Cold/dead projects
    for (const { project, momentum, open } of projectRows) {
      if (momentum.momentum === "dead") {
        warnings.push({
          kind: "cold-project",
          severity: "high",
          label: project.title,
          sub: `dead · ${open} open`,
          projectId: project.id,
        });
      } else if (momentum.momentum === "cold") {
        warnings.push({
          kind: "cold-project",
          severity: "med",
          label: project.title,
          sub: `cold · ${open} open`,
          projectId: project.id,
        });
      }
    }
    // Orphan tasks (no goal, no project, >3d old)
    for (const t of active) {
      if (t.goalId || t.missionId) continue;
      const w = t.createdAt;
      if (!w) continue;
      const ageDays = Math.floor((now.getTime() - new Date(w).getTime()) / 86_400_000);
      if (ageDays >= 3) {
        warnings.push({
          kind: "orphan-task",
          severity: "low",
          label: t.title,
          sub: `${ageDays}d · no goal · no project`,
          taskId: t.id,
        });
      }
    }
    // Stale promises (overdue + still active)
    for (const t of active) {
      if (t.loopKind !== "PROMISE") continue;
      if (!t.dueDate) continue;
      const overdueDays = Math.floor(
        (now.getTime() - new Date(t.dueDate).getTime()) / 86_400_000,
      );
      if (overdueDays > 0) {
        warnings.push({
          kind: "stale-promise",
          severity: overdueDays >= 7 ? "high" : "med",
          label: t.title,
          sub: `${overdueDays}d overdue · @${t.promiseTo ?? "—"}`,
          taskId: t.id,
        });
      }
    }
    // Sort: high → med → low, stable within
    warnings.sort((a, b) => {
      const sev: Record<string, number> = { high: 0, med: 1, low: 2 };
      return sev[a.severity] - sev[b.severity];
    });

    // ── Routine 30-day heatmap ──
    // Each DAILY task gets a 30-element array (1 = completed that
    // day, 0 = missed). We approximate "completed that day" from the
    // task's lastCompletedAt + streakCount (best-effort without
    // pulling TaskEvent log per task — keeps this client-side fast).
    const routineGrid = daily.slice(0, 8).map((t) => {
      const cells: number[] = new Array(30).fill(0);
      const last = t.lastCompletedAt ? new Date(t.lastCompletedAt) : null;
      if (last) {
        const lastDayStart = new Date(last.getFullYear(), last.getMonth(), last.getDate());
        const daysAgo = Math.floor((todayStart.getTime() - lastDayStart.getTime()) / 86_400_000);
        // mark the streak window. streakCount represents consecutive
        // days. We paint backward from lastCompletedAt.
        const streak = t.streakCount ?? 0;
        for (let i = 0; i < streak; i++) {
          const cellIdx = 29 - daysAgo - i;
          if (cellIdx >= 0 && cellIdx < 30) cells[cellIdx] = 1;
        }
      }
      return { task: t, cells };
    });

    // ── Domain distribution (kept) ──
    const domainCounts: Record<string, number> = {};
    for (const t of active) {
      const dom = t.mission?.domain?.toLowerCase() || "other";
      domainCounts[dom] = (domainCounts[dom] || 0) + 1;
    }
    const domainEntries = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);

    // Keep rate (PROMISE) — kept from old TRACK
    const kept = promiseAll.filter((t) => t.status === "DONE").length;
    const broken = promiseAll.filter((t) => t.status === "ARCHIVED").length;
    const keepRate = kept + broken > 0 ? Math.round((kept / (kept + broken)) * 100) : null;

    return {
      doneToday,
      activeCount: active.length,
      doingCount: doing.length,
      overdueCount: overdue.length,
      topStreak,
      buckets14,
      // weekly delta
      thisWkDone: thisWkDone.length,
      prevWkDone: prevWkDone.length,
      doneDelta: delta(thisWkDone.length, prevWkDone.length),
      goalLiftDelta: delta(thisWkGoalLifting, prevWkGoalLifting),
      promKeptDelta: delta(thisWkPromKept, prevWkPromKept),
      minutesDelta: delta(thisWkMinutes, prevWkMinutes),
      thisWkGoalLifting,
      thisWkMinutes,
      // boards
      goalRows,
      projectRows,
      warnings,
      routineGrid,
      domainEntries,
      totalActive: active.length || 1,
      keepRate,
    };
  }, [tasks, goals, projects]);

  // ── Story footer — AI summary fetch ──
  // actions-surface slice · migrated off `authedFetch("/api/ai/track-
  // story")` onto `trpc.ai.trackStory`. The weekly counters are
  // aggregated client-side (kept cheap) and sent as the strict typed
  // input. Failure is swallowed — the story is non-essential.
  const fetchStory = useCallback(async () => {
    setStoryLoading(true);
    try {
      const d = await trackStoryMut.mutateAsync({
        doneToday: stats.doneToday,
        thisWkDone: stats.thisWkDone,
        prevWkDone: stats.prevWkDone,
        warningCount: stats.warnings.length,
        goalCount: stats.goalRows.length,
        projectCount: stats.projectRows.length,
        coldProjects: stats.projectRows.filter(
          (p) =>
            p.momentum.momentum === "cold" ||
            p.momentum.momentum === "dead",
        ).length,
        behindGoals: stats.goalRows.filter(
          (g) => g.verdict.kind === "behind" || g.verdict.kind === "missed",
        ).length,
        topStreak: stats.topStreak,
      });
      setStory(d.story ?? null);
    } catch {
      // silent — story is non-essential
    } finally {
      setStoryLoading(false);
    }
  }, [stats, trackStoryMut]);

  useEffect(() => {
    if (!loading && tasks.length > 0 && !story) {
      void fetchStory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tasks.length]);

  // ── Per-warning actions ──
  const handleWarningKill = async (taskId: string) => {
    try {
      await updateTask.mutateAsync({ id: taskId, fields: { status: "ARCHIVED" } });
      toast.success("dropped");
      notifyDataChanged("tasks", { source: "track:warnings", detail: "kill", id: taskId });
    } catch {
      toast.error("couldn't drop it");
    }
  };

  const handleGoalArchive = async (goalId: string) => {
    try {
      await goalsUpdate.mutateAsync({ id: goalId, status: "paused" });
      toast.success("Goal paused");
      notifyDataChanged("goals", { source: "track:warnings", detail: "pause", id: goalId });
    } catch {
      toast.error("Couldn't pause goal");
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <ShimmerSkeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ═══════════════════════════════════════════════════════
          1. TODAY'S PULSE
          The single banner Nour sees first. Done · open · late ·
          DOING · top streak. Sparkline of last 14 days.
          Inline "RUN WEEKLY REVIEW" CTA when there are warnings.
         ═══════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-[var(--gold)]/30 bg-gradient-to-br from-[var(--gold)]/10 via-zinc-900/60 to-zinc-900/40 p-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity size={11} className="text-[var(--gold)]" />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/80">
                today
              </span>
              {/* v10.0.529.74 · Wave 20 · explain the streak number */}
              <TipChip tip={LEARN_TIPS.trends_streak} title="streak" size="xs" />
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <div>
                <span className="text-2xl font-bold text-emerald-400 font-mono">
                  {stats.doneToday}
                </span>
                <span className="text-[10px] text-zinc-500 ml-1">done</span>
              </div>
              <div>
                <span className="text-lg font-bold text-amber-400 font-mono">
                  {stats.activeCount}
                </span>
                <span className="text-[10px] text-zinc-500 ml-1">open</span>
              </div>
              {stats.overdueCount > 0 && (
                <div>
                  <span className="text-lg font-bold text-rose-400 font-mono">
                    {stats.overdueCount}
                  </span>
                  <span className="text-[10px] text-zinc-500 ml-1">late</span>
                </div>
              )}
              {stats.doingCount > 0 && (
                <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 text-[9px] font-mono uppercase">
                  <span className="h-1 w-1 rounded-full bg-blue-400 animate-pulse" />
                  {stats.doingCount} in flight
                </div>
              )}
              {stats.topStreak > 0 && (
                <div className="inline-flex items-center gap-1 text-[10px]">
                  <Flame size={10} className="text-amber-400" />
                  <span className="font-mono text-amber-400 font-bold">
                    {stats.topStreak}d
                  </span>
                  <span className="text-zinc-500">streak</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Sparkline
              data={stats.buckets14}
              width={140}
              height={32}
              color="rgb(52 211 153)"
              showDot={false}
              animate={false}
            />
            {/* v10.0.529.74 · Wave 20 · explain the sparkline */}
            <TipChip tip={LEARN_TIPS.trends_sparkline} title="14-day done" size="xs" />
          </div>
        </div>
        {stats.warnings.length > 0 && onOpenReview && (
          <button
            onClick={onOpenReview}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 hover:bg-amber-500/20"
          >
            <AlertTriangle size={11} />
            Run weekly review · {stats.warnings.length} ⚠️ to triage
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          2. WEEKLY DELTA
          This week vs last week across 4 dimensions. Quick "am I
          getting better or worse" read.
         ═══════════════════════════════════════════════════════ */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <RefreshCw size={11} className="text-blue-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            this week vs last week
          </span>
          {/* v10.0.529.74 · Wave 20 · explain promises kept rate */}
          <TipChip tip={LEARN_TIPS.trends_promise} title="promises kept" size="xs" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DeltaTile
            label="routines done"
            value={stats.thisWkDone}
            prev={stats.prevWkDone}
            delta={stats.doneDelta}
            unit=""
          />
          <DeltaTile
            label="goal-lifting work"
            value={stats.thisWkGoalLifting}
            prev={stats.thisWkGoalLifting - stats.goalLiftDelta.diff}
            delta={stats.goalLiftDelta}
            unit=""
            hint={
              stats.thisWkDone > 0
                ? `${Math.round((stats.thisWkGoalLifting / stats.thisWkDone) * 100)}% of work moved a goal`
                : undefined
            }
          />
          <DeltaTile
            label="promises kept"
            value={stats.promKeptDelta.diff + (stats.thisWkDone - stats.thisWkDone)}
            prev={0}
            delta={stats.promKeptDelta}
            unit=""
            hint={
              stats.keepRate !== null
                ? `lifetime keep rate: ${stats.keepRate}%`
                : undefined
            }
          />
          <DeltaTile
            label="time invested"
            value={stats.thisWkMinutes}
            prev={stats.thisWkMinutes - stats.minutesDelta.diff}
            delta={stats.minutesDelta}
            unit="min"
          />
        </div>
      </GlassCard>

      {/* ═══════════════════════════════════════════════════════
          3. GOAL PACE BOARD
          Every active goal as a row with progress bar + verdict +
          weekly delta + needs-X/day chip when behind.
         ═══════════════════════════════════════════════════════ */}
      {stats.goalRows.length > 0 && (
        <GlassCard className="p-3">
          <button
            onClick={() => onJumpMode?.("PLAN")}
            className="w-full flex items-center gap-1.5 mb-2 hover:text-violet-300 transition-colors"
          >
            <Target size={11} className="text-violet-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              Goal pace · {stats.goalRows.length}
            </span>
            {onJumpMode && (
              <span className="text-[8px] text-zinc-600 ml-auto uppercase">
                manage →
              </span>
            )}
          </button>
          <div className="space-y-1.5">
            {stats.goalRows.slice(0, 8).map(({ goal, verdict }) => {
              const tone =
                verdict.kind === "ahead"
                  ? "text-emerald-300"
                  : verdict.kind === "on-track"
                    ? "text-sky-300"
                    : verdict.kind === "behind" || verdict.kind === "needs"
                      ? "text-amber-300"
                      : verdict.kind === "missed"
                        ? "text-rose-300"
                        : "text-zinc-500";
              const barColor =
                verdict.kind === "ahead"
                  ? "bg-emerald-500/60"
                  : verdict.kind === "on-track"
                    ? "bg-sky-500/60"
                    : verdict.kind === "behind" || verdict.kind === "missed"
                      ? "bg-amber-500/60"
                      : "bg-zinc-700";
              return (
                <div key={goal.id} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-zinc-300 flex-1 truncate font-medium">
                      {goal.title}
                    </span>
                    <span className={cn("text-[9px] font-mono uppercase tracking-wider shrink-0", tone)}>
                      {paceLabelShort(verdict)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${Math.min(100, goal.progress)}%` }}
                      />
                    </div>
                    <span className="text-[8px] font-mono text-zinc-500 w-10 text-right shrink-0">
                      {goal.currentValue}/{goal.targetValue}
                    </span>
                  </div>
                  {(verdict.kind === "behind" || verdict.kind === "needs") && (
                    <p className="text-[8px] text-amber-400/70 italic font-mono">
                      → needs +
                      {verdict.kind === "needs"
                        ? formatRate(verdict.perDay)
                        : formatRate(verdict.needPerDay)}{" "}
                      {goal.unit || goal.metric || "/day"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          4. PROJECT BOARD
          Every active project with momentum + open/done counts.
          Cold/dead get tinted background.
         ═══════════════════════════════════════════════════════ */}
      {stats.projectRows.length > 0 && (
        <GlassCard className="p-3">
          <button
            onClick={() => onJumpMode?.("PLAN")}
            className="w-full flex items-center gap-1.5 mb-2 hover:text-blue-300 transition-colors"
          >
            <Trophy size={11} className="text-blue-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              Projects · {stats.projectRows.length}
            </span>
            {onJumpMode && (
              <span className="text-[8px] text-zinc-600 ml-auto uppercase">
                manage →
              </span>
            )}
          </button>
          <div className="space-y-1">
            {stats.projectRows.map(({ project, momentum, open, done, total, pct }) => {
              const tone = momentumTone(momentum.momentum);
              const isCold = momentum.momentum === "cold" || momentum.momentum === "dead";
              return (
                <div
                  key={project.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md border text-[10px]",
                    isCold
                      ? "border-rose-500/20 bg-rose-500/[0.03]"
                      : "border-zinc-800/40 bg-zinc-900/30",
                  )}
                >
                  <div className="relative w-7 h-7 shrink-0">
                    <svg viewBox="0 0 36 36" className="w-7 h-7 -rotate-90">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(39 39 42 / 0.4)" strokeWidth="3" />
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke={
                          pct >= 80
                            ? "rgb(52 211 153)"
                            : pct >= 40
                              ? "rgb(96 165 250)"
                              : "rgb(161 161 170)"
                        }
                        strokeWidth="3"
                        strokeDasharray={`${pct * 0.942} 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold font-mono text-zinc-400">
                      {pct}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-200 truncate font-medium">{project.title}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">
                      <span className="text-amber-400">{open}</span> open · {done}/{total}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",
                      tone.border,
                      tone.bg,
                      tone.text,
                      tone.pulse && "animate-pulse",
                    )}
                  >
                    {momentumLabel(momentum.momentum)}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          5. WARNING QUEUE  ⚠️
          Single ranked list of stale routines + decaying goals +
          cold projects + orphan tasks. Each row gets keep/kill
          buttons (and reframe via NOW jump for tasks).
         ═══════════════════════════════════════════════════════ */}
      {stats.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px]">⚠️</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Warnings · {stats.warnings.length}
              </span>
            </div>
            {onOpenReview && (
              <button
                onClick={onOpenReview}
                className="text-[8px] text-amber-400/80 hover:text-amber-300 uppercase tracking-wider font-bold"
              >
                triage all →
              </button>
            )}
          </div>
          <div className="space-y-1">
            {stats.warnings.slice(0, 12).map((w, i) => {
              const sevColor =
                w.severity === "high"
                  ? "border-rose-500/40 bg-rose-500/5"
                  : w.severity === "med"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-zinc-700/40 bg-zinc-900/30";
              const kindLabel =
                w.kind === "stale-task"
                  ? "stale routine"
                  : w.kind === "decaying-goal"
                    ? "decaying goal"
                    : w.kind === "cold-project"
                      ? "cold project"
                      : w.kind === "orphan-task"
                        ? "orphan"
                        : "stale promise";
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 px-2 py-1.5 rounded border text-[10px]",
                    sevColor,
                  )}
                >
                  <span className="text-[7px] font-mono uppercase tracking-wider text-zinc-600 shrink-0 w-16 mt-0.5">
                    {kindLabel}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-200 truncate font-medium">{w.label}</p>
                    {w.sub && (
                      <p className="text-[8px] text-zinc-500 italic">{w.sub}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {w.taskId && (
                      <>
                        {/* v10.0.529.84 · Wave 28 · C3 · "fix" button now
                            jumps to NOW AND scroll-flashes the matching
                            task row · uses the existing CustomEvent +
                            ring-2 pattern from page.tsx onJumpToTask. */}
                        <button
                          onClick={() => {
                            onJumpMode?.("NOW");
                            try {
                              localStorage.setItem("nour:kommando:mode", "NOW");
                            } catch {}
                            window.dispatchEvent(
                              new CustomEvent("nour:kommando:set-mode", { detail: "NOW" }),
                            );
                            setTimeout(() => {
                              const el = document.getElementById(`task-row-${w.taskId}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "center" });
                                el.classList.add("ring-2", "ring-amber-400/60");
                                setTimeout(
                                  () => el.classList.remove("ring-2", "ring-amber-400/60"),
                                  2000,
                                );
                              }
                            }, 100);
                          }}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:border-amber-400/60 hover:text-amber-300 transition-colors"
                          title="jump to this task in today"
                        >
                          fix
                        </button>
                        <button
                          onClick={() => void handleWarningKill(w.taskId!)}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                        >
                          kill
                        </button>
                      </>
                    )}
                    {w.goalId && (
                      <>
                        <button
                          onClick={() => onJumpMode?.("PLAN")}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                        >
                          fix
                        </button>
                        <button
                          onClick={() => void handleGoalArchive(w.goalId!)}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                        >
                          pause
                        </button>
                      </>
                    )}
                    {w.projectId && (
                      <button
                        onClick={() => onJumpMode?.("PLAN")}
                        className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                      >
                        review
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {stats.warnings.length > 12 && (
              <p className="text-[8px] text-zinc-600 italic text-center pt-1">
                + {stats.warnings.length - 12} more — run review to triage all
              </p>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          6. ROUTINE HEATMAP
          DAILY routines · 30-day grid. Each cell = one day; green
          = completed, dim = missed.
         ═══════════════════════════════════════════════════════ */}
      {stats.routineGrid.length > 0 && (
        <GlassCard className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Flame size={11} className="text-amber-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              Routines · 30-day rhythm
            </span>
          </div>
          <div className="space-y-1">
            {stats.routineGrid.map(({ task, cells }) => (
              <div key={task.id} className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-400 truncate w-32 shrink-0">
                  {task.title}
                </span>
                <div className="flex-1 grid grid-cols-30 gap-[2px]" style={{ gridTemplateColumns: "repeat(30, minmax(0, 1fr))" }}>
                  {cells.map((c, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-3 rounded-sm",
                        c === 1 ? "bg-amber-500/70" : "bg-zinc-800/50",
                      )}
                      title={`${30 - i}d ago${c === 1 ? " · done" : ""}`}
                    />
                  ))}
                </div>
                {(task.streakCount ?? 0) > 0 && (
                  <span className="text-[9px] font-mono text-amber-400 shrink-0">
                    🔥{task.streakCount}
                  </span>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          7. DOMAIN DISTRIBUTION (kept from old TRACK)
         ═══════════════════════════════════════════════════════ */}
      {stats.domainEntries.length > 0 && (
        <GlassCard className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Target size={11} className="text-blue-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              Where focus lives
            </span>
          </div>
          <div className="space-y-1.5">
            {stats.domainEntries.map(([dom, count]) => {
              const pct = Math.round((count / stats.totalActive) * 100);
              return (
                <div key={dom} className="flex items-center gap-2 text-[10px]">
                  <Badge className={cn("h-4 text-[8px] border-0 shrink-0 w-20 justify-center", domainClass(dom))}>
                    {dom}
                  </Badge>
                  <div className="flex-1 h-1.5 bg-zinc-800/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500/60 to-blue-400/60 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-zinc-500 font-mono w-12 text-right shrink-0">
                    {count} · {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          8. STORY FOOTER
          AI 1-paragraph weekly summary. Loads on first render,
          regen via the refresh button.
         ═══════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-violet-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300">
              The story this week
            </span>
          </div>
          <button
            onClick={() => void fetchStory()}
            disabled={storyLoading}
            className="text-zinc-600 hover:text-violet-300 disabled:opacity-50"
            title="Regenerate"
          >
            {storyLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={10} />}
          </button>
        </div>
        {storyLoading && !story ? (
          <p className="text-[10px] text-zinc-600 italic">Nick is reading the room…</p>
        ) : story ? (
          <p className="text-[11px] text-zinc-300 leading-relaxed italic">{story}</p>
        ) : (
          <p className="text-[10px] text-zinc-600 italic">
            Tap regenerate to get Nick&apos;s read on the week.
          </p>
        )}
      </div>

      {/* Empty state if there's literally nothing tracked */}
      {tasks.length === 0 && goals.length === 0 && projects.length === 0 && (
        <GlassCard className="p-6 text-center">
          <p className="text-[11px] text-zinc-500 italic">
            Nothing to track yet. Add a routine on NOW or a goal on PLAN.
          </p>
        </GlassCard>
      )}
    </div>
  );
}

// ─── DeltaTile ──────────────────────────────────────────────────────
// Small cell for the weekly delta panel. Color codes the trend:
// green (better), amber (worse), zinc (flat). Always shows the raw
// number + a +/- delta below.

function DeltaTile({
  label,
  value,
  prev: _prev,
  delta,
  unit,
  hint,
}: {
  label: string;
  value: number;
  prev: number;
  delta: { diff: number; pct: number | null };
  unit: string;
  hint?: string;
}) {
  const trend =
    delta.diff > 0 ? "up" : delta.diff < 0 ? "down" : "flat";
  const tone =
    trend === "up"
      ? "text-emerald-400"
      : trend === "down"
        ? "text-amber-400"
        : "text-zinc-500";
  return (
    <div className="rounded-md border border-zinc-800/40 bg-zinc-900/30 px-2 py-1.5">
      <p className="text-[8px] text-zinc-600 uppercase tracking-wider">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-base font-bold text-zinc-200 font-mono">
          {value}
          {unit && <span className="text-[8px] text-zinc-600 ml-0.5">{unit}</span>}
        </span>
        {trend !== "flat" && (
          <span className={cn("text-[9px] font-mono", tone)}>
            {trend === "up" ? <TrendingUp size={9} className="inline -mt-0.5" /> : <TrendingDown size={9} className="inline -mt-0.5" />}
            {delta.diff > 0 ? "+" : ""}
            {delta.diff}
            {delta.pct !== null && Math.abs(delta.pct) < 1000 && (
              <span className="opacity-70"> ({delta.pct > 0 ? "+" : ""}{delta.pct}%)</span>
            )}
          </span>
        )}
      </div>
      {hint && <p className="text-[8px] text-zinc-600 italic mt-0.5">{hint}</p>}
    </div>
  );
}

// Suppress lint for unused imports/types — kept for future inline usage.
void CheckCircle2;
void Circle;
void Handshake;
void Clock;
