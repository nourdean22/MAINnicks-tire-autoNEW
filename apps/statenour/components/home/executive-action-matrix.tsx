"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ArrowRight, ShieldAlert, Zap, Target, CheckCircle2, Inbox, Sparkles } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"triage" | "hygiene" | "suggestions">("triage");
  const [movesCount, setMovesCount] = useState(0);

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

  // 2. Synthesize Executive Summary
  const summary = useMemo(() => {
    if (tasksQuery.isLoading || ccStateQuery.isLoading) return null;

    const activeTaskId = ccStateQuery.data?.commands?.active?.id;
    const doingTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;
    
    let modeLabel = "System Planning";
    let modeColor = "text-[var(--text-tertiary)] border-[var(--border-default)] bg-[var(--bg-base)]/40";
    let modeIcon = Target;

    if (doingTask) {
      modeLabel = "Execution Mode";
      modeColor = "text-[var(--gold)] border-[var(--gold)]/30 bg-[var(--gold)]/5";
      modeIcon = Zap;
    } else if (activeTasks.length > 0) {
      modeLabel = "Strategic Progress";
      modeColor = "text-cyan-400 border-cyan-500/30 bg-cyan-500/5";
      modeIcon = Target;
    }

    const nextRep = stats.length > 0 
      ? stats.reduce<StatLevel | null>((best, x) => (x.progressPct > (best?.progressPct ?? 0) ? x : best), null)
      : null;

    const completedToday = tasks.filter(
      (t) => t.status === "DONE" && t.lastCompletedAt && new Date(t.lastCompletedAt).toDateString() === new Date().toDateString()
    ).length;

    return {
      mode: { label: modeLabel, color: modeColor, Icon: modeIcon },
      doingTask,
      nextRep,
      completedToday,
      criticalFew: nextMoveQuery.data?.criticalFew || [],
    };
  }, [tasks, stats, ccStateQuery.data, nextMoveQuery.data, tasksQuery.isLoading, ccStateQuery.isLoading, activeTasks.length]);

  if (!summary) {
    return <div className="h-48 rounded-xl border border-[var(--gold)]/10 bg-black/40 animate-pulse" aria-hidden />;
  }

  const { mode, doingTask, nextRep, completedToday, criticalFew } = summary;

  return (
    <div className="glass-card relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-[var(--gold)]/10 rounded-xl p-0 shadow-2xl animate-fade-in-scale">
      {/* Background radial accent glow for premium look */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-48 bg-[var(--gold)]/5 rounded-full blur-[80px] pointer-events-none" />

      {/* Top Header Row */}
      <div className="relative px-5 py-3 border-b border-[var(--gold)]/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-[var(--gold)]">
            Executive Matrix
          </h2>
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border text-[9px] font-mono uppercase tracking-widest",
            mode.color
          )}>
            <mode.Icon size={10} className="pulse-live" />
            {mode.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {inboxCount > 0 && (
            <span className="text-[10px] font-mono text-amber-500/80 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              {inboxCount} Triage
            </span>
          )}
          {findingsCount > 0 && (
            <span className="text-[10px] font-mono text-rose-500/80 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
              {findingsCount} Drift
            </span>
          )}
        </div>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--gold)]/10">
        
        {/* Left Side: Strategic Execution */}
        <div className="p-5 space-y-5">
          <div className="space-y-3">
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-tertiary)] flex justify-between items-center">
              <span>Tactical Execution</span>
              {doingTask && <span className="text-[var(--gold)] animate-pulse">ACTIVE REP</span>}
            </h3>
            
            {doingTask ? (
              <Link 
                href={`/missions#task-${doingTask.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/5 hover:bg-[var(--gold)]/10 transition group"
              >
                <div className="space-y-1">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--gold)]/80">Executing Now</span>
                  <p className="text-[13px] font-semibold text-white/90 leading-snug">{doingTask.title}</p>
                </div>
                <ArrowRight size={14} className="text-[var(--gold)] opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </Link>
            ) : criticalFew.length > 0 ? (
              <div className="space-y-2">
                {criticalFew.slice(0, 3).map((task) => (
                  <Link
                    key={task.id}
                    href={`/missions#task-${task.id}`}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-white/5 bg-white/[0.01] hover:border-[var(--gold)]/30 hover:bg-white/[0.03] transition group"
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <p className="text-xs font-medium text-white/85 truncate group-hover:text-white transition-colors">
                        {task.title}
                      </p>
                    </div>
                    <ArrowRight size={12} className="text-[var(--gold)] shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg border border-dashed border-white/10 text-center">
                <span className="text-xs text-white/40">No immediate targets identified.</span>
              </div>
            )}
          </div>

          {/* Stat Progression / Proof */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {nextRep ? (
              <Link href="/stats" className="p-3 rounded-lg border border-white/5 bg-black/20 hover:border-[var(--gold)]/30 transition group">
                <span className="text-[9px] font-mono uppercase tracking-wider text-white/40 block mb-1">Target Stat</span>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm">{nextRep.icon}</span>
                  <span className="text-[11px] font-semibold text-white/90 truncate">{nextRep.shortLabel || nextRep.label}</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${nextRep.progressPct}%`, backgroundColor: nextRep.color }} />
                </div>
              </Link>
            ) : <div />}

            <Link href="/journal" className="p-3 rounded-lg border border-white/5 bg-black/20 hover:border-[var(--gold)]/30 transition group flex flex-col justify-between">
              <span className="text-[9px] font-mono uppercase tracking-wider text-white/40 block mb-1">Daily Proof</span>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className={cn(completedToday > 0 ? "text-emerald-400" : "text-white/30")} />
                <span className="text-[11px] font-medium text-white/80">{completedToday} loops closed</span>
              </div>
            </Link>
          </div>
        </div>

        {/* Right Side: Operational Triage */}
        <div className="p-5 flex flex-col bg-black/20">
          <div className="flex items-center gap-2 border-b border-[var(--gold)]/10 pb-3 mb-4">
            <button onClick={() => setActiveTab("triage")} className={cn("text-[9px] font-mono uppercase tracking-widest px-2.5 py-1.5 rounded transition", activeTab === "triage" ? "bg-[var(--gold)]/10 text-[var(--gold)] border border-[var(--gold)]/20" : "text-white/40 hover:text-white/70")}>Triage ({inboxCount})</button>
            <button onClick={() => setActiveTab("hygiene")} className={cn("text-[9px] font-mono uppercase tracking-widest px-2.5 py-1.5 rounded transition", activeTab === "hygiene" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : "text-white/40 hover:text-white/70")}>Drift ({findingsCount})</button>
            <button onClick={() => setActiveTab("suggestions")} className={cn("text-[9px] font-mono uppercase tracking-widest px-2.5 py-1.5 rounded transition", activeTab === "suggestions" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "text-white/40 hover:text-white/70")}>AI Ops (Projected: {movesCount})</button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[300px] scrollbar-thin">
            {activeTab === "triage" && (
              inboxCount > 0 ? <InboxTasksTriage isNested /> : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-60">
                  <Inbox size={20} className="text-[var(--gold)]/50" />
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--gold)]">Inbox Clear</p>
                </div>
              )
            )}
            {activeTab === "hygiene" && (
              findingsCount > 0 ? <InboxTriageCard isNested /> : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-60">
                  <ShieldAlert size={20} className="text-emerald-500/50" />
                  <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-500">Systems Nominal</p>
                </div>
              )
            )}
            {activeTab === "suggestions" && (
              movesCount > 0 ? <HomeOneTapMoves isNested /> : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-60">
                  <Sparkles size={20} className="text-[var(--gold)]/50" />
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--gold)]">Cache Exhausted</p>
                </div>
              )
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
