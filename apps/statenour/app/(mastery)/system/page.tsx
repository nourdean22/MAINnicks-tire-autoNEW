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

import { useCallback } from "react";
import { Panel } from "@/components/panel";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/layout/ui";
import { usePullRefresh } from "@/lib/hooks/use-pull-refresh";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SystemHubGrid } from "@/components/system/hub-grid";
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
  queue: { pending: number; failed: number };
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
    healthQuery.isFetching;
  const lastRefresh =
    diagnosticsQuery.dataUpdatedAt > 0
      ? new Date(diagnosticsQuery.dataUpdatedAt)
      : new Date();

  const refresh = useCallback(async () => {
    await Promise.all([
      diagnosticsQuery.refetch(),
      brainQuery.refetch(),
      healthQuery.refetch(),
    ]);
  }, [diagnosticsQuery, brainQuery, healthQuery]);

  const { refreshing, onTouchStart, onTouchEnd } = usePullRefresh(refresh);

  const d = diagnostics;
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
        description={`v${d?.version ?? "..."} · Last refresh: ${lastRefresh.toLocaleTimeString()}`}
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
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span>Queue: <AnimatedCounter value={d?.queue.pending ?? 0} /> pending</span>
          {(d?.queue.failed ?? 0) > 0 && (
            <span className="text-red-400"><AnimatedCounter value={d!.queue.failed} /> failed</span>
          )}
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
          value={d ? `${d.kpis.latency_24h.avg_ms}ms` : "..."}
          hint="24h average"
        />
        <MetricCard
          label="Errors (24h)"
          value={d?.kpis.errors_24h ?? "..."}
          hint={d && d.kpis.errors_24h > 0 ? "Check /system/errors" : "Clean"}
        />
        <MetricCard
          label="AI Cost (7d)"
          value={d ? `$${((d.kpis.ai_cost_7d_cents ?? 0) / 100).toFixed(2)}` : "..."}
          hint="7 day total"
        />
      </div>

      {/* Ops telemetry — cost SLO · voice latency · eval pass · drift */}
      <ObservabilityRow />

      {/* ── NAVIGATION ───────────────────────────────────────────── */}
      {/* System hub — live-chip cards grouped by domain. Degraded
          subsurfaces lift into a "needs attention" strip at the top
          of the grid. */}
      <SystemHubGrid />

      {/* ── DETAIL ───────────────────────────────────────────────── */}
      {/* Two-column grid: Devices + Brain */}
      <div className="grid gap-4 md:grid-cols-2 stagger-in">
        {/* Devices panel — emerald/red/amber cells map to real
            severity states (online good · offline bad · error warn). */}
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">devices</h3>
            <span className="text-xs text-[var(--text-tertiary)]">{d?.devices.total ?? 0} total</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <div className="text-2xl font-bold text-emerald-400">{d?.devices.online ?? 0}</div>
              <div className="text-[10px] text-emerald-400/60 uppercase">Online</div>
            </div>
            <div className="rounded-lg bg-red-500/10 p-3">
              <div className="text-2xl font-bold text-red-400">{d?.devices.offline ?? 0}</div>
              <div className="text-[10px] text-red-400/60 uppercase">Offline</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-3">
              <div className="text-2xl font-bold text-amber-400">{d?.devices.error ?? 0}</div>
              <div className="text-[10px] text-amber-400/60 uppercase">Error</div>
            </div>
          </div>
          {health && (
            <div className="mt-3 flex gap-3 text-xs text-[var(--text-tertiary)]">
              <span>drift alerts: {health.alerts?.unresolved ?? 0}</span>
              <span>commitments: {health.commitments?.active ?? 0}</span>
            </div>
          )}
        </Panel>

        {/* Brain panel — Wave 52 · palette corrected. Permanent /
            Temporary / Rules are inventory counts, NOT severity
            states, so they no longer borrow decorative violet/blue/
            cyan. Permanent (the headline brain stat) carries the gold
            brand accent · the other two stay neutral. */}
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Nick brain</h3>
            <span className="text-xs text-[var(--text-tertiary)]">
              {brain?.memories.total ?? 0} memories
            </span>
          </div>
          {brain ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--gold)]/10 p-3">
                  <div className="text-2xl font-bold text-[var(--gold)]">{brain.memories.permanent}</div>
                  <div className="text-[10px] uppercase text-[var(--text-tertiary)]">Permanent</div>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="text-2xl font-bold text-white">{brain.memories.temporary}</div>
                  <div className="text-[10px] uppercase text-[var(--text-tertiary)]">Temporary</div>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="text-2xl font-bold text-white">{brain.automationRules.active}</div>
                  <div className="text-[10px] uppercase text-[var(--text-tertiary)]">Rules</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-[var(--text-tertiary)]">
                avg confidence: {(brain.memories.avgConfidence * 100).toFixed(0)}%
                {brain.memories.byCategory.length > 0 && (
                  <span className="ml-2">
                    top: {brain.memories.byCategory[0]?.category} ({brain.memories.byCategory[0]?.count})
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-[var(--text-tertiary)] text-center py-6">loading…</div>
          )}
        </Panel>
      </div>

      {/* Integrations */}
      {d && d.integrations.length > 0 && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <h3 className="mb-3 text-sm font-semibold text-white">integrations</h3>
          <div className="space-y-2">
            {d.integrations.map((intg) => (
              <div
                key={intg.name}
                className="flex items-center justify-between rounded-lg bg-[var(--bg-raised)]/[0.02] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={intg.status} />
                  <span className="text-sm text-zinc-200">{intg.name}</span>
                </div>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {intg.lastSync ? timeAgo(intg.lastSync) : "never synced"}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
