"use client";

/**
 * /system/embedding-coverage · v8.13 · Apr 29.
 *
 * Operator dashboard for the in-flight pgvector migration. Reads
 * /api/system/embedding-coverage and shows:
 *   · Pgvector extension availability + dual-write coverage %
 *   · Backfill remaining + recent backfill cron runs
 *   · Per-sourceType breakdown (brain_memory dominates)
 *   · Recent semantic-dedup runs with their pgvector vs JS row split
 *
 * The v8.12 dedup telemetry surfaces here so Nour can watch the SQL
 * path overtake the JS path as the backfill drains.
 */

// PageHeader removed · parent /system/coverage page provides one
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, AlertTriangle, Database, Activity } from "lucide-react";

interface CoveragePayload {
  pgvectorAvailable: boolean;
  backfillBackgroundError: string | null;
  rollup: {
    totalRows: number;
    totalWithVec: number;
    backfillRemaining: number;
    coveragePct: number;
  };
  perSource: Array<{
    sourceType: string;
    total: number;
    withVec: number;
    coveragePct: number;
  }>;
  recentDedupRuns: Array<{
    at: string;
    summary: string;
    pgvectorAvailable: boolean;
    rowsCoveredAcrossCategories: number;
    rowsViaJsAcrossCategories: number;
    deleted: number;
    durationMs: number;
  }>;
  recentBackfillRuns: Array<{
    at: string;
    status: string;
    durationMs: number | null;
    error: string | null;
  }>;
  generatedAt: string;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function CoverageEmbeddingView() {
  // Phase VV (2026-05-22) · REST→tRPC · system.embeddingCoverage. The
  // legacy route returned the payload directly (no `{data}` wrap); the
  // procedure returns the same shape. FreshnessChip's timestamp comes
  // from React Query's dataUpdatedAt; reload repoints to refetch.
  const coverageQuery = trpc.system.embeddingCoverage.useQuery();
  const data: CoveragePayload | null = coverageQuery.data ?? null;
  const loading = coverageQuery.isPending;
  const error = coverageQuery.error
    ? coverageQuery.error.message || "fetch failed"
    : null;
  const lastFetched = coverageQuery.dataUpdatedAt
    ? new Date(coverageQuery.dataUpdatedAt)
    : null;
  const load = () => void coverageQuery.refetch();

  return (
    <div className="space-y-4">
      {/* PageHeader removed · parent /coverage owns the canonical title */}
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {data?.pgvectorAvailable ? (
              <Badge className="h-auto gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-normal text-emerald-300">
                <CheckCircle2 size={11} /> pgvector enabled
              </Badge>
            ) : (
              <Badge className="h-auto gap-1.5 rounded-full border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-mono font-normal text-rose-300">
                <AlertTriangle size={11} /> pgvector OFF
              </Badge>
            )}
            {data?.backfillBackgroundError && (
              <span className="text-[10px] font-mono text-rose-300">
                · {data.backfillBackgroundError}
              </span>
            )}
          </div>
          <FreshnessChip
            lastFetchedAt={lastFetched}
            source="api/system/embedding-coverage"
            onReload={() => void load()}
          />
        </div>

        {error && !data && (
          <p className="mt-4 rounded border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-200">
            {error}
          </p>
        )}

        {loading && !data && (
          <p className="mt-4 text-[11px] text-zinc-500">loading…</p>
        )}

        {data && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              icon={<Database size={12} />}
              label="total rows"
              value={data.rollup.totalRows}
            />
            <Tile
              icon={<CheckCircle2 size={12} />}
              label="with embedding_vec"
              value={data.rollup.totalWithVec}
              tone="emerald"
            />
            <Tile
              icon={<Activity size={12} />}
              label="backfill remaining"
              value={data.rollup.backfillRemaining}
              tone={data.rollup.backfillRemaining > 0 ? "amber" : "emerald"}
            />
            <Tile
              icon={<Activity size={12} />}
              label="coverage"
              value={data.rollup.coveragePct}
              suffix="%"
              decimals={1}
              tone={data.rollup.coveragePct >= 95 ? "emerald" : "amber"}
            />
          </div>
        )}

        {/* Coverage bar — visual hint */}
        {data && data.rollup.totalRows > 0 && (
          <div className="mt-3">
            <div className="h-1.5 w-full rounded-full bg-zinc-800/60">
              <div
                className="h-1.5 rounded-full bg-emerald-400/70 transition-all duration-700"
                style={{
                  width: `${Math.min(100, data.rollup.coveragePct)}%`,
                }}
              />
            </div>
          </div>
        )}
      </Panel>

      {/* Per-sourceType breakdown */}
      {data && data.perSource.length > 0 && (
        <Panel className="mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
            By source type
          </h2>
          <div className="space-y-2 stagger-in">
            {data.perSource.map((row) => (
              <div
                key={row.sourceType}
                className="rounded border border-zinc-800 bg-zinc-950/40 p-2.5"
              >
                <div className="mb-1 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-zinc-200">{row.sourceType}</span>
                  <span className="text-zinc-500">
                    <AnimatedCounter value={row.withVec} /> /{" "}
                    <AnimatedCounter value={row.total} /> ·{" "}
                    <AnimatedCounter value={row.coveragePct} decimals={1} />%
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-zinc-800/60">
                  <div
                    className="h-1 rounded-full bg-emerald-400/70 transition-all duration-700"
                    style={{ width: `${Math.min(100, row.coveragePct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Recent dedup runs */}
      {data && (
        <Panel className="mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
            Recent dedup runs
          </h2>
          {data.recentDedupRuns.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No dedup runs in audit log yet.</p>
          ) : (
            <ul className="space-y-1.5 stagger-in">
              {data.recentDedupRuns.map((run, i) => {
                const totalRows =
                  run.rowsCoveredAcrossCategories + run.rowsViaJsAcrossCategories;
                const pgvectorPct =
                  totalRows === 0 ? 0 : (run.rowsCoveredAcrossCategories / totalRows) * 100;
                return (
                  <li
                    key={i}
                    className="rounded border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px]"
                  >
                    <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      <span>{relTime(run.at)}</span>
                      <span>{fmtMs(run.durationMs)}</span>
                    </div>
                    <p className="text-zinc-200">{run.summary}</p>
                    {run.pgvectorAvailable && totalRows > 0 && (
                      <p className="mt-1 font-mono text-[10px] text-zinc-500">
                        pgvector{" "}
                        <span className="text-emerald-300">
                          <AnimatedCounter value={pgvectorPct} decimals={0} />%
                        </span>
                        {" · "}js{" "}
                        <span className="text-amber-300">
                          <AnimatedCounter value={100 - pgvectorPct} decimals={0} />%
                        </span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {/* Recent backfill runs */}
      {data && (
        <Panel className="mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
            Recent backfill cron runs
          </h2>
          {data.recentBackfillRuns.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              No pgvector-backfill cron logs yet — folded into mega-evening,
              first run will populate this list.
            </p>
          ) : (
            <ul className="space-y-1">
              {data.recentBackfillRuns.map((run, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5 text-[10px] font-mono"
                >
                  <span className="text-zinc-500">{relTime(run.at)}</span>
                  <span
                    className={
                      run.status === "success"
                        ? "text-emerald-300"
                        : "text-rose-300"
                    }
                  >
                    {run.status}
                  </span>
                  <span className="text-zinc-500">{fmtMs(run.durationMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  suffix = "",
  decimals = 0,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  tone?: "default" | "emerald" | "amber";
}) {
  const tint =
    tone === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
        : "border-zinc-700 bg-zinc-900/40 text-zinc-200";
  return (
    <div className={`rounded-lg border p-3 ${tint}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums">
        <AnimatedCounter value={value} decimals={decimals} suffix={suffix} />
      </div>
    </div>
  );
}
