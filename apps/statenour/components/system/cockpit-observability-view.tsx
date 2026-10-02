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
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge-default border-t-fg-secondary" />
          <span className="font-mono text-xs text-fg-tertiary">Loading Cockpit Observability Data...</span>
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
  const systemHealth = stats?.systemHealth ?? { status: "unknown", degradedSources: [] };
  const missions = stats?.missions ?? {
    active: 0,
    paused: 0,
    complete: 0,
    killed: 0,
    recentReceipts: [],
  };
  const externalWorker = stats?.externalWorker ?? {
    runnerFresh: false,
    runnerNodeKey: null,
    runnerLastHeartbeatAt: null,
    lanes: {
      codex: null,
      "claude-code": null,
      antigravity: null,
      "local-qwen": null,
    },
  };
  const latestEval = stats?.eval ?? null;
  const workerRows = (
    [
      ["codex", "Codex"],
      ["claude-code", "Claude Code"],
      ["antigravity", "Antigravity"],
      ["local-qwen", "Local Qwen"],
    ] as const
  ).map(([key, label]) => ({ key, label, state: externalWorker.lanes[key] }));

  // Sort recent-memory attention categories by count descending
  const sortedMemoryCategories = [...memoryDecay].sort((a, b) => b.count - a.count);
  const maxCategoryCount = Math.max(...sortedMemoryCategories.map((c) => c.count), 1);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 stagger-in">
        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-fg-secondary">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Cost Burned</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-fg font-mono">
              {dollars(kpis.totalCostCents)}
            </span>
            <p className="text-[11px] text-fg-tertiary font-mono mt-0.5">Tracked spend · 7d</p>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between p-4">
              <div className="flex items-center justify-between text-fg-secondary">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">P95 TTFT</span>
            <Clock className="w-3.5 h-3.5 text-fg-secondary" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-fg font-mono">
              {kpis.p95TtftMs.toFixed(0)}
            </span>
            <span className="text-xs text-fg-secondary font-mono ml-0.5">ms</span>
            <p className="text-[11px] text-fg-tertiary font-mono mt-0.5">95th percentile TTFT</p>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between p-4">
              <div className="flex items-center justify-between text-fg-secondary">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Avg Latency</span>
            <Activity className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-fg font-mono">
              {(kpis.avgDurationMs / 1000).toFixed(2)}
            </span>
            <span className="text-xs text-fg-secondary font-mono ml-0.5">s</span>
            <p className="text-[11px] text-fg-tertiary font-mono mt-0.5">AI generation duration · 7d</p>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between p-4">
              <div className="flex items-center justify-between text-fg-secondary">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Avg Feedback</span>
            <div className="flex gap-1 text-fg-secondary">
              <ThumbsUp className="w-3 h-3" />
            </div>
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-fg font-mono">
              {kpis.averageFeedback >= 0 ? "+" : ""}
              {kpis.averageFeedback.toFixed(1)}
            </span>
            <p className="text-[11px] text-fg-tertiary font-mono mt-0.5">Chat feedback · 30d · -1 to +1</p>
          </div>
        </GlassCard>

        <GlassCard
          className="flex flex-col justify-between p-4"
          critical={kpis.pendingApprovalsCount > 0}
        >
          <div className="flex items-center justify-between text-fg-secondary">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Pending Gated</span>
            <ShieldAlert className={cn("w-3.5 h-3.5", kpis.pendingApprovalsCount > 0 ? "text-rose-400" : "text-fg-tertiary")} />
          </div>
          <div className="mt-2.5">
            <span className={cn(
              "text-2xl font-bold tracking-tight font-mono",
              kpis.pendingApprovalsCount > 0 ? "text-rose-400" : "text-fg"
            )}>
              {kpis.pendingApprovalsCount}
            </span>
            <p className="text-[11px] text-fg-tertiary font-mono mt-0.5">Gated approval queue</p>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Panel className="border border-edge-subtle bg-content p-4">
          <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">System Health</span>
            <Activity className="h-3.5 w-3.5 text-sky-400" />
          </div>
          <div className={cn(
            "mt-3 text-xl font-bold font-mono",
            systemHealth.status === "healthy" ? "text-emerald-400" : "text-amber-400",
          )}>
            {systemHealth.status}
          </div>
          <p className="mt-1 text-[11px] text-fg-tertiary font-mono">
            {systemHealth.degradedSources.length === 0
              ? "No measured degraded sources"
              : `Degraded: ${systemHealth.degradedSources.join(", ")}`}
          </p>
        </Panel>

        <Panel className="border border-edge-subtle bg-content p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">Missions</span>
            <Layers className="h-3.5 w-3.5 text-fg-secondary" />
          </div>
          <div className="mt-3 flex items-end gap-3 font-mono">
            <span className="text-2xl font-bold text-fg">{missions.active}</span>
            <span className="pb-0.5 text-[11px] text-fg-tertiary">active</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-tertiary font-mono">
            {missions.paused} paused · {missions.complete} complete · {missions.recentReceipts.length} receipts / 7d
          </p>
        </Panel>

        <Panel className="border border-edge-subtle bg-content p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">External Workers</span>
            <Brain className="h-3.5 w-3.5 text-fg-secondary" />
          </div>
          <div className="mt-3 space-y-1.5">
            {workerRows.map(({ key, label, state }) => (
              <div key={key} className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-fg">{label}</span>
                <span className={cn(
                  state?.health === "ready" ? "text-emerald-400" :
                  state?.health === "degraded" ? "text-amber-400" : "text-fg-tertiary",
                )}>
                  {state ? `${state.health} / ${state.quota}` : "unknown"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-tertiary font-mono">
            Runner {externalWorker.runnerFresh ? "fresh" : "stale / absent"}
          </p>
        </Panel>

        <Panel className="border border-edge-subtle bg-content p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">Latest Eval</span>
            <ShieldAlert className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="mt-3 text-xl font-bold font-mono text-fg">
            {latestEval ? `${Math.round(latestEval.passRate * 100)}%` : "—"}
          </div>
          <p className="mt-1 text-[11px] text-fg-tertiary font-mono">
            {latestEval
              ? `${latestEval.passed}/${latestEval.totalRan} passed · ${new Date(latestEval.ranAt).toLocaleString()}`
              : "No persisted eval result"}
          </p>
        </Panel>
      </div>

      {/* Main Dashboard section: Memory attention + Recent Runs */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left Side: Memory Decay / Hit Rate */}
        <Panel className="md:col-span-4 border border-edge-subtle bg-content p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 border-b border-edge-subtle pb-2.5 mb-3.5">
              <Brain className="w-4 h-4 text-fg-secondary" />
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg">
                Memory Attention
              </h2>
            </div>

            <p className="text-[11px] text-fg-secondary leading-snug mb-4">
              Memories touched in the last 7 days, grouped by category. Bar weight uses their persisted lifetime seenCount — attention, not truth or 7-day hit count.
            </p>

            {sortedMemoryCategories.length === 0 ? (
              <p className="text-xs italic text-fg-tertiary py-6 text-center">
                No memories recalled in the last 7 days.
              </p>
            ) : (
              <div className="space-y-3.5">
                {sortedMemoryCategories.map((item) => {
                  const pctOfMax = (item.count / maxCategoryCount) * 100;
                  return (
                    <div key={item.category} className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-fg font-medium">{item.category}</span>
                        <span className="text-fg-tertiary">{item.count} attention</span>
                      </div>
                      <div className="h-2 w-full bg-canvas rounded-full overflow-hidden border border-edge-subtle">
                        <div
                          className="h-full rounded-full bg-fg-secondary transition-all duration-500"
                          style={{ width: `${pctOfMax}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-edge-subtle flex justify-between items-center text-[11px] text-fg-tertiary font-mono">
            <span>Touched within last 7 days</span>
            <Link href="/brain" className="text-fg-secondary hover:underline flex items-center gap-0.5">
              Brain Hub <ChevronRight className="w-2.5 h-2.5" />
            </Link>
          </div>
        </Panel>

        {/* Right Side: Timeline of Recent Runs */}
        <Panel className="md:col-span-8 border border-edge-subtle bg-content p-4">
              <div className="flex items-center justify-between border-b border-edge-subtle pb-2.5 mb-3.5">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg">
                Recent Agent Runs
              </h2>
            </div>
            <span className="text-[11px] text-fg-tertiary font-mono">Showing last 20 turns</span>
          </div>

          {recentRuns.length === 0 ? (
            <p className="text-xs italic text-fg-tertiary py-12 text-center">
              No recent agent runs recorded.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[320px] pr-1 scrollbar-thin scrollbar-track-transparent">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-edge-subtle text-[12px] font-medium text-fg-secondary">
                    <th className="py-2 pr-2">Trace</th>
                    <th className="py-2 px-2">Model</th>
                    <th className="py-2 px-2">Duration</th>
                    <th className="py-2 px-2">Cost</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 pl-2 text-right">Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge-subtle">
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-surface-hover transition-colors group">
              <td className="py-2.5 pr-2 font-mono text-fg-secondary whitespace-nowrap">
                        <Link
                          href={`/system/logs?trace=${run.traceId}`}
                          className="hover:text-fg flex items-center gap-1 group-hover:translate-x-0.5 transition-transform"
                        >
                          {run.traceId.slice(0, 10)}...
                          <ChevronRight className="w-3 h-3 text-fg-tertiary group-hover:text-fg" />
                        </Link>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-fg">
                        <span className="truncate max-w-[120px] inline-block" title={run.model}>
                          {run.model.split("/").pop()}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-fg-secondary">
                        {(run.durationMs / 1000).toFixed(2)}s
                      </td>
                      <td className="py-2.5 px-2 font-mono text-emerald-400">
                        {dollars(run.costCents)}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold font-mono",
                          run.status === "success" && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                          run.status === "errored" && "bg-rose-500/10 text-rose-400 border border-rose-500/20",
                          run.status === "cancelled" && "bg-content text-fg-secondary border border-edge-default",
                          run.status === "running" && "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                        )}>
                          {run.status}
                        </span>
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        <span
                          className="text-fg-tertiary font-mono text-[11px]"
                          title="AgentTrace has no feedback-attribution writer"
                        >
                          —
                        </span>
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
      <Panel className="border border-edge-subtle bg-content p-4">
              <div className="flex items-center justify-between border-b border-edge-subtle pb-2.5 mb-3.5">
          <div className="flex items-center space-x-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg">
              Agent Prompt Version Manager
            </h2>
          </div>
          <span className="text-[11px] text-fg-tertiary font-mono">Deploy & toggle prompt matrices</span>
        </div>

        {promptVersions.length === 0 ? (
          <p className="text-xs italic text-fg-tertiary py-8 text-center">
            No prompt versions registered in the database.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-edge-subtle text-[12px] font-medium text-fg-secondary">
                  <th className="py-2 pr-2">Version</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Prompt Draft Preview</th>
                  <th className="py-2 px-2 text-center">Total Runs</th>
                  <th className="py-2 px-2 text-center">Avg Score</th>
                  <th className="py-2 px-2">Created</th>
                  <th className="py-2 pl-2 text-right">Activate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-subtle">
                {promptVersions.map((pv) => (
                  <tr key={pv.id} className="hover:bg-surface-hover transition-colors">
              <td className="py-3 pr-2 font-bold font-mono text-fg">
                      v{pv.version}
                    </td>
                    <td className="py-3 px-2">
                      {pv.active ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[11px] font-bold text-emerald-400 font-mono">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-content border border-edge-default px-1.5 py-0.5 text-[11px] font-bold text-fg-tertiary font-mono">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 font-serif text-fg-secondary italic max-w-xs truncate" title={pv.systemPrompt}>
                      "{pv.systemPrompt}"
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-fg">
                      {pv.usageAttributionAvailable && pv.totalRuns !== null ? pv.totalRuns : "—"}
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-fg">
                      <span
                        className="text-fg-tertiary"
                        title="No prompt-version run attribution writer exists yet"
                      >
                        —
                      </span>
                    </td>
                    <td className="py-3 px-2 text-fg-tertiary font-mono whitespace-nowrap">
                      {new Date(pv.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 pl-2 text-right">
                      <button
                        onClick={() => handleToggleActive(pv.version)}
                        disabled={pv.active || mutatingVersion === pv.version}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          pv.active ? "bg-emerald-500/80 cursor-default" : "bg-surface-interactive hover:bg-surface-hover",
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
