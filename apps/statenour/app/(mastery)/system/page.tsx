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
    ]);
  }, [diagnosticsQuery, brainQuery, healthQuery]);

  const { refreshing, onTouchStart, onTouchEnd } = usePullRefresh(refresh);

  const d = diagnostics;
  const overallStatus =
    d?.db.connected && (d?.queue.failed ?? 0) === 0 ? "healthy" : "degraded";

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
          // avg_ms === 0 with live traffic means latency isn't being
          // tracked (no data), not a real 0ms. Show an em-dash so the
          // tile reads as "unknown" rather than an implausible zero.
          value={d ? (d.kpis.latency_24h.avg_ms > 0 ? `${d.kpis.latency_24h.avg_ms}ms` : "—") : "..."}
          hint={d && d.kpis.latency_24h.avg_ms === 0 ? "no data yet" : "24h average"}
        />
        <MetricCard
          label="Errors (24h)"
          value={d?.kpis.errors_24h ?? "..."}
          hint={d && d.kpis.errors_24h > 0 ? "Check /system/errors" : "Clean"}
        />
      </div>

      {/* Ops telemetry — cost SLO · voice latency · eval pass · drift */}
      <ObservabilityRow />

      {/* ── NAVIGATION ───────────────────────────────────────────── */}
      {/* System hub — live-chip cards grouped by domain. Degraded
          subsurfaces lift into a "needs attention" strip at the top
          of the grid. */}
      <SystemHubGrid />

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
