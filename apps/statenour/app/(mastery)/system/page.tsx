"use client";

/**
 * /system — operator system surface.
 *
 * Layout contract (Wave 52 · 2026-05-20 redesign):
 *   1. STATUS FIRST  — overall status + KPIs + ops telemetry. The
 *      answer to "is everything OK?" renders ABOVE the nav grid.
 *   2. NAVIGATION    — <SystemHubGrid />, the grouped card hub.
 *   3. DETAIL        — devices · brain · integrations.
 *
 * Pre-Wave-52 the page led with the 37-card grid and buried status
 * at section #4-5. Three debug-dump panels (raw Prisma row counts ·
 * automation-rule list · recent-pattern list) were also deleted —
 * each duplicates a dedicated hub surface (Schema Coverage ·
 * Automation Policies · Brain Categories).
 */

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/panel";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/layout/ui";
import { usePullRefresh } from "@/lib/hooks/use-pull-refresh";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SystemHubGrid } from "@/components/system/hub-grid";
import { AgendaDesk } from "@/components/system/agenda-desk";
// ObservabilityRow · 4-tile ops telemetry (cost SLO · voice latency ·
// eval pass rate · OS drift). Relocated from /ultron at v10.0.529.48.
import { ObservabilityRow } from "@/components/ultron/observability/observability-row";

// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the three
// authedFetch reads (diagnostics + brain status + health) are now three
// typed useQueries. The page polled on a 60s setInterval — each query's
// `refetchInterval` drives that. `refresh` (pull-to-refresh + the manual
// Refresh button) now refetches all three.
import { trpc } from "@/lib/trpc/client";

interface DiagnosticsData {
  db: { connected: boolean; latency_ms: number };
  kpis: {
    latency_24h: { avg_ms: number; p95_ms: number };
    errors_24h: number;
    requests_24h: number;
    ai_cost_7d_cents: number;
  };
  devices: { online: number; offline: number; error: number; total: number };
  integrations: { name: string; status: string; enabled: boolean; lastSync: string | null }[];
  version: string;
  timestamp: string;
}

interface BrainStatus {
  memories: {
    total: number;
    permanent: number;
    temporary: number;
    avgConfidence: number;
    byCategory: { category: string; count: number }[];
  };
  automationRules: { active: number };
}

interface HealthData {
  status: string;
  db?: { connected: boolean; latency_ms: number };
  devices?: { online: number; offline: number; total: number };
  alerts?: { unresolved: number };
  commitments?: { active: number };
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "healthy" || status === "ok" || status === "ONLINE"
      ? "bg-emerald-400"
      : status === "degraded" || status === "warn"
        ? "bg-amber-400"
        : status === "failed" || status === "fail" || status === "OFFLINE"
          ? "bg-red-400"
          : "bg-zinc-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

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

export default function SystemPage() {
  // Phase B.7a · three typed useQueries replace the Promise.all of
  // authedFetch calls. 60s refetchInterval mirrors the prior setInterval.
  const diagnosticsQuery = trpc.system.diagnostics.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const brainQuery = trpc.brain.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const healthQuery = trpc.system.healthSummary.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const changeDigestQuery = trpc.system.changeDigest.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const memoryEvalsQuery = trpc.system.memoryEvals.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const receiptFeedQuery = trpc.system.receiptFeed.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const agendaItemsQuery = trpc.system.agendaItems.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // The procedure return shapes are wider than these page-local view
  // interfaces (brain.status' `memories` is a Record<string,unknown>
  // service shape) · cast through `unknown` to the page's read view.
  const diagnostics: DiagnosticsData | null =
    (diagnosticsQuery.data as unknown as DiagnosticsData | undefined) ?? null;
  const brain: BrainStatus | null =
    (brainQuery.data as unknown as BrainStatus | undefined) ?? null;
  const health: HealthData | null =
    (healthQuery.data as unknown as HealthData | undefined) ?? null;
  const loading =
    diagnosticsQuery.isFetching ||
    brainQuery.isFetching ||
    healthQuery.isFetching ||
    changeDigestQuery.isFetching ||
    memoryEvalsQuery.isFetching ||
    receiptFeedQuery.isFetching ||
    agendaItemsQuery.isFetching;
  // Hydration fix (React #418) · the "Last refresh" wall-clock differs
  // between the SSR render and the first client render (server time vs
  // client time, ms apart). Gate it behind a mounted flag so the
  // initial HTML matches on both, then fill it in client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const lastRefresh =
    diagnosticsQuery.dataUpdatedAt > 0
      ? new Date(diagnosticsQuery.dataUpdatedAt)
      : new Date();

  const refresh = useCallback(async () => {
    await Promise.all([
      diagnosticsQuery.refetch(),
      brainQuery.refetch(),
      healthQuery.refetch(),
      changeDigestQuery.refetch(),
      memoryEvalsQuery.refetch(),
      receiptFeedQuery.refetch(),
      agendaItemsQuery.refetch(),
    ] as any[]);
  }, [diagnosticsQuery, brainQuery, healthQuery, changeDigestQuery, memoryEvalsQuery, receiptFeedQuery, agendaItemsQuery]);

  const { refreshing, onTouchStart, onTouchEnd } = usePullRefresh(refresh);

  const d = diagnostics;
  // truth-substrate audit #7: the former `queue.failed === 0` input was a
  // fabricated zero (statenour has no job-queue) — removed. Status now reflects
  // the real DB-connectivity measurement.
  const overallStatus = d?.db.connected ? "healthy" : "degraded";

  return (
    <div
      className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {refreshing && (
        <div className="text-center text-xs text-[var(--text-tertiary)] animate-pulse">Refreshing...</div>
      )}
      <PageHeader
        eyebrow="NOUR OS"
        title="system"
        description={`v${d?.version ?? "..."}${mounted && diagnosticsQuery.dataUpdatedAt > 0 ? ` · Last refresh: ${new Date(diagnosticsQuery.dataUpdatedAt).toLocaleTimeString()}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              lastFetchedAt={diagnostics?.timestamp ?? lastRefresh.toISOString()}
              source="diagnostics + brain + health"
              onReload={refresh}
            />
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      />

      {/* ── STATUS FIRST ─────────────────────────────────────────── */}

      {/* Overall status bar */}
      <Panel className="flex items-center justify-between gap-4 border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] p-4">
        <div className="flex items-center gap-3">
          <StatusDot status={overallStatus} />
          <span className="text-sm font-semibold text-white uppercase">
            {overallStatus}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            DB: {d?.db.latency_ms !== undefined ? <AnimatedCounter value={d.db.latency_ms} /> : "..."}ms
          </span>
        </div>
      </Panel>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 stagger-in">
        <MetricCard
          label="Requests (24h)"
          value={d?.kpis.requests_24h ?? "..."}
          hint="API calls"
        />
        <MetricCard
          label="Avg Latency"
          // avg_ms === 0 with live traffic means latency isn't being
          // tracked (no data), not a real 0ms. Show an em-dash so the
          // tile reads as "unknown" rather than an implausible zero.
          value={d ? (d.kpis.latency_24h.avg_ms > 0 ? `${d.kpis.latency_24h.avg_ms}ms` : "—") : "..."}
          hint={d && d.kpis.latency_24h.avg_ms === 0 ? "no data yet" : "24h average"}
        />
        <MetricCard
          label="Errors (24h)"
          value={d?.kpis.errors_24h ?? "..."}
          hint={d && d.kpis.errors_24h > 0 ? "Check /system/logs" : "Clean"}
        />
      </div>

      {/* Ops telemetry — cost SLO · voice latency · eval pass · drift */}
      <ObservabilityRow />

      {/* ── NAVIGATION ───────────────────────────────────────────── */}
      {/* System hub — live-chip cards grouped by domain. Degraded
          subsurfaces lift into a "needs attention" strip at the top
          of the grid. */}
      <SystemHubGrid />

      {/* ── SYSTEM DIGESTS (Wire 3) ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Change Digest Card */}
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">F2 · System Change Digest</span>
              <h3 className="text-sm font-semibold text-white mt-0.5">Reconciliation Summary</h3>
            </div>
            {changeDigestQuery.data?.deployment.status && (
              <span className="flex items-center gap-1.5 rounded-full bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                <StatusDot status={changeDigestQuery.data.deployment.status === "production" ? "ONLINE" : "degraded"} />
                {changeDigestQuery.data.deployment.status}
              </span>
            )}
          </div>

          {changeDigestQuery.isLoading ? (
            <div className="space-y-2 py-4">
              <div className="h-4 bg-zinc-900/50 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-zinc-900/50 rounded animate-pulse w-1/2" />
            </div>
          ) : changeDigestQuery.data ? (
            <div className="space-y-3.5 text-xs">
              {/* Latest Wave */}
              {changeDigestQuery.data.latestWave && (
                <div className="space-y-1">
                  <div className="text-zinc-500 font-medium">LATEST WAVE</div>
                  <div className="text-zinc-200">
                    {changeDigestQuery.data.latestWave.date} &middot; {changeDigestQuery.data.latestWave.title}
                  </div>
                  {changeDigestQuery.data.latestWave.verifyGate && (
                    <div className="text-zinc-500 font-mono text-[11px]">
                      Verify: {changeDigestQuery.data.latestWave.verifyGate}
                    </div>
                  )}
                </div>
              )}

              {/* Deployment info */}
              <div className="space-y-1 border-t border-zinc-800/60 pt-2.5">
                <div className="text-zinc-500 font-medium">DEPLOYMENT</div>
                <div className="text-zinc-300 flex items-center gap-2 flex-wrap">
                  <span className="font-mono bg-zinc-900 px-1 rounded text-[11px]">
                    {changeDigestQuery.data.deployment.sha?.slice(0, 7) || "unknown"}
                  </span>
                  <span>({changeDigestQuery.data.deployment.branch || "unknown"})</span>
                  <span className="text-[11px] text-zinc-500 font-mono italic">
                    via {changeDigestQuery.data.deployment.source}
                  </span>
                </div>
                <div className="text-zinc-400 font-mono text-[10px] mt-0.5">
                  {changeDigestQuery.data.deployment.note}
                </div>
              </div>

              {/* Truth details */}
              <div className="space-y-1 border-t border-zinc-800/60 pt-2.5">
                <div className="text-zinc-500 font-medium">TRUTH STALENESS</div>
                <div className="flex items-center gap-4 text-zinc-300">
                  <span className="flex items-center gap-1">
                    <span className={changeDigestQuery.data.truth.staleCriticalInKeyDocs > 0 ? "text-red-400 font-bold" : "text-zinc-400"}>
                      {changeDigestQuery.data.truth.staleCriticalInKeyDocs}
                    </span>{" "}
                    Critical stale
                  </span>
                  <span className="flex items-center gap-1">
                    <span>{changeDigestQuery.data.truth.staleWarnInKeyDocs}</span> Warnings
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Runbooks: {changeDigestQuery.data.truth.runbooksActive} active
                </div>
              </div>

              {/* Risks */}
              {changeDigestQuery.data.risks.length > 0 && (
                <div className="space-y-1 border-t border-zinc-800/60 pt-2.5">
                  <div className="text-red-400 font-medium">DEPLOY RISKS</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-zinc-400">
                    {changeDigestQuery.data.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs py-4">No change digest available.</div>
          )}
        </Panel>

        {/* Memory Evals Card */}
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">P5 · Grounded Truth Evals</span>
              <h3 className="text-sm font-semibold text-white mt-0.5">Scoreboard</h3>
            </div>
            {memoryEvalsQuery.data && (
              <span className="rounded-full bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                {memoryEvalsQuery.data.passed}/{memoryEvalsQuery.data.total} passed
              </span>
            )}
          </div>

          {memoryEvalsQuery.isLoading ? (
            <div className="space-y-2 py-4">
              <div className="h-4 bg-zinc-900/50 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-zinc-900/50 rounded animate-pulse w-1/2" />
            </div>
          ) : memoryEvalsQuery.data ? (
            <div className="space-y-3 text-xs flex-1 flex flex-col">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-zinc-900/40 border border-zinc-800/40 p-1.5">
                  <div className="text-emerald-400 text-sm font-bold">{memoryEvalsQuery.data.passed}</div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500">Passed</div>
                </div>
                <div className="rounded bg-zinc-900/40 border border-zinc-800/40 p-1.5">
                  <div className="text-red-400 text-sm font-bold">{memoryEvalsQuery.data.failed}</div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500">Failed</div>
                </div>
                <div className="rounded bg-zinc-900/40 border border-zinc-800/40 p-1.5">
                  <div className="text-zinc-400 text-sm font-bold">{memoryEvalsQuery.data.manual}</div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500">Manual</div>
                </div>
              </div>

              {/* Failures List */}
              <div className="flex-1 overflow-auto max-h-[160px] pr-1 space-y-1.5">
                <div className="text-zinc-500 font-medium font-mono uppercase tracking-wider text-[10px]">Failures</div>
                {memoryEvalsQuery.data.failed === 0 ? (
                  <div className="text-emerald-400 text-[11px] font-mono">
                    ✓ All grounded truth evaluations are passing!
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {memoryEvalsQuery.data.results
                      .filter((r) => r.status === "fail")
                      .map((f) => (
                        <div key={f.id} className="border-l-2 border-red-500/40 pl-2 py-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] uppercase tracking-wider font-mono text-red-400 bg-red-950/20 border border-red-900/35 px-1 rounded">
                              {f.severity}
                            </span>
                            <span className="text-zinc-400 font-mono text-[10px]">{f.id}</span>
                          </div>
                          {f.note && <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">{f.note}</div>}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="border-t border-zinc-850 pt-2 text-[10px] font-mono text-zinc-500 flex justify-between">
                <span>Docs Grounded: {memoryEvalsQuery.data.sourcesFound}/{memoryEvalsQuery.data.sourcesExpected}</span>
              </div>
            </div>
          ) : (
            <div className="text-zinc-500 text-xs py-4">No evaluations available.</div>
          )}
        </Panel>

        {/* Action Receipt Feed Card */}
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] p-5 flex flex-col gap-4 md:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">F4 · Action Receipt Feed</span>
              <h3 className="text-sm font-semibold text-white mt-0.5">Recent Activities</h3>
            </div>
            {receiptFeedQuery.data?.counts && (
              <span className="rounded-full bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                {receiptFeedQuery.data.items.length} items
              </span>
            )}
          </div>

          {receiptFeedQuery.isLoading ? (
            <div className="space-y-2 py-4">
              <div className="h-4 bg-zinc-900/50 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-zinc-900/50 rounded animate-pulse w-1/2" />
            </div>
          ) : receiptFeedQuery.data ? (
            <div className="flex-1 overflow-auto max-h-[220px] pr-1 space-y-2">
              {receiptFeedQuery.data.items.length === 0 ? (
                <div className="text-zinc-600 text-xs text-center py-6">No recent actions recorded.</div>
              ) : (
                <div className="divide-y divide-zinc-900/50 space-y-2">
                  {receiptFeedQuery.data.items.map((r) => {
                    const statusDotColor =
                      r.status === "success"
                        ? "bg-emerald-400"
                        : r.status === "failed"
                          ? "bg-red-400"
                          : r.status === "needs_approval"
                            ? "bg-amber-400"
                            : "bg-zinc-500";
                    return (
                      <div key={r.receiptId} className="flex gap-2.5 pt-2 first:pt-0">
                        <div className="mt-1">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotColor}`} />
                        </div>
                        <div className="flex-1 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                              {r.toolName}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {timeAgo(r.createdAt)}
                            </span>
                          </div>
                          <p className="text-zinc-200 text-xs leading-tight">
                            {r.userVisibleSummary}
                          </p>
                          {!!r.metadata?.actor && (
                            <div className="text-[9px] text-zinc-500 font-mono">
                              by {String(r.metadata.actor)} {r.metadata.source ? `(${String(r.metadata.source)})` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs py-4">No recent receipts available.</div>
          )}
        </Panel>

        {/* Agenda Desk Card */}
        <AgendaDesk queryResult={agendaItemsQuery} />
      </div>

      {/* 2026-05-24 · Wave W Phase 1 · DELETION · the lower "DETAIL"
          two-column grid (Devices + Nick brain panels) + the
          Integrations panel were all duplicated downstream:
            · Devices panel · same data + drift alerts surface on
              /system/devices (route since removed in the hub-grid prune)
            · Nick brain panel · same memory counts surface on
              /brain · /brain/health · /system/coverage
            · Integrations · same status surfaces on the hub-grid
              cards + /system/health
          Wave 52 already deleted 3 sibling debug-dump cards for
          this same reason (per file header). This finishes the
          job. SystemHubGrid above is the page · attention-strip
          already lifts degraded surfaces above their groups so
          the live signal is preserved.
          ~95 LOC removed. */}
    </div>
  );
}
