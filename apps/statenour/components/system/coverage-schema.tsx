"use client";

/**
 * /system/schema-coverage · v10.0.24 · Apr 30.
 *
 * Index coverage audit — every tracked model with row count + index
 * count + heuristic flag for under-indexed hot tables. Cross-refs
 * /system/slow-queries so a flagged model that's also in slow queries
 * is the one to fix first.
 */

import { useState } from "react";
// PageHeader removed · parent /system/coverage page provides one
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { trpc } from "@/lib/trpc/client";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelCoverage {
  modelName: string;
  tableName: string;
  estimatedRows: number;
  indexCount: number;
  inRecentSlowQueries: boolean;
  flagged: boolean;
  flagReason: string | null;
}

interface Payload {
  generatedAt: string;
  totalModels: number;
  flaggedCount: number;
  totalRowsEstimate: number;
  permissionDenied: boolean;
  models: ModelCoverage[];
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function CoverageSchemaView() {
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  // Phase VV (2026-05-22) · REST→tRPC · system.schemaCoverage. The
  // legacy route returned the report directly (no `{data}` wrap); the
  // procedure returns the same shape. FreshnessChip's timestamp comes
  // from React Query's dataUpdatedAt; reload repoints to refetch.
  const coverageQuery = trpc.system.schemaCoverage.useQuery();
  const data: Payload | null = coverageQuery.data ?? null;
  const loading = coverageQuery.isPending;
  const error = coverageQuery.error
    ? coverageQuery.error.message || "fetch failed"
    : null;
  const lastFetched = coverageQuery.dataUpdatedAt
    ? new Date(coverageQuery.dataUpdatedAt)
    : null;
  const load = () => void coverageQuery.refetch();

  const visible = data
    ? showFlaggedOnly
      ? data.models.filter((m) => m.flagged)
      : data.models
    : [];

  return (
    <div className="space-y-4">
      {/* Mini-header replaces PageHeader · parent /coverage owns the
          canonical title. */}
      <div className="flex items-center justify-end">
        <FreshnessChip
          lastFetchedAt={lastFetched}
          source="api/system/schema-coverage"
          onReload={() => void load()}
        />
      </div>

      {error && !data && (
        <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
          <p className="p-3 text-[12px] text-rose-200">{error}</p>
        </Panel>
      )}

      {loading && !data && (
        <Panel>
          <p className="p-6 text-center text-[11px] text-zinc-500">loading…</p>
        </Panel>
      )}

      {data && (
        <>
          {/* v10.0.26 — permission-denied banner so silent zero-data
              doesn't masquerade as "all healthy". */}
          {data.permissionDenied && (
            <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
              <p className="p-3 text-[11px] text-rose-200">
                <AlertTriangle size={12} className="inline mr-1" />
                <strong>Permission denied:</strong> the database role
                cannot read <code>pg_stat_user_tables</code> or{" "}
                <code>pg_indexes</code>. Row counts + index counts are
                showing 0 for every model. Grant <code>pg_monitor</code>{" "}
                (or <code>pg_read_all_stats</code>) to the application
                role to enable this dashboard.
              </p>
            </Panel>
          )}

          {/* Pulse */}
          <Panel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Cell
                icon={<Layers size={11} />}
                label="tracked models"
                value={data.totalModels}
                color="text-zinc-200"
              />
              <Cell
                icon={<Database size={11} />}
                label="total rows"
                value={data.totalRowsEstimate}
                fmt={fmtNum}
                color="text-emerald-200"
              />
              <Cell
                icon={<AlertTriangle size={11} />}
                label="flagged"
                value={data.flaggedCount}
                color={
                  data.flaggedCount > 0
                    ? "text-rose-300"
                    : "text-zinc-400"
                }
              />
            </div>
          </Panel>

          {/* Filter */}
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-zinc-500">
              showing {visible.length} of {data.models.length}
            </span>
            {data.flaggedCount > 0 && (
              <button
                onClick={() => setShowFlaggedOnly((v) => !v)}
                className={cn(
                  "rounded border px-2 py-1 transition",
                  showFlaggedOnly
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                    : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {showFlaggedOnly ? "✓ flagged only" : "flagged only"}
              </button>
            )}
          </div>

          {/* Models table */}
          <Panel>
            {visible.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-zinc-500">
                {showFlaggedOnly
                  ? "Nothing flagged in the current window."
                  : "No models tracked."}
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {visible.map((m) => (
                  <div key={m.modelName} className="py-2.5">
                    <div className="flex items-center gap-2 px-2">
                      {m.flagged ? (
                        <AlertTriangle
                          size={12}
                          className="text-rose-300"
                        />
                      ) : (
                        <CheckCircle2
                          size={12}
                          className="text-emerald-300"
                        />
                      )}
                      <span className="text-[11px] font-mono text-zinc-200">
                        {m.modelName}
                      </span>
                      <span className="text-[9px] font-mono text-zinc-500">
                        {m.tableName}
                      </span>
                      {m.inRecentSlowQueries && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-amber-200">
                          <Zap size={9} />
                          in slow queries
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-3 text-[10px] tabular-nums text-zinc-400">
                        <span>{fmtNum(m.estimatedRows)} rows</span>
                        <span>·</span>
                        <span>
                          {m.indexCount}{" "}
                          index{m.indexCount === 1 ? "" : "es"}
                        </span>
                      </span>
                    </div>
                    {m.flagReason && (
                      <div className="mt-1 px-2 text-[10px] text-rose-300/90">
                        ⚠ {m.flagReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <p className="text-center text-[10px] text-zinc-600">
            Generated {new Date(data.generatedAt).toLocaleString()} ·
            v10 Horizon 5 · row counts from <code>pg_stat_user_tables</code>
          </p>
        </>
      )}
    </div>
  );
}

function Cell({
  icon,
  label,
  value,
  fmt,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  fmt?: (v: number) => string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", color)}>
        {fmt ? <span>{fmt(value)}</span> : <AnimatedCounter value={value} />}
      </div>
    </div>
  );
}
