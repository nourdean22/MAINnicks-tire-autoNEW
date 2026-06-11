"use client";

import { useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ArrowRight, Flame, ShieldAlert, Zap, Target, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/components/actions/shared";
import type { CriticalFewTask } from "@/lib/services/next-move";

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

export function HomeCommandStack() {
  const tasksQuery = trpc.task.list.useQuery({}, { refetchOnWindowFocus: false });
  const statsQuery = trpc.operator.characterSheet.useQuery(undefined, { staleTime: 60_000 });
  const journalActionQuery = trpc.journal.latestNextAction.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const nextMoveQuery = trpc.task.nextMove.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const tasks = (tasksQuery.data ?? []) as Task[];
  const stats = (statsQuery.data ?? []) as StatLevel[];
  const journalAction = journalActionQuery.data;

  const summary = useMemo(() => {
    if (tasksQuery.isLoading || statsQuery.isLoading || nextMoveQuery.isLoading) return null;

    // 1. Compute Mode
    const doingTask = tasks.find((t) => t.status === "DOING");
    const activeTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
    
    let modeLabel = "Calm System Planning";
    let modeDesc = "Triage inbox & capture reflections";
    let modeColor = "text-zinc-400 border-zinc-800 bg-zinc-950/40";
    let modeIcon = Target;

    if (doingTask) {
      modeLabel = "Execution Mode";
      modeDesc = "Focused reps in progress";
      modeColor = "text-amber-400 border-amber-500/30 bg-amber-500/5";
      modeIcon = Zap;
    } else if (activeTasks.length > 0) {
      modeLabel = "Strategic Progress";
      modeDesc = "Clear outstanding missions";
      modeColor = "text-cyan-400 border-cyan-500/30 bg-cyan-500/5";
      modeIcon = Target;
    }

    // 2. Next Move
    let nextMoveTitle = "";
    let nextMoveHref = "/missions";
    let nextMoveSrc = "";

    if (doingTask) {
      nextMoveTitle = doingTask.title;
      nextMoveHref = `/missions#task-${doingTask.id}`;
      nextMoveSrc = "Active Doing task";
    } else {
      // Find top open task (Ready status, or top of list)
      const readyTask = activeTasks.find((t) => t.status === "READY");
      if (readyTask) {
        nextMoveTitle = readyTask.title;
        nextMoveHref = `/missions#task-${readyTask.id}`;
        nextMoveSrc = "Next ready task";
      } else if (journalAction?.action) {
        nextMoveTitle = journalAction.action;
        nextMoveHref = journalAction.entryId ? `/journal#bd-${journalAction.entryId}` : "/journal";
        nextMoveSrc = "Journal extracted next move";
      } else {
        nextMoveTitle = "No active reps. Capture a thought or triage inbox.";
        nextMoveHref = "/missions";
        nextMoveSrc = "Inbox empty";
      }
    }

    // 3. Stat building
    const nextRep = stats.length > 0 
      ? stats.reduce<StatLevel | null>((best, x) => (x.progressPct > (best?.progressPct ?? 0) ? x : best), null)
      : null;

    // 4. Risks / Anti-drift
    const now = new Date().getTime();
    const overdueCount = activeTasks.filter(
      (t) => t.dueDate && new Date(t.dueDate).getTime() < now
    ).length;
    
    // Count unattached tasks (missionId is null and status is inbox)
    const inboxCount = activeTasks.filter((t) => !t.missionId || t.status === "INBOX").length;

    const risks: string[] = [];
    if (overdueCount > 0) risks.push(`${overdueCount} overdue task${overdueCount > 1 ? "s" : ""}`);
    if (inboxCount >= 10) risks.push(`${inboxCount} untriaged in inbox`);

    // 5. Proof to Capture
    const completedToday = tasks.filter(
      (t) => t.status === "DONE" && t.lastCompletedAt && new Date(t.lastCompletedAt).toDateString() === new Date().toDateString()
    ).length;

    return {
      mode: { label: modeLabel, desc: modeDesc, color: modeColor, Icon: modeIcon },
      nextMove: { title: nextMoveTitle, href: nextMoveHref, src: nextMoveSrc },
      nextRep,
      risks,
      completedToday,
      criticalFew: nextMoveQuery.data?.criticalFew || null,
      nextMoveData: nextMoveQuery.data || null,
    };
  }, [tasks, stats, journalAction, nextMoveQuery.data, tasksQuery.isLoading, statsQuery.isLoading, nextMoveQuery.isLoading]);

  if (!summary) {
    return (
      <div className="h-36 rounded-xl border border-white/10 bg-white/[0.02] animate-pulse" aria-hidden />
    );
  }

  const { mode, nextMove, nextRep, risks, completedToday, criticalFew, nextMoveData } = summary;

  return (
    <div className="glass-card relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 border-white/10 p-4 shadow-xl space-y-4 animate-fade-in-scale">
      {/* Background radial accent glow for premium look */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--gold)]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header section: Mode / Active Brief */}
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider",
            mode.color
          )}>
            <mode.Icon size={10} className="pulse-live" />
            {mode.label}
          </span>
          <span className="text-[10px] text-white/45 font-mono">
            {mode.desc}
          </span>
        </div>
        
        {/* Anti-drift warnings if present */}
        {risks.length > 0 && (
          <Link href="/missions" className="flex items-center gap-1 text-[9px] font-mono uppercase text-amber-500 hover:text-amber-400 tracking-wider">
            <ShieldAlert size={10} />
            <span>{risks.join(" · ")}</span>
          </Link>
        )}
      </div>

      {/* Bento content grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left column: Next Move Card or Critical Few */}
        {criticalFew && criticalFew.length > 0 ? (
          <div className="flex flex-col justify-between p-3 rounded-lg border border-white/5 bg-white/[0.01] space-y-2.5">
            <div>
              <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 block mb-2">
                today's critical few
              </span>
              <div className="space-y-1.5">
                {criticalFew.map((task) => {
                  const laneColors: Record<string, string> = {
                    focus: "text-amber-400 border-amber-500/30 bg-amber-500/5",
                    weakest: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
                    quick: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
                  };
                  const laneLabels: Record<string, string> = {
                    focus: "Focus",
                    weakest: "Weakest",
                    quick: "Quick",
                  };
                  return (
                    <Link
                      key={task.id}
                      href={`/missions#task-${task.id}`}
                      className="flex items-center justify-between gap-2 p-1.5 rounded border border-white/5 hover:border-[var(--gold)]/30 hover:bg-white/[0.02] transition group min-w-0"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={cn(
                          "inline-flex items-center px-1 py-0.5 rounded border text-[8px] font-mono uppercase tracking-wider shrink-0",
                          laneColors[task.lane]
                        )}>
                          {laneLabels[task.lane]}
                        </span>
                        <p className="text-[11.5px] font-medium text-white/90 leading-tight truncate">
                          {task.title}
                        </p>
                      </div>
                      <ArrowRight size={10} className="text-[var(--gold)] shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition" />
                    </Link>
                  );
                })}
              </div>
            </div>
            {nextMoveData?.weakestDomain && (
              <span className="text-[8px] font-mono text-white/35 truncate">
                Weak axis: {nextMoveData.weakestDomain.toLowerCase()} · {nextMoveData.weakestScore}/100
              </span>
            )}
          </div>
        ) : (
          <Link 
            href={nextMove.href}
            className="flex flex-col justify-between p-3 rounded-lg border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-[var(--gold)]/30 transition group"
          >
            <div className="space-y-1">
              <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 group-hover:text-[var(--gold)]/80 transition-colors">
                next move · {nextMove.src}
              </span>
              <p className="text-[13px] font-semibold text-white/90 leading-snug truncate-2-lines">
                {nextMove.title}
              </p>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-mono text-[var(--gold)] hover:underline">
              execute now <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Link>
        )}

        {/* Right column: Target Stat & Proof */}
        <div className="space-y-3">
          {/* Stat closest to leveling up */}
          {nextRep ? (
            <Link 
              href="/stats"
              className="block p-3 rounded-lg border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-[var(--gold)]/30 transition group"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-0.5 min-w-0">
                  <span className="text-[8px] font-mono uppercase tracking-wider text-white/40">
                    stat build target
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm" aria-hidden>{nextRep.icon}</span>
                    <span className="text-[12px] font-semibold text-white/90 truncate">
                      {nextRep.shortLabel || nextRep.label}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-[var(--gold)] font-mono shrink-0">
                  Lvl {nextRep.level}
                </span>
              </div>
              
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-white/5 overflow-hidden">
                  <div 
                    className="h-full rounded-full" 
                    style={{ width: `${nextRep.progressPct}%`, backgroundColor: nextRep.color }}
                  />
                </div>
                <span className="text-[9px] font-mono text-white/50 shrink-0">
                  {Math.round(nextRep.xpForNext - nextRep.xpIntoLevel)} XP to Level {nextRep.level + 1}
                </span>
              </div>
            </Link>
          ) : (
            <div className="h-16 rounded-lg border border-dashed border-white/5 bg-transparent" />
          )}

          {/* Proof Capture CTA */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-white/5 bg-white/[0.01]">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={12} className={cn("mt-0.5 shrink-0", completedToday > 0 ? "text-emerald-400" : "text-white/30")} />
              <div className="flex flex-col">
                <span className="text-[10px] text-white/80 font-medium">
                  {completedToday > 0 
                    ? `${completedToday} loop${completedToday > 1 ? "s" : ""} closed today` 
                    : "Capture today's proof"}
                </span>
                <span className="text-[8px] font-mono text-white/45">
                  {completedToday > 0 ? "Log evidence in journal" : "Second brain is active"}
                </span>
              </div>
            </div>
            
            <Link 
              href="/journal"
              className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-white/10 bg-white/5 text-white/80 hover:bg-[var(--gold)]/10 hover:text-[var(--gold)] hover:border-[var(--gold)]/30 transition"
            >
              + proof
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
