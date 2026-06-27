"use client";

import { useMemo } from "react";
import { Shield, AlertCircle, Sparkles, CheckCircle2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

export function HealthGovernorStrip() {
  const { data: governor, isLoading } = trpc.system.governorState.useQuery(undefined, {
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="h-16 w-full animate-pulse rounded-lg bg-zinc-900/50 border border-zinc-800" />
    );
  }

  if (!governor) return null;

  const { mode, score, reasons, recommendedCommand, actionSeverity } = governor;

  // Determine styling based on governor mode
  const config = {
    LOCKDOWN: {
      bg: "bg-rose-950/15 border-rose-500/20",
      text: "text-rose-400",
      accent: "bg-rose-500/10 border-rose-500/20 text-rose-300",
      barColor: "bg-rose-500",
      icon: AlertCircle,
      title: "Health Lockdown Mode",
    },
    SHADOW_MODE: {
      bg: "bg-amber-950/15 border-amber-500/20",
      text: "text-amber-400",
      accent: "bg-amber-500/10 border-amber-500/20 text-amber-300",
      barColor: "bg-amber-500",
      icon: Shield,
      title: "Shadow Execution Mode",
    },
    RECOVERY_LOCK: {
      bg: "bg-orange-950/15 border-orange-500/20",
      text: "text-orange-400",
      accent: "bg-orange-500/10 border-orange-500/20 text-orange-300",
      barColor: "bg-orange-500",
      icon: Shield,
      title: "Active Recovery Lock",
    },
    OPTIMIZED: {
      bg: "bg-emerald-950/15 border-emerald-500/20",
      text: "text-emerald-400",
      accent: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
      barColor: "bg-emerald-500",
      icon: Sparkles,
      title: "Optimized State",
    },
    STABLE: {
      bg: "bg-zinc-900/30 border-zinc-800",
      text: "text-zinc-300",
      accent: "bg-zinc-800 border-zinc-700 text-zinc-300",
      barColor: "bg-zinc-500",
      icon: CheckCircle2,
      title: "Stable Baseline State",
    },
  }[mode];

  const ModeIcon = config.icon;

  return (
    <section
      aria-label="Health Governor Status"
      className={cn(
        "rounded-lg border backdrop-blur-md px-4 py-3.5 transition-all duration-300",
        config.bg
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left Side: Mode name, icon, reasons */}
        <div className="flex items-start gap-3">
          <div className={cn("p-1.5 rounded-md border shrink-0 mt-0.5", config.accent)}>
            <ModeIcon size={16} strokeWidth={2} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className={cn("text-xs font-bold uppercase tracking-wider", config.text)}>
                {config.title}
              </h2>
              <span className="text-[10px] font-mono text-zinc-500">Readiness: {score}/100</span>
            </div>
            {reasons.length > 0 ? (
              <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">
                {reasons.join(" · ")}
              </p>
            ) : (
              <p className="text-[11px] text-zinc-500 font-mono">All biometrics and focus levels are within baseline limits.</p>
            )}
          </div>
        </div>

        {/* Right Side: Score bar & Recommended command */}
        <div className="flex items-center gap-4 justify-between md:justify-end shrink-0">
          {/* Progress Score Bar */}
          <div className="w-24 space-y-1 hidden sm:block">
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", config.barColor)}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Recommended Mode Command Badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">recommended:</span>
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded bg-black/40 border border-white/5 font-mono text-xs text-zinc-200 shadow-inner">
              <Zap size={10} className="text-amber-400" />
              <span>{recommendedCommand}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
