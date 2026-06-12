"use client";

/**
 * ToolTelemetryPanel — Surfaces per-tool invocation stats
 * from /api/brain/tools on the /brain dashboard + unified security metadata,
 * drift warnings, and environment key checks.
 *
 * Shows: total tools tracked, problem tools (<50% success + ≥10 calls),
 * category filtering, missing env variable alerts, and a sortable, filterable
 * table with risk classes and active statuses.
 *
 * Purely observability — no mutations. Fire-and-forget poll.
 */

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Search,
  Key,
  ShieldAlert,
  HelpCircle,
  XCircle,
  Clock
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { FreshnessChip } from "@/components/ui/freshness-chip";

interface ToolStat {
  toolName: string;
  category: string;
  description: string;
  mutates: boolean;
  riskClass: "low" | "medium" | "high" | "critical";
  status: "active" | "restricted_active" | "scaffolded" | "inert" | "blocked";
  requiredEnv: string[];
  missingEnv: string[];
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  failCount: number;
  lastCallAt?: number;
  lastErrors: Array<{ message: string; at: number }>;
  registered: boolean;
  liveInToolset: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  personal_read: "Personal · Read",
  personal_write: "Personal · Write",
  planning: "Planning",
  business_read: "Business · Read",
  business_write: "Business · Write",
  live_shop: "Live Shop",
  content: "Content",
  comms: "Comms",
  ai_analysis: "AI Analysis",
  brain: "Brain",
  files: "Files",
  routines: "Routines",
  research: "Research",
  browser: "Browser",
  meta: "Meta / System"
};

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
  const toolsQuery = trpc.brain.toolTelemetry.useQuery(undefined);
  const stats = (toolsQuery.data?.stats as ToolStat[] | undefined) ?? [];
  const problem = toolsQuery.data?.problem ?? [];
  const drift = toolsQuery.data?.drift;
  const missingEnvKeys = toolsQuery.data?.missingEnvKeys ?? [];
  
  const loading = toolsQuery.isLoading;
  const loadedAt = toolsQuery.dataUpdatedAt || null;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

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

  // Filter stats based on search query and category
  const filteredStats = stats.filter((s) => {
    const matchesSearch = s.toolName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Unique categories in stats for filtering
  const categories = Array.from(new Set(stats.map((s) => s.category))).sort();

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/40 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Wrench size={14} className="text-[var(--gold)]" />
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Tool registry & telemetry · {stats.length} tracked
          </h2>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void toolsQuery.refetch()} />
        </div>
        {problem.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-red-400">
            <AlertTriangle size={10} />
            {problem.length} problem
          </span>
        )}
      </div>

      {/* Banners: Drift Warning */}
      {drift && (drift.inToolsetMissingFromRegistry.length > 0 || drift.inRegistryMissingFromToolset.length > 0) && (
        <div className="p-3 bg-amber-500/[0.04] border border-amber-500/20 rounded-md text-[11px] text-amber-300/95 space-y-1">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-amber-400">
            <AlertTriangle size={12} />
            <span>Registry Drift Detected</span>
          </div>
          {drift.inToolsetMissingFromRegistry.length > 0 && (
            <p>
              Missing from catalog:{" "}
              <span className="font-mono text-[10px] bg-amber-950/20 border border-amber-500/10 px-1 py-0.5 rounded text-amber-400/90 break-all text-left block">
                {drift.inToolsetMissingFromRegistry.join(", ")}
              </span>
            </p>
          )}
          {drift.inRegistryMissingFromToolset.length > 0 && (
            <p>
              Scaffolded / missing from toolset:{" "}
              <span className="font-mono text-[10px] bg-amber-950/20 border border-amber-500/10 px-1 py-0.5 rounded text-amber-400/90 break-all text-left block">
                {drift.inRegistryMissingFromToolset.join(", ")}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Banners: Missing Env Keys */}
      {missingEnvKeys.length > 0 && (
        <div className="p-3 bg-red-500/[0.04] border border-red-500/20 rounded-md text-[11px] text-red-300/95 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-red-400">
            <Key size={12} />
            <span>Missing Environment Keys</span>
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] text-left">The following keys are required by active tools but missing in Railway environment variables:</p>
          <div className="flex flex-wrap gap-1.5">
            {missingEnvKeys.map((k) => (
              <span key={k} className="font-mono text-[9px] bg-red-950/20 border border-red-500/20 px-1.5 py-0.5 rounded text-red-300/90">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 text-[11px] rounded border border-[var(--border-default)] bg-[var(--bg-void)]/60 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-focus)]"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-2 py-1 text-[11px] rounded border border-[var(--border-default)] bg-[var(--bg-void)]/60 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] sm:w-48"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat] ?? cat}
            </option>
          ))}
        </select>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
              <th className="text-left pb-1.5">tool</th>
              <th className="text-left pb-1.5 hidden md:table-cell">risk</th>
              <th className="text-left pb-1.5">status</th>
              <th className="text-right pb-1.5">calls</th>
              <th className="text-right pb-1.5">ok%</th>
              <th className="text-right pb-1.5 hidden sm:table-cell">avg</th>
              <th className="text-right pb-1.5 hidden md:table-cell">last</th>
            </tr>
          </thead>
          <tbody>
            {filteredStats.map((s) => {
              const isProblem = problem.includes(s.toolName);
              const rate = Math.round(s.successRate * 100);
              const isExp = expanded === s.toolName;

              // Risk badge styling
              const riskColors = {
                critical: "text-red-400 bg-red-500/[0.06] border border-red-500/20",
                high: "text-orange-400 bg-orange-500/[0.06] border border-orange-500/20",
                medium: "text-amber-400 bg-amber-500/[0.06] border border-amber-500/20",
                low: "text-sky-400 bg-sky-500/[0.06] border border-sky-500/20"
              }[s.riskClass];

              // Status badge styling
              const statusColors = {
                active: "text-emerald-400 bg-emerald-500/[0.06] border border-emerald-500/20",
                restricted_active: "text-cyan-400 bg-cyan-500/[0.06] border border-cyan-500/20",
                inert: "text-yellow-400 bg-yellow-500/[0.06] border border-yellow-500/20",
                scaffolded: "text-zinc-400 bg-zinc-500/[0.06] border border-zinc-500/20",
                blocked: "text-red-500 bg-red-950/[0.08] border border-red-950/40"
              }[s.status];

              return (
                <Fragment key={s.toolName}>
                  <tr
                    onClick={() => setExpanded(isExp ? null : s.toolName)}
                    className={cn(
                      "border-t border-[var(--border-default)]/40 cursor-pointer hover:bg-[var(--bg-void)]/50 transition-colors",
                      isProblem && "bg-red-500/5",
                    )}
                  >
                    <td className="py-2 text-[var(--text-primary)] font-mono">
                      <span className="inline-flex items-center gap-1">
                        {isProblem ? (
                          <AlertTriangle size={10} className="text-red-400 animate-pulse" />
                        ) : s.status === "inert" ? (
                          <Key size={10} className="text-yellow-400/70" />
                        ) : (
                          <CheckCircle2 size={10} className="text-emerald-400/70" />
                        )}
                        {s.toolName}
                      </span>
                    </td>
                    <td className="py-2 hidden md:table-cell">
                      <span className={cn("px-1 py-0.5 rounded text-[8px] uppercase font-mono tracking-wider font-semibold", riskColors)}>
                        {s.riskClass}
                      </span>
                    </td>
                    <td className="py-2 font-mono">
                      <span className={cn("px-1.5 py-0.5 rounded text-[8.5px] uppercase font-mono tracking-wider", statusColors)}>
                        {s.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-primary)]">
                      {s.totalCalls}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right tabular-nums",
                        s.totalCalls === 0
                          ? "text-[var(--text-muted)]"
                          : rate < 50
                            ? "text-red-400"
                            : rate < 80
                              ? "text-amber-400"
                              : "text-emerald-400",
                      )}
                    >
                      {s.totalCalls === 0 ? "—" : `${rate}%`}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-tertiary)] hidden sm:table-cell">
                      {s.avgDurationMs > 0 ? `${s.avgDurationMs}ms` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-tertiary)] text-[9px] hidden md:table-cell">
                      {formatAgo(s.lastCallAt)}
                    </td>
                  </tr>
                  {isExp && (
                    <tr className="bg-[var(--bg-void)]/45">
                      <td colSpan={7} className="py-2.5 px-3 border-t border-[var(--border-default)]/20">
                        <div className="space-y-2 text-[11px] text-[var(--text-secondary)]">
                          {/* Metadata grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1 text-left">
                              <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">Description</p>
                              <p className="text-[10.5px] leading-relaxed">{s.description}</p>
                              
                              <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] pt-1">Category & Operations</p>
                              <div className="flex flex-wrap gap-1.5 text-[9.5px]">
                                <span className="px-1.5 py-0.5 bg-white/[0.03] border border-white/5 rounded">
                                  {CATEGORY_LABELS[s.category] ?? s.category}
                                </span>
                                {s.mutates && (
                                  <span className="px-1.5 py-0.5 bg-amber-500/[0.04] border border-amber-500/10 text-amber-400/90 rounded">
                                    mutates external state
                                  </span>
                                )}
                                {!s.registered && (
                                  <span className="px-1.5 py-0.5 bg-red-500/[0.04] border border-red-500/10 text-red-400/90 rounded animate-pulse">
                                    unregistered in catalog
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            {/* Environment checklist */}
                            {s.requiredEnv.length > 0 && (
                              <div className="space-y-1 text-left">
                                <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">Environment Check</p>
                                <div className="space-y-1 font-mono text-[9.5px]">
                                  {s.requiredEnv.map((key) => {
                                    const missing = s.missingEnv.includes(key);
                                    return (
                                      <div key={key} className="flex items-center gap-1.5">
                                        {missing ? (
                                          <XCircle size={10} className="text-red-400" />
                                        ) : (
                                          <CheckCircle2 size={10} className="text-emerald-400" />
                                        )}
                                        <span className={missing ? "text-red-400/95" : "text-emerald-300/95"}>{key}</span>
                                        <span className="text-[9px] text-[var(--text-muted)]">
                                          ({missing ? "missing" : "configured"})
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Last errors list */}
                          {s.lastErrors.length > 0 && (
                            <div className="mt-2.5 pt-2 border-t border-[var(--border-default)]/20 space-y-1 text-left">
                              <p className="text-[9px] font-mono uppercase tracking-wider text-red-400 flex items-center gap-1">
                                <Clock size={9} />
                                <span>Recent Error History (Last {s.lastErrors.length})</span>
                              </p>
                              {s.lastErrors.map((e, i) => (
                                <p
                                  key={i}
                                  className="text-[10px] font-mono text-red-300/80 break-all bg-red-950/10 p-1.5 rounded border border-red-500/10"
                                >
                                  <span className="text-red-400/60 mr-1.5">{formatAgo(e.at)}</span>
                                  {e.message}
                                </p>
                              ))}
                            </div>
                          )}
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
      
      {/* Footer / Empty State */}
      {filteredStats.length === 0 && (
        <div className="text-center py-6 text-[11px] text-[var(--text-tertiary)] font-mono">
          No tools matched your query.
        </div>
      )}
    </div>
  );
}
