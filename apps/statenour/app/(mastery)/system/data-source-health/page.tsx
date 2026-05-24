"use client";

/**
 * /system/data-source-health · Wave X.f (2026-05-24) · activation.
 *
 * Operator-facing surface for the data-source-health canary system
 * (v10.0.58 Wave B). The `/api/cron/data-source-health` cron probes
 * every high-leverage data feeder 4×/day and writes results to
 * `BrainMemory(category="data_source_probe")`. Pre-fix nothing
 * rendered those rows · the architectural canary's "catch the next
 * ghost-feeder before it lives in production for months" promise
 * was unreaped.
 *
 * Reads `/api/system/data-source-probes`. Renders one row per probe
 * with kind grouping (personal · shop · bridge), latest rowCount,
 * latest ok/fail state, consecutive-empty streak vs alert threshold.
 * Refreshes every 60s · the cron writes every 6h, no need to poll
 * faster.
 */

import { useEffect, useState } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils";

interface ProbeRow {
  name: string;
  label: string;
  kind: "personal" | "shop" | "bridge";
  emptyDaysAlertThreshold: number;
  runs: number;
  latest: {
    at: string;
    ok: boolean;
    rowCount: number;
    reason: string | null;
    latencyMs: number;
  } | null;
  emptyStreak: number;
  alerting: boolean;
}

interface ProbeResponse {
  ok: boolean;
  generatedAt: string;
  probeCount: number;
  alertingCount: number;
  probes: ProbeRow[];
}

function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 1) return `${Math.floor(ms / 60_000)}m ago`;
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const KIND_ORDER: Record<ProbeRow["kind"], number> = {
  bridge: 0,
  shop: 1,
  personal: 2,
};

const KIND_LABEL: Record<ProbeRow["kind"], string> = {
  bridge: "bridge",
  shop: "shop",
  personal: "personal",
};

export default function DataSourceHealthPage() {
  const [data, setData] = useState<ProbeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/system/data-source-probes", {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as ProbeResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "fetch failed");
        }
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const probes = data?.probes ?? [];
  const sorted = [...probes].sort((a, b) => {
    // Alerting probes float to top · then by kind order · then by name.
    if (a.alerting !== b.alerting) return a.alerting ? -1 : 1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.name.localeCompare(b.name);
  });

  return (
    <StandardPage
      eyebrow="System / observability"
      title="Data-source health"
      description="The architectural canary that catches the next ghost-feeder before it lives in production for months. Each probe hits a single data source; consecutive empty results trip an alert at the probe's threshold."
    >
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
          Failed to load · {error}
        </div>
      )}

      {/* Summary scorecard */}
      <Panel className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {data ? "rollup" : "Loading"}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <div>
            <div className="text-[28px] font-bold text-[var(--text-primary)] leading-none">
              {data?.probeCount ?? 0}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
              probes tracked
            </div>
          </div>
          <div className="text-[var(--text-tertiary)]/40">·</div>
          <div>
            <div
              className={cn(
                "text-[20px] font-bold leading-none tabular-nums",
                (data?.alertingCount ?? 0) > 0
                  ? "text-amber-400"
                  : "text-emerald-400",
              )}
            >
              {data?.alertingCount ?? 0}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
              alerting
            </div>
          </div>
        </div>
      </Panel>

      {/* Per-probe rollup */}
      <Panel>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-2">
          probes (alerting first)
        </div>
        {sorted.length === 0 && (
          <div className="text-[11px] text-[var(--text-tertiary)] italic">
            no probe runs persisted yet · cron writes every 6h
          </div>
        )}
        <div className="space-y-1.5">
          {sorted.map((p) => {
            const latest = p.latest;
            return (
              <div
                key={p.name}
                className={cn(
                  "flex items-baseline gap-3 py-1.5 px-2 -mx-2 rounded text-[11px] font-mono",
                  p.alerting && "bg-amber-500/10",
                )}
              >
                <span
                  className={cn(
                    "uppercase shrink-0 w-14 text-[9px] tracking-wider",
                    p.kind === "bridge" && "text-[var(--gold)]",
                    p.kind === "shop" && "text-sky-400/80",
                    p.kind === "personal" && "text-emerald-400/80",
                  )}
                >
                  {KIND_LABEL[p.kind]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text-secondary)] truncate">
                    {p.label}
                  </div>
                  {latest?.reason && !latest.ok && (
                    <div className="text-[10px] text-red-300/80 italic truncate">
                      {latest.reason.slice(0, 100)}
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    "tabular-nums shrink-0 text-right",
                    latest && latest.ok
                      ? "text-[var(--text-secondary)]"
                      : "text-red-300",
                  )}
                  title={`${p.runs} runs in window`}
                >
                  {latest ? `${latest.rowCount} rows` : "no data"}
                </span>
                <span
                  className={cn(
                    "tabular-nums shrink-0 w-12 text-right text-[10px]",
                    p.alerting
                      ? "text-amber-400 font-semibold"
                      : "text-[var(--text-tertiary)]",
                  )}
                  title={`empty for ${p.emptyStreak} consecutive runs · alerts at ${p.emptyDaysAlertThreshold}`}
                >
                  {p.emptyStreak}/{p.emptyDaysAlertThreshold}
                </span>
                <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums shrink-0 w-14 text-right">
                  {formatAge(latest?.at ?? null)}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="text-[9px] text-[var(--text-tertiary)]/60 text-center font-mono">
        Auto-refresh 60s · data-source-health cron · per-probe alert thresholds
      </div>
    </StandardPage>
  );
}
