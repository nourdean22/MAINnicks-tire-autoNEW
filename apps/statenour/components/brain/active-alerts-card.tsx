"use client";

/**
 * ActiveAlertsCard · v8.3 BATCH 13 · Apr 29.
 *
 * Consumes /api/brain/active-alerts (v8.3) and surfaces the most
 * recent F2 correlation alerts + F3 decision-quality drift alerts.
 *
 * Silent when both lists are empty — no point rendering an empty
 * "alerts" card. When alerts exist, renders a tinted block per
 * category with the latest items + a relative-time stamp.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// active-alerts")` onto `trpc.brain.activeAlerts` · reactive read.
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, Activity, TrendingDown } from "lucide-react";

interface Alert {
  id: string;
  category: string;
  key: string;
  content: string;
  createdAt: string;
  metadata: unknown;
}

interface AlertsPayload {
  sinceDays: number;
  counts: Record<string, number>;
  alerts: Record<string, Alert[]>;
}

const CATEGORY_META: Record<
  string,
  { label: string; icon: typeof AlertTriangle; tint: string }
> = {
  correlation_alert: {
    label: "New strong correlations",
    icon: Activity,
    tint: "border-blue-500/30 bg-blue-500/5 text-blue-300",
  },
  decision_quality_drift: {
    label: "Decision-quality drift",
    icon: TrendingDown,
    tint: "border-rose-500/30 bg-rose-500/5 text-rose-300",
  },
  schema_drift_alert: {
    label: "Schema drift",
    icon: AlertTriangle,
    tint: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  },
  storage_quota_alert: {
    label: "Storage quota",
    icon: AlertTriangle,
    tint: "border-orange-500/30 bg-orange-500/5 text-orange-300",
  },
  creation_spike_alert: {
    label: "Creation spike",
    icon: Activity,
    tint: "border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-300",
  },
  update_spike_alert: {
    label: "Update spike",
    icon: Activity,
    tint: "border-violet-500/30 bg-violet-500/5 text-violet-300",
  },
  brain_bus_alert: {
    label: "Brain-bus probe",
    icon: AlertTriangle,
    tint: "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
  },
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function ActiveAlertsCard() {
  const utils = trpc.useUtils();
  const resolveMutation = trpc.brain.resolveAlert.useMutation({
    onSuccess: () => void utils.brain.activeAlerts.invalidate(),
  });
  const muteMutation = trpc.brain.muteAlertCategory.useMutation({
    onSuccess: () => void utils.brain.activeAlerts.invalidate(),
  });
  // v8.3 BATCH 13 · React Query drives the fetch · the card used a
  // one-shot `load()` (no interval) · same here · the FreshnessChip
  // reload maps to `refetch()` and lastFetchedAt to `dataUpdatedAt`.
  const alertsQuery = trpc.brain.activeAlerts.useQuery(undefined);
  const payload = (alertsQuery.data as AlertsPayload | undefined) ?? null;
  const lastFetchedAt = alertsQuery.dataUpdatedAt
    ? new Date(alertsQuery.dataUpdatedAt)
    : null;

  if (alertsQuery.isLoading && !payload) return null; // silent loading — appears once data arrives
  if (alertsQuery.isError && !payload) {
    // W3: a failed fetch is UNKNOWN state, not "no alerts" — render it.
    return (
      <GlassCard>
        <p className="text-[12px] text-red-400 flex items-center gap-2">
          <AlertTriangle size={13} />
          Alerts couldn't load — state unknown, not empty.
          <button onClick={() => void alertsQuery.refetch()} className="underline text-[11px]">retry</button>
        </p>
      </GlassCard>
    );
  }
  if (!payload) return null;

  const totalAlerts = Object.values(payload.counts).reduce((a, b) => a + b, 0);
  if (totalAlerts === 0) return null; // silent on empty

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-400" />
          <span className="section-label">Active brain alerts · last {payload.sinceDays}d</span>
        </div>
        <FreshnessChip
          lastFetchedAt={lastFetchedAt}
          source="api/brain/active-alerts"
          onReload={() => void alertsQuery.refetch()}
          compact
        />
      </div>

      <div className="space-y-3">
        {Object.entries(payload.alerts).map(([category, items]) => {
          if (items.length === 0) return null;
          const meta = CATEGORY_META[category] ?? CATEGORY_META.correlation_alert;
          const Icon = meta.icon;
          return (
            <section key={category}>
              <div className="flex items-center gap-2 mb-1.5">
                <Icon size={12} className="text-[var(--text-tertiary)]" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  {meta.label} · {items.length}
                </span>
                <button
                  onClick={() => muteMutation.mutate({ category, days: 7 })}
                  disabled={muteMutation.isPending}
                  title="Mute this alert type for 7 days"
                  className="ml-auto text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] hover:text-amber-300 border border-white/8 rounded px-1.5 py-0.5"
                >
                  mute 7d
                </button>
              </div>
              <ul className="space-y-1.5">
                {items.map((alert) => (
                  <li
                    key={alert.id}
                    className={"rounded-md border p-2.5 " + meta.tint}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] leading-snug flex-1">{alert.content}</p>
                      <button
                        onClick={() => resolveMutation.mutate({ id: alert.id })}
                        disabled={resolveMutation.isPending}
                        title="Resolve (removes this alert)"
                        className="text-[10px] opacity-60 hover:opacity-100 border border-white/10 rounded px-1.5 py-0.5 shrink-0"
                      >
                        resolve
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] opacity-70">{relTime(alert.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </GlassCard>
  );
}
