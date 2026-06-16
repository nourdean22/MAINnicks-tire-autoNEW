"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils/cn";
import {
  Brain,
  Clock,
  DollarSign,
  ThumbsUp,
  ThumbsDown,
  Activity,
  Layers,
  Settings,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

function dollars(cents: number): string {
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(4)}`;
}

export function CockpitObservabilityView() {
  const {
    data: stats,
    isFetching: loading,
    refetch,
  } = trpc.system.cockpitStats.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const setActiveMutation = trpc.system.setActivePromptVersion.useMutation();
  const [mutatingVersion, setMutatingVersion] = useState<number | null>(null);

  const handleToggleActive = async (version: number) => {
    try {
      setMutatingVersion(version);
      await setActiveMutation.mutateAsync({ version });
      toast.success(`Prompt version ${version} is now active`);
      await refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to set active version");
    } finally {
      setMutatingVersion(null);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-gold" />
          <span className="font-mono text-xs text-zinc-500">Loading Cockpit Observability Data...</span>
        </div>
      </div>
    );
  }

  const kpis = stats?.kpis || {
    totalCostCents: 0,
    p95TtftMs: 0,
    averageFeedback: 0,
    pendingApprovalsCount: 0,
    avgDurationMs: 0,
  };

  const recentRuns = stats?.recentRuns || [];
  const memoryDecay = stats?.memoryDecay || [];
  const promptVersions = stats?.promptVersions || [];

  // Sort memory categories by frequency count descending
  const sortedMemoryCategories = [...memoryDecay].sort((a, b) => b.count - a.count);
  const maxCategoryCount = Math.max(...sortedMemoryCategories.map((c) => c.count), 1);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 stagger-in">
        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">Cost Burned</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white font-mono">
              {dollars(kpis.totalCostCents)}
            </span>
            <p className="text-[9px] text-zinc-500 font-mono mt-0.5">Aggregate spend</p>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">P95 TTFT</span>
            <Clock className="w-3.5 h-3.5 text-gold" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white font-mono">
              {kpis.p95TtftMs.toFixed(0)}
            </span>
            <span className="text-xs text-zinc-400 font-mono ml-0.5">ms</span>
            <p className="text-[9px] text-zinc-500 font-mono mt-0.5">95th percentile TTFT</p>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">Avg Latency</span>
            <Activity className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white font-mono">
              {(kpis.avgDurationMs / 1000).toFixed(2)}
            </span>
            <span className="text-xs text-zinc-400 font-mono ml-0.5">s</span>
            <p className="text-[9px] text-zinc-500 font-mono mt-0.5">Average turn duration</p>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">Avg Feedback</span>
            <div className="flex gap-1 text-gold">
              <ThumbsUp className="w-3 h-3" />
            </div>
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white font-mono">
              {kpis.averageFeedback >= 0 ? "+" : ""}
              {kpis.averageFeedback.toFixed(1)}
            </span>
            <p className="text-[9px] text-zinc-500 font-mono mt-0.5">Score scale: -1 to +1</p>
          </div>
        </GlassCard>

        <GlassCard
          className="flex flex-col justify-between p-4"
          critical={kpis.pendingApprovalsCount > 0}
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-bold uppercase tracking-wider font-display">Pending Gated</span>
            <ShieldAlert className={cn("w-3.5 h-3.5", kpis.pendingApprovalsCount > 0 ? "text-rose-400 animate-pulse" : "text-zinc-500")} />
          </div>
          <div className="mt-2.5">
            <span className={cn(
              "text-2xl font-bold tracking-tight font-mono",
              kpis.pendingApprovalsCount > 0 ? "text-rose-400" : "text-white"
            )}>
              {kpis.pendingApprovalsCount}
            </span>
            <p className="text-[9px] text-zinc-500 font-mono mt-0.5">Gated approval queue</p>
          </div>
        </GlassCard>
      </div>

      {/* Main Dashboard section: Memory decay + Recent Runs */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left Side: Memory Decay / Hit Rate */}
        <Panel className="md:col-span-4 border border-zinc-800/60 bg-zinc-900/[0.04] p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 border-b border-zinc-800/50 pb-2.5 mb-3.5">
              <Brain className="w-4 h-4 text-gold" />
              <h2 className="text-xs font-bold font-display uppercase tracking-wider text-zinc-100">
                Memory Decay Visualizer
              </h2>
            </div>

            <p className="text-[11px] text-zinc-400 leading-snug mb-4">
              Breakdown of semantic memory hits by category over the last 7 days. Reflects recall frequency and context density.
            </p>

            {sortedMemoryCategories.length === 0 ? (
              <p className="text-xs italic text-zinc-500 py-6 text-center">
                No memories recalled in the last 7 days.
              </p>
            ) : (
              <div className="space-y-3.5">
                {sortedMemoryCategories.map((item) => {
                  const pctOfMax = (item.count / maxCategoryCount) * 100;
                  return (
                    <div key={item.category} className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-zinc-300 font-medium">{item.category}</span>
                        <span className="text-zinc-500">{item.count} hits</span>
                      </div>
                      <div className="h-2 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-gold/40 to-gold/90 transition-all duration-500"
                          style={{ width: `${pctOfMax}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-800/40 flex justify-between items-center text-[9px] text-zinc-500 font-mono">
            <span>Aggregating last 7 days</span>
            <Link href="/brain" className="text-gold hover:underline flex items-center gap-0.5">
              Brain Hub <ChevronRight className="w-2.5 h-2.5" />
            </Link>
          </div>
        </Panel>

        {/* Right Side: Timeline of Recent Runs */}
        <Panel className="md:col-span-8 border border-zinc-800/60 bg-zinc-900/[0.04] p-4">
          <div className="flex items-center justify-between border-b border-zinc-800/50 pb-2.5 mb-3.5">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <h2 className="text-xs font-bold font-display uppercase tracking-wider text-zinc-100">
                Recent Agent Runs
              </h2>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">Showing last 20 turns</span>
          </div>

          {recentRuns.length === 0 ? (
            <p className="text-xs italic text-zinc-500 py-12 text-center">
              No recent agent runs recorded.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[320px] pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <th className="py-2 pr-2">Trace</th>
                    <th className="py-2 px-2">Model</th>
                    <th className="py-2 px-2">Duration</th>
                    <th className="py-2 px-2">Cost</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 pl-2 text-right">Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="py-2.5 pr-2 font-mono text-zinc-400 whitespace-nowrap">
                        <Link
                          href={`/system/logs?trace=${run.traceId}`}
                          className="hover:text-gold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform"
                        >
                          {run.traceId.slice(0, 10)}...
                          <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-gold" />
                        </Link>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-zinc-300">
                        <span className="truncate max-w-[120px] inline-block" title={run.model}>
                          {run.model.split("/").pop()}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-zinc-400">
                        {(run.durationMs / 1000).toFixed(2)}s
                      </td>
                      <td className="py-2.5 px-2 font-mono text-emerald-400">
                        {dollars(run.costCents)}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider font-mono",
                          run.status === "success" && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                          run.status === "errored" && "bg-rose-500/10 text-rose-400 border border-rose-500/20",
                          run.status === "cancelled" && "bg-zinc-800 text-zinc-400 border border-zinc-700/30"
                        )}>
                          {run.status}
                        </span>
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        {run.feedback ? (
                          <div className="inline-flex items-center gap-1 justify-end">
                            {run.feedback.score > 0 ? (
                              <span title={run.feedback.note || "Thumbs up"}>
                                <ThumbsUp className="w-3 h-3 text-emerald-400" />
                              </span>
                            ) : (
                              <span title={run.feedback.note || "Thumbs down"}>
                                <ThumbsDown className="w-3 h-3 text-rose-400" />
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-600 font-mono text-[9px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* Bottom Section: Prompt Versions Table */}
      <Panel className="border border-zinc-800/60 bg-zinc-900/[0.04] p-4">
        <div className="flex items-center justify-between border-b border-zinc-800/50 pb-2.5 mb-3.5">
          <div className="flex items-center space-x-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold font-display uppercase tracking-wider text-zinc-100">
              Agent Prompt Version Manager
            </h2>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">Deploy & toggle prompt matrices</span>
        </div>

        {promptVersions.length === 0 ? (
          <p className="text-xs italic text-zinc-500 py-8 text-center">
            No prompt versions registered in the database.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="py-2 pr-2">Version</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Prompt Draft Preview</th>
                  <th className="py-2 px-2 text-center">Total Runs</th>
                  <th className="py-2 px-2 text-center">Avg Score</th>
                  <th className="py-2 px-2">Created</th>
                  <th className="py-2 pl-2 text-right">Activate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {promptVersions.map((pv) => (
                  <tr key={pv.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 pr-2 font-bold font-mono text-zinc-200">
                      v{pv.version}
                    </td>
                    <td className="py-3 px-2">
                      {pv.active ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400 font-mono">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 font-mono">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 font-serif text-zinc-400 italic max-w-xs truncate" title={pv.systemPrompt}>
                      "{pv.systemPrompt}"
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-zinc-300">
                      {pv.totalRuns}
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-zinc-300">
                      {pv.averageFeedback !== 0 ? (
                        <span className={cn(pv.averageFeedback > 0 ? "text-emerald-400" : "text-rose-400")}>
                          {pv.averageFeedback > 0 ? "+" : ""}
                          {pv.averageFeedback.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-zinc-500 font-mono whitespace-nowrap">
                      {new Date(pv.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 pl-2 text-right">
                      <button
                        onClick={() => handleToggleActive(pv.version)}
                        disabled={pv.active || mutatingVersion === pv.version}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          pv.active ? "bg-emerald-500/80 cursor-default" : "bg-zinc-800 hover:bg-zinc-700",
                          mutatingVersion === pv.version && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            pv.active ? "translate-x-4" : "translate-x-0"
                          )}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
