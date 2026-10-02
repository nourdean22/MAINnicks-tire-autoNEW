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
      <div className="h-16 w-full animate-pulse rounded-surface bg-content border border-edge-subtle" />
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
      bg: "bg-content border-edge-subtle",
      text: "text-fg-secondary",
      accent: "bg-surface-interactive border-edge-default text-fg-secondary",
      barColor: "bg-fg-tertiary",
      icon: CheckCircle2,
      title: "Stable Baseline State",
    },
  }[mode];

  const ModeIcon = config.icon;

  return (
    <section
      aria-label="Health Governor Status"
      className={cn(
        "rounded-surface border px-4 py-3.5",
        config.bg
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left Side: Mode name, icon, reasons */}
        <div className="flex items-start gap-3">
          <div className={cn("p-1.5 rounded-control border shrink-0 mt-0.5", config.accent)}>
            <ModeIcon size={16} strokeWidth={2} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className={cn("text-[13px] font-semibold", config.text)}>
                {config.title}
              </h2>
              <span className="text-[11px] font-mono text-fg-tertiary">Readiness: {score}/100</span>
            </div>
            {reasons.length > 0 ? (
              <p className="text-[12px] text-fg-secondary leading-relaxed font-mono">
                {reasons.join(" · ")}
              </p>
            ) : (
              <p className="text-[12px] text-fg-tertiary font-mono">All biometrics and focus levels are within baseline limits.</p>
            )}
          </div>
        </div>

        {/* Right Side: Score bar & Recommended command */}
        <div className="flex items-center gap-4 justify-between md:justify-end shrink-0">
          {/* Progress Score Bar */}
          <div className="w-24 space-y-1 hidden sm:block">
            <div className="h-1.5 w-full rounded-full bg-surface-interactive overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", config.barColor)}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Recommended Mode Command Badge */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">recommended:</span>
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-micro bg-surface-interactive border border-edge-subtle font-mono text-[12px] text-fg">
              <Zap size={10} className="text-fg-tertiary" />
              <span>{recommendedCommand}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
