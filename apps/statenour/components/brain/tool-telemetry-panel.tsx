"use client";

/**
 * ToolTelemetryPanel — Apr 19. Surfaces per-tool invocation stats
 * from /api/brain/tools on the /brain dashboard.
 *
 * Shows: total tools tracked, problem tools (<50% success + ≥10 calls),
 * and a sortable table with totalCalls / successRate / avgDurationMs
 * per tool. Tap the problem badge to jump to the failing tool.
 *
 * Purely observability — no mutations. Fire-and-forget poll.
 */

import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { FreshnessChip } from "@/components/ui/freshness-chip";

interface ToolStat {
  toolName: string;
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  failCount: number;
  lastCallAt?: number;
  lastErrors: Array<{ message: string; at: number }>;
}

interface ApiResponse {
  data?: {
    ok?: boolean;
    total?: number;
    problem?: string[];
    stats?: ToolStat[];
  };
  ok?: boolean;
  total?: number;
  problem?: string[];
  stats?: ToolStat[];
}

function formatAgo(ms?: number): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h >= 1) return `${h}h ago`;
  const m = Math.floor(diff / 60_000);
  if (m >= 1) return `${m}m ago`;
  return `just now`;
}

export function ToolTelemetryPanel() {
  const [stats, setStats] = useState<ToolStat[]>([]);
  const [problem, setProblem] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authedFetch("/api/brain/tools");
        if (!res.ok) throw new Error("tools api failed");
        const raw = (await res.json()) as ApiResponse;
        const payload = raw.data ?? raw;
        if (!alive) return;
        setStats(payload.stats ?? []);
        setProblem(payload.problem ?? []);
        setLoadedAt(Date.now());
      } catch {
        if (alive) setStats([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/40 p-4 text-[11px] text-[var(--text-tertiary)]">
        loading tool telemetry…
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/40 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Wrench size={14} className="text-[var(--gold)]" />
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Tool telemetry
          </h2>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          no tool calls recorded yet — send a chat message that triggers a tool to populate.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Wrench size={14} className="text-[var(--gold)]" />
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Tool telemetry · {stats.length} tracked
          </h2>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => setNonce((n) => n + 1)} />
        </div>
        {problem.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-red-400">
            <AlertTriangle size={10} />
            {problem.length} problem
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
              <th className="text-left pb-1.5">tool</th>
              <th className="text-right pb-1.5">calls</th>
              <th className="text-right pb-1.5">ok%</th>
              <th className="text-right pb-1.5">avg</th>
              <th className="text-right pb-1.5">last</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const isProblem = problem.includes(s.toolName);
              const rate = Math.round(s.successRate * 100);
              const isExp = expanded === s.toolName;
              return (
                <Fragment key={s.toolName}>
                  <tr
                    onClick={() => setExpanded(isExp ? null : s.toolName)}
                    className={cn(
                      "border-t border-[var(--border-default)]/40 cursor-pointer hover:bg-[var(--bg-void)]/50",
                      isProblem && "bg-red-500/5",
                    )}
                  >
                    <td className="py-1.5 text-[var(--text-primary)] font-mono">
                      <span className="inline-flex items-center gap-1">
                        {isProblem ? (
                          <AlertTriangle size={10} className="text-red-400" />
                        ) : (
                          <CheckCircle2 size={10} className="text-emerald-400/70" />
                        )}
                        {s.toolName}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                      {s.totalCalls}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 text-right tabular-nums",
                        rate < 50
                          ? "text-red-400"
                          : rate < 80
                            ? "text-amber-400"
                            : "text-emerald-400",
                      )}
                    >
                      {rate}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-tertiary)]">
                      {s.avgDurationMs > 0 ? `${s.avgDurationMs}ms` : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-tertiary)] text-[9px]">
                      {formatAgo(s.lastCallAt)}
                    </td>
                  </tr>
                  {isExp && s.lastErrors.length > 0 && (
                    <tr className="bg-red-500/5">
                      <td colSpan={5} className="py-2 px-2">
                        <div className="space-y-1">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-red-400">
                            last {s.lastErrors.length} error{s.lastErrors.length === 1 ? "" : "s"}
                          </p>
                          {s.lastErrors.map((e, i) => (
                            <p
                              key={i}
                              className="text-[10px] font-mono text-red-300/80 break-all"
                            >
                              <span className="text-red-400/60 mr-1.5">{formatAgo(e.at)}</span>
                              {e.message}
                            </p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
