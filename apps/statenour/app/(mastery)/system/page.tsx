"use client";

import { useState, useEffect, useCallback } from "react";
import { Panel } from "@/components/panel";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/layout/ui";
import { usePullRefresh } from "@/lib/hooks/use-pull-refresh";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SystemHubGrid } from "@/components/system/hub-grid";
// v10.0.529.48 · ObservabilityRow relocated from /ultron · the 4
// cost/voice-latency/eval/drift tiles are ops-grade telemetry · they
// belong here with the rest of the system surface, not on the daily-
// driver home page.
import { ObservabilityRow } from "@/components/ultron/observability/observability-row";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface DiagnosticsData {
  db: { connected: boolean; latency_ms: number };
  kpis: {
    latency_24h: { avg_ms: number; p95_ms: number };
    errors_24h: number;
    requests_24h: number;
    ai_cost_7d_cents: number;
  };
  models: Record<string, number>;
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
  recentPatterns: { patternName: string; date: string }[];
  automationRules: { active: number; rules: { name: string; fireCount: number; lastFired: string | null }[] };
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
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [brain, setBrain] = useState<BrainStatus | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [diagRes, brainRes, healthRes] = await Promise.all([
        authedFetch("/api/system/diagnostics").then((r) => r.json()),
        authedFetch("/api/brain/status").then((r) => r.json()),
        authedFetch("/api/health").then((r) => r.json()),
      ]);
      setDiagnostics(diagRes.data ?? diagRes);
      setBrain(brainRes.data ?? brainRes);
      setHealth(healthRes.data ?? healthRes);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to load system data", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000); // Auto-refresh every 60s
    return () => clearInterval(interval);
  }, [refresh]);

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

      {/* System hub grid — live-chip cards, one per subsurface.
          Degraded surfaces bubble to the top via severity sort so
          whatever needs attention hits your eye first. Replaces the
          old pill-row nav (hub-grid.tsx). */}
      <SystemHubGrid />

      {/* v10.0.529.48 · relocated from /ultron. 4-tile ops telemetry ·
          cost SLO · voice latency · eval pass rate · OS drift. */}
      <ObservabilityRow />

      {/* Status bar */}
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

      {/* Two-column grid: Devices + Brain */}
      <div className="grid gap-4 md:grid-cols-2 stagger-in">
        {/* Devices panel */}
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

        {/* Brain panel */}
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
                <div className="rounded-lg bg-violet-500/10 p-3">
                  <div className="text-2xl font-bold text-violet-400">{brain.memories.permanent}</div>
                  <div className="text-[10px] text-violet-400/60 uppercase">Permanent</div>
                </div>
                <div className="rounded-lg bg-blue-500/10 p-3">
                  <div className="text-2xl font-bold text-blue-400">{brain.memories.temporary}</div>
                  <div className="text-[10px] text-blue-400/60 uppercase">Temporary</div>
                </div>
                <div className="rounded-lg bg-cyan-500/10 p-3">
                  <div className="text-2xl font-bold text-cyan-400">{brain.automationRules.active}</div>
                  <div className="text-[10px] text-cyan-400/60 uppercase">Rules</div>
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

      {/* Model record counts */}
      {d && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <h3 className="mb-3 text-sm font-semibold text-white">database models</h3>
          {/* v10.0.529.106 · Wave 51 · mobile fix · 3-col with text-xs on
              iPhone fits each model name (e.g. "AutonomousEvent" 16ch +
              count) in only ~125px which crops on the narrowest devices.
              Drop to 2 cols on mobile so each cell has ~180px of room. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 md:grid-cols-4">
            {Object.entries(d.models)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([name, count]) => (
                <div key={name} className="flex justify-between py-1">
                  <span className="text-[var(--text-secondary)]">{name}</span>
                  <span className="font-mono text-[var(--text-secondary)]">{String(count)}</span>
                </div>
              ))}
          </div>
        </Panel>
      )}

      {/* Automation rules */}
      {brain && brain.automationRules.rules.length > 0 && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <h3 className="mb-3 text-sm font-semibold text-white">active automation rules</h3>
          <div className="space-y-2">
            {brain.automationRules.rules.map((rule) => (
              <div
                key={rule.name}
                className="flex items-center justify-between rounded-lg bg-[var(--bg-raised)]/[0.02] px-3 py-2"
              >
                <span className="text-sm text-zinc-200">{rule.name}</span>
                <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
                  <span>fired: {rule.fireCount}x</span>
                  <span>{rule.lastFired ? timeAgo(rule.lastFired) : "never"}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Recent patterns */}
      {brain && brain.recentPatterns.length > 0 && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <h3 className="mb-3 text-sm font-semibold text-white">recent patterns</h3>
          <div className="space-y-1">
            {brain.recentPatterns.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-xs">
                <span className="text-[var(--text-secondary)]">{p.patternName}</span>
                <span className="text-[var(--text-tertiary)]">{p.date}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
