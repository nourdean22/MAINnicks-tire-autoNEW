"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ArrowRight, ShieldAlert, Zap, Target, CheckCircle2, Inbox, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { InboxTasksTriage } from "./inbox-tasks-triage";
import { InboxTriageCard } from "./inbox-triage-card";
import { HomeOneTapMoves } from "./home-one-tap-moves";
import type { Task } from "@/components/actions/shared";

interface StatLevel {
  key: string;
  label: string;
  shortLabel?: string;
  icon: string;
  color: string;
  progressPct: number;
  level: number;
  xpForNext: number;
  xpIntoLevel: number;
}

const EMPTY_TASKS: Task[] = [];
const EMPTY_STATS: StatLevel[] = [];

export function ExecutiveActionMatrix() {
  const [movesCount, setMovesCount] = useState(0);
  // BDN-104 · decision sensor (fire-and-forget).
  const signal = trpc.operator.recordHomeSignal.useMutation();

  // 1. Core Data
  const tasksQuery = trpc.task.list.useQuery({}, { refetchOnWindowFocus: false });
  const statsQuery = trpc.operator.characterSheet.useQuery(undefined, { staleTime: 60_000 });
  const nextMoveQuery = trpc.task.nextMove.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });
  const ccStateQuery = trpc.operator.commandCenterState.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const { data: hygieneData } = trpc.task.missionsHygiene.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const tasks = (tasksQuery.data ?? EMPTY_TASKS) as Task[];
  const stats = (statsQuery.data ?? EMPTY_STATS) as StatLevel[];
  const findingsCount = hygieneData?.rescue?.findings?.length ?? 0;
  const activeTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
  const inboxCount = activeTasks.filter((t) => t.status === "INBOX").length;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/home-moves", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { moves?: unknown[] };
        if (!cancelled) setMovesCount(data.moves?.length ?? 0);
      } catch {
        // Fallback silently
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // BDN-001 · RESUME cue. A task sitting at DOING that is NOT the
  // command-center's active engagement is an interrupted open loop — the
  // most valuable "now" when nothing is actively executing. Uses the
  // already-fetched task list; newest touch first.
  const activeCmdId = ccStateQuery.data?.commands?.active?.id;
  // Clock reference for the resume floor: the moment the task list was
  // fetched — pure per render (react-hooks/purity forbids Date.now() in
  // the memo), and it advances exactly when the data it judges advances.
  const tasksFetchedAt = tasksQuery.dataUpdatedAt;
  const resumeTask = useMemo(() => {
    // Ignore tasks that entered DOING in the last 2 minutes: a
    // seconds-old task isn't an "open loop from earlier" semantically,
    // and commandCenterState sits behind a 15s server cache + 30s client
    // staleTime, so a freshly-started task can appear in `tasks` before
    // it registers as the active engagement — without this floor it
    // would transiently mislabel as RESUME.
    const RESUME_MIN_AGE_MS = 2 * 60_000;
    const loops = tasks.filter((t) => {
      if (t.status !== "DOING" || t.id === activeCmdId) return false;
      const enteredDoing = new Date(t.startedAt ?? t.updatedAt ?? 0).getTime();
      return tasksFetchedAt - enteredDoing > RESUME_MIN_AGE_MS;
    });
    if (loops.length === 0) return null;
    return [...loops].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  }, [tasks, activeCmdId, tasksFetchedAt]);

  // 2. Synthesize AI Operator Briefing (200 IQ Pass)
  const aiBriefing = useMemo(() => {
    if (tasksQuery.isLoading || ccStateQuery.isLoading || nextMoveQuery.isLoading) {
      return { status: "loading", title: "ANALYZING...", message: "Calculating asymmetric leverage...", actionType: "loading", color: "text-[var(--text-tertiary)]" };
    }

    // Unknown-is-not-zero (2026-08-19): a failed read used to fall
    // through to the calm/suggestions branches and render as a clear
    // board — indistinguishable from genuinely having nothing to do.
    // An instrument fault must say so. Round-2 (TanStack v5 doctrine):
    // hard-unreadable only on FIRST-LOAD failure (`isError && !data`);
    // a failed background refetch keeps the cached board and gets the
    // compact "refresh failed" badge below instead of nuking the UI.
    if (
      (tasksQuery.isError && !tasksQuery.data) ||
      (ccStateQuery.isError && !ccStateQuery.data) ||
      (nextMoveQuery.isError && !nextMoveQuery.data)
    ) {
      return {
        status: "error",
        title: "BOARD UNREADABLE",
        message: "One or more reads failed — this is an instrument fault, not a clear board. The numbers below may be incomplete.",
        actionType: "error",
        color: "text-rose-400",
      };
    }

    const activeTaskId = ccStateQuery.data?.commands?.active?.id;
    const doingTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;
    const criticalFew = nextMoveQuery.data?.criticalFew || [];

    if (doingTask) {
      return {
        status: "executing",
        title: "ACTIVE ENGAGEMENT",
        message: `Nour, you are currently executing [${doingTask.title}]. Maintain focus and close the loop. Do not context switch until completion.`,
        actionType: "execute",
        color: "text-[var(--gold)]"
      };
    }

    // BDN-001 · resume outranks new targets: finish what is in motion
    // before fragmenting attention onto new work.
    if (resumeTask) {
      return {
        status: "resume",
        title: "RESUME OPEN LOOP",
        message: `Nour, [${resumeTask.title}] is still marked DOING from earlier. Close that loop — finish it or consciously park it — before opening a new one.`,
        actionType: "resume",
        color: "text-[var(--gold)]"
      };
    }

    // 2026-07-25 honest-copy fix (audit P1): this used to say "Halt
    // revenue operations" over 3 hygiene findings — theatrical advice
    // no measurement supports. State the count, suggest the action,
    // let the operator weigh it.
    if (findingsCount >= 3) {
      return {
        status: "warning",
        title: "HYGIENE QUEUE BUILDING",
        message: `${findingsCount} hygiene findings are waiting. They compound quietly — clear them in your next gap.`,
        actionType: "hygiene",
        color: "text-amber-400"
      };
    }

    if (inboxCount >= 7) {
      return {
        status: "warning",
        title: "INBOX OVERFLOW",
        message: `Nour, you are bleeding leverage. Your inbox has ${inboxCount} unclassified raw items. Unprocessed material creates cognitive drag. Triage now to reveal hidden bottlenecks.`,
        actionType: "triage",
        color: "text-amber-400"
      };
    }

    if (criticalFew.length > 0) {
      const target = criticalFew[0];
      return {
        status: "nominal",
        title: "SYSTEMS NOMINAL",
        message: `Hygiene is clear. The Focus Lane is open. The highest leverage asymmetric move is to execute [${target.title}] (Expected ROI: ~${target.roiScore} est.). *(Projected calculation, unverified hypothesis)*.`,
        actionType: "execute",
        color: "text-cyan-400"
      };
    }

    // 2026-07-25 honest-copy fix (audit P1): "peak operational
    // efficiency" was fabricated — no targets returned is an ABSENCE of
    // signal, not proof of efficiency. Say what is actually known.
    return {
      status: "idle",
      title: "ALL QUEUES CLEAR",
      message: `Nothing is waiting and no immediate targets came back. Pick a direction, or ask Nick for options.`,
      actionType: "suggestions",
      color: "text-emerald-400"
    };
  }, [tasks, findingsCount, inboxCount, resumeTask, ccStateQuery.data, nextMoveQuery.data, tasksQuery.data, tasksQuery.isLoading, ccStateQuery.isLoading, nextMoveQuery.isLoading, tasksQuery.isError, ccStateQuery.isError, nextMoveQuery.isError]);

  // Failed refetch with a cached board: keep rendering the data, say the
  // refresh failed — never silently show stale numbers as fresh.
  const refreshFailed =
    (tasksQuery.isError && !!tasksQuery.data) ||
    (ccStateQuery.isError && !!ccStateQuery.data) ||
    (nextMoveQuery.isError && !!nextMoveQuery.data);

  // 3. Execution Engine UI
  const completedToday = tasks.filter(
    (t) => t.status === "DONE" && t.lastCompletedAt && new Date(t.lastCompletedAt).toDateString() === new Date().toDateString()
  ).length;

  if (aiBriefing.status === "loading") {
    return <div className="h-48 rounded-xl border border-[var(--gold)]/10 bg-black/40 animate-pulse" aria-hidden />;
  }

  const criticalFew = nextMoveQuery.data?.criticalFew || [];

  return (
    <div className="glass-card relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-[var(--gold)]/10 rounded-xl p-0 shadow-2xl animate-fade-in-scale flex flex-col">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-48 bg-[var(--gold)]/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Header Row - The AI Briefing */}
      <div className="relative p-6 border-b border-[var(--gold)]/15 bg-black/40 space-y-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Sparkles size={14} className={cn("pulse-live", aiBriefing.color)} />
          <h2 className={cn("text-xs font-mono uppercase tracking-[0.2em]", aiBriefing.color)}>
            {aiBriefing.title}
          </h2>
        </div>
        <p className="text-[13px] leading-relaxed text-white/80 font-medium max-w-2xl">
          {aiBriefing.message}
        </p>
        {refreshFailed && (
          <p className="text-[9px] font-mono uppercase tracking-wider text-rose-300/80">
            refresh failed · showing last confirmed board
          </p>
        )}
      </div>

      <div className="relative flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-[var(--gold)]/10">
        
        {/* Left Side: Strategic Targets */}
        <div className="p-6 space-y-6 lg:w-1/2 flex flex-col bg-black/10">
          <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]/70">
            Asymmetric Targets (Highest Leverage)
          </h3>
          
          <div className="flex-1 space-y-2">
            {nextMoveQuery.isError && !nextMoveQuery.data ? (
              <div className="p-6 rounded-xl border border-dashed border-rose-500/30 bg-rose-500/[0.04] text-center flex flex-col items-center gap-3 shadow-inner">
                <Target size={18} className="text-rose-400/50" />
                <span className="text-[11px] font-medium text-rose-300/80 uppercase tracking-widest font-mono">Targets unreadable — state unknown, not empty</span>
              </div>
            ) : criticalFew.length > 0 ? (
              criticalFew.slice(0, 3).map((task) => (
                <Link
                  key={task.id}
                  href={`/missions#task-${task.id}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.01] hover:border-[var(--gold)]/30 hover:bg-white/[0.03] transition group"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <p className="text-xs font-medium text-white/90 truncate group-hover:text-white transition-colors">
                      {task.title}
                    </p>
                    <span className="text-[9px] font-mono uppercase text-[var(--text-tertiary)]">{task.lane} lane • roi: {task.roiScore}</span>
                  </div>
                  <ArrowRight size={14} className="text-[var(--gold)] shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </Link>
              ))
            ) : (
              <div className="p-6 rounded-xl border border-dashed border-white/10 bg-black/20 text-center flex flex-col items-center gap-3 shadow-inner">
                <Target size={18} className="text-white/20" />
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-widest font-mono">No Immediate Targets Identified</span>
              </div>
            )}
          </div>

          {/* Daily Execution Proof */}
          <Link href="/journal" className="p-4 rounded-xl border border-white/5 bg-black/40 hover:border-[var(--gold)]/40 hover:bg-black/60 transition-all duration-300 group flex items-center justify-between shadow-lg">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--gold)]/60 group-hover:text-[var(--gold)]/90 transition-colors">Daily Compounding Proof</span>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className={cn(completedToday > 0 ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "text-white/20")} />
              <span className="text-xs font-semibold text-white/90">{completedToday} loops closed</span>
            </div>
          </Link>
        </div>

        {/* Right Side: Tactical Queue (Dynamic based on AI Briefing) */}
        <div className="p-6 bg-gradient-to-b from-black/40 to-black/20 lg:w-1/2 flex flex-col shadow-inner">
          <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]/70 mb-4 flex items-center gap-2">
            <Zap size={12} className="text-[var(--gold)]" />
            Tactical Execution Queue
          </h3>

          <div className="flex-1 overflow-y-auto max-h-[300px] scrollbar-thin">
            {aiBriefing.actionType === "resume" && resumeTask && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-90 py-12">
                <div className="p-4 rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/30">
                  <RotateCcw size={28} className="text-[var(--gold)] drop-shadow-[0_0_12px_rgba(255,215,0,0.3)]" />
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--gold)]">Open loop from earlier</p>
                  <Link
                    href={`/missions#task-${resumeTask.id}`}
                    // BDN-104 · resume taps have no server trace of their
                    // own (the tap is a navigation, not a mutation), so
                    // this is the only place the resume rate can be seen.
                    onClick={() => signal.mutate({ kind: "resume_tap" })}
                    className="inline-flex items-center gap-2 text-xs font-medium text-white/90 hover:text-white border border-[var(--gold)]/20 hover:border-[var(--gold)]/50 rounded-lg px-3 py-2 transition"
                  >
                    Resume [{resumeTask.title}]
                    <ArrowRight size={12} className="text-[var(--gold)]" />
                  </Link>
                </div>
              </div>
            )}
            {aiBriefing.actionType === "hygiene" && <InboxTriageCard isNested />}
            {aiBriefing.actionType === "triage" && <InboxTasksTriage isNested />}
            {aiBriefing.actionType === "execute" && (
               <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-90 py-12">
                 <div className="p-4 rounded-full bg-cyan-950/30 border border-cyan-900/50">
                   <Zap size={28} className="text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.4)]" />
                 </div>
                 <div className="space-y-1">
                   <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-cyan-400">Hygiene & Triage Complete</p>
                   <p className="text-xs text-white/50">Proceed directly to strategic targets.</p>
                 </div>
               </div>
            )}
            {aiBriefing.actionType === "suggestions" && <HomeOneTapMoves isNested />}
          </div>
        </div>

      </div>
    </div>
  );
}
