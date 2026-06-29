"use client";

/**
 * /system/schema-history — operator database schema change history panel.
 *
 * v10 Track B.4 · Apr 30.
 *
 * Surface that displays the audit trail of schema changes and migrations.
 * Reads from SchemaChangeLedger table via trpc.system.schemaHistory.
 */

import { Suspense, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
import { MetricCard } from "@/components/metric-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";
import {
  Clock,
  Database,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  FileCode,
  ChevronDown,
  ChevronUp,
  Shield,
  Layers,
  Terminal,
} from "lucide-react";

type EnvFilter = "all" | "local" | "preview" | "production";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function SchemaHistoryPage() {
  return (
    <Suspense fallback={<div className="text-center text-xs text-[var(--text-tertiary)] animate-pulse py-8">Loading page...</div>}>
      <SchemaHistoryInner />
    </Suspense>
  );
}

function SchemaHistoryInner() {
  const params = useSearchParams();
  const router = useRouter();

  const initialEnv = (params?.get("env") as EnvFilter) || "all";
  const initialLimit = parseInt(params?.get("limit") || "25", 10);

  const [env, setEnv] = useState<EnvFilter>(initialEnv);
  const [limit, setLimit] = useState<number>(initialLimit);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const schemaQuery = trpc.system.schemaHistory.useQuery(
    {
      limit,
      env: env === "all" ? undefined : env,
    },
    {
      refetchInterval: 30_000,
    }
  );

  const data = schemaQuery.data ?? null;
  const loading = schemaQuery.isLoading || schemaQuery.isFetching;

  const refresh = useCallback(() => {
    void schemaQuery.refetch();
  }, [schemaQuery]);

  const updateFilters = (newEnv: EnvFilter, newLimit: number) => {
    setEnv(newEnv);
    setLimit(newLimit);

    const searchParams = new URLSearchParams();
    if (newEnv !== "all") searchParams.set("env", newEnv);
    if (newLimit !== 25) searchParams.set("limit", String(newLimit));
    
    const queryStr = searchParams.toString();
    router.replace(`/system/schema-history${queryStr ? `?${queryStr}` : ""}`);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const stats = data?.stats ?? {
    totalChanges: 0,
    appliedLast24h: 0,
    appliedLast7d: 0,
    pendingPlanned: 0,
    failedLast24h: 0,
    destructiveLast30d: 0,
  };

  const entries = data?.entries ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6">
      <PageHeader
        parentHref="/system"
        parentLabel="system"
        eyebrow="NOUR OS · System"
        title="schema history"
        description="Database migrations, manual pushes, and DDL schema audit ledger"
        actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              lastFetchedAt={data?.generatedAt}
              source="SchemaChangeLedger table"
              onReload={refresh}
            />
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      />

      {/* Metrics Row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Total Changes" value={stats.totalChanges} />
        <MetricCard label="Applied 24h" value={stats.appliedLast24h} />
        <MetricCard label="Applied 7d" value={stats.appliedLast7d} />
        <MetricCard label="Planned/Pending" value={stats.pendingPlanned} />
        <MetricCard
          label="Failed 24h"
          value={stats.failedLast24h}
          hint={stats.failedLast24h > 0 ? "Inspect failed events immediately" : undefined}
        />
        <MetricCard
          label="Destructive 30d"
          value={stats.destructiveLast30d}
          hint={stats.destructiveLast30d > 0 ? "Requires operator sign-off" : undefined}
        />
      </div>

      {/* Filters & Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] p-3">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-[var(--text-tertiary)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)] mr-2">Environment:</span>
          {(["all", "local", "preview", "production"] as EnvFilter[]).map((e) => (
            <button
              key={e}
              onClick={() => updateFilters(e, limit)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition",
                env === e
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-[var(--text-tertiary)] hover:text-white hover:bg-white/5"
              )}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-tertiary)]">Limit:</span>
          <select
            value={limit}
            onChange={(e) => updateFilters(env, parseInt(e.target.value, 10))}
            title="Limit entries count"
            className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {[25, 50, 100, 200].map((l) => (
              <option key={l} value={l}>
                {l} entries
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ledger list */}
      <div className="space-y-4">
        {entries.length === 0 ? (
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] py-12 text-center">
            <Database className="mx-auto h-8 w-8 text-[var(--text-muted)] opacity-50" />
            <p className="mt-3 text-sm text-[var(--text-secondary)] font-medium">No ledger entries found</p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              No schema changes recorded for the selected filters.
            </p>
          </Panel>
        ) : (
          entries.map((entry) => {
            const isExpanded = expanded.has(entry.id);
            const isDestructive = entry.destructive;

            // Compute status color
            const statusTheme =
              entry.status === "applied"
                ? { bg: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400" }
                : entry.status === "planned"
                  ? { bg: "bg-sky-500/10 text-sky-300 border-sky-500/30", dot: "bg-sky-400" }
                  : entry.status === "failed"
                    ? { bg: "bg-rose-500/10 text-rose-300 border-rose-500/30", dot: "bg-rose-400 animate-pulse" }
                    : { bg: "bg-amber-500/10 text-amber-300 border-amber-500/30", dot: "bg-amber-400" };

            // Compute environment tint
            const envTint =
              entry.environment === "production"
                ? "text-rose-300 border-rose-500/20 bg-rose-500/5"
                : entry.environment === "preview"
                  ? "text-amber-300 border-amber-500/20 bg-amber-500/5"
                  : "text-sky-300 border-sky-500/20 bg-sky-500/5";

            return (
              <div
                key={entry.id}
                className={cn(
                  "relative rounded-2xl border transition duration-200 overflow-hidden",
                  isDestructive
                    ? "border-rose-500/30 bg-rose-500/[0.02] hover:bg-rose-500/[0.03]"
                    : "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] hover:bg-[var(--bg-raised)]/[0.04]"
                )}
              >
                {/* Header Row */}
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[var(--text-secondary)] bg-white/5 px-2 py-0.5 rounded border border-white/10">
                        {entry.changeKey}
                      </span>
                      <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border", statusTheme.bg)}>
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1.5", statusTheme.dot)} />
                        {entry.status}
                      </span>
                      <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border", envTint)}>
                        {entry.environment}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 rounded-full">
                        {entry.changeType}
                      </span>
                      {isDestructive && (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-rose-300 border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-rose-400" />
                          Destructive
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm sm:text-base font-semibold text-white tracking-tight">
                      {entry.title}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {entry.reason}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-xs font-medium text-[var(--text-secondary)]">
                        {entry.appliedAt ? `Applied ${timeAgo(entry.appliedAt)}` : "Planned"}
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">
                        {entry.appliedAt
                          ? `by ${entry.appliedBy ?? "operator"} via ${entry.method}`
                          : `via ${entry.method}`}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleExpand(entry.id)}
                      className="rounded-lg border border-[var(--border-default)] p-2 hover:bg-white/5 transition text-[var(--text-secondary)]"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Details Section */}
                {isExpanded && (
                  <div className="border-t border-[var(--border-default)] bg-black/20 p-4 sm:p-5 space-y-4">
                    {/* Destructive Warning Panel */}
                    {isDestructive && (
                      <div className="flex gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs">
                        <Shield className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <div className="font-semibold text-rose-300">Destructive Mutation Warning</div>
                          <p className="text-rose-200/80 leading-relaxed">
                            This change dropped columns, renamed elements, or narrowed datatypes, which carries a risk of data loss. Approved by **{entry.approvedBy ?? "operator"}**.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1">
                          <Terminal className="h-3.5 w-3.5" />
                          SQL Summary / Schema Detail
                        </div>
                        <pre className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-black/40 p-3 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap max-h-60">
                          {entry.sqlSummary || "No SQL summary recorded."}
                        </pre>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1">
                          <FileCode className="h-3.5 w-3.5" />
                          Prisma Schema Diff
                        </div>
                        <pre className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-black/40 p-3 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap max-h-60">
                          {entry.prismaDiff || "No schema diff recorded."}
                        </pre>
                      </div>
                    </div>

                    {/* Metadata & Rollback */}
                    <div className="grid gap-4 sm:grid-cols-2 border-t border-white/5 pt-4 text-xs">
                      <div>
                        <span className="font-semibold text-[var(--text-secondary)]">Rollback Plan:</span>
                        <p className="mt-1 text-[var(--text-tertiary)] leading-relaxed font-mono whitespace-pre-wrap">
                          {entry.rollbackPlan || "No rollback plan specified."}
                        </p>
                      </div>

                      <div className="sm:text-right space-y-1">
                        <div>
                          <span className="font-semibold text-[var(--text-secondary)]">Audit Metadata:</span>
                        </div>
                        <div className="text-[var(--text-tertiary)]">
                          Created: {new Date(entry.createdAt).toLocaleString()}
                        </div>
                        {entry.appliedAt && (
                          <div className="text-[var(--text-tertiary)]">
                            Applied: {new Date(entry.appliedAt).toLocaleString()} by {entry.appliedBy}
                          </div>
                        )}
                        {entry.approvedBy && (
                          <div className="text-[var(--text-tertiary)]">
                            Approved: {entry.approvedBy}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
