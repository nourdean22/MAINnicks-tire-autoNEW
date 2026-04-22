/**
 * WebVitalsPanel — admin summary of real-user Core Web Vitals.
 *
 * Embeddable compact panel (drop into OverviewSection or dedicated page).
 * Shows p75 per metric with color-coded rating + top 5 slowest routes.
 *
 * Refreshes every 2 min. Data comes from in-memory ring buffer — no
 * external API dependencies.
 */

import React from "react";
import { trpc } from "@/lib/trpc";
import { Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";

const METRIC_LABELS: Record<string, { long: string; unit: string; fmt: (v: number) => string }> = {
  LCP:  { long: "Largest Contentful Paint", unit: "ms", fmt: (v) => `${Math.round(v)}ms` },
  CLS:  { long: "Cumulative Layout Shift",  unit: "",   fmt: (v) => v.toFixed(3) },
  INP:  { long: "Interaction to Next Paint", unit: "ms", fmt: (v) => `${Math.round(v)}ms` },
  FCP:  { long: "First Contentful Paint",   unit: "ms", fmt: (v) => `${Math.round(v)}ms` },
  TTFB: { long: "Time to First Byte",       unit: "ms", fmt: (v) => `${Math.round(v)}ms` },
};

const RATING_CONFIG = {
  good:                { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", label: "GOOD" },
  "needs-improvement": { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30",     label: "NEEDS WORK" },
  poor:                { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30",         label: "POOR" },
} as const;

interface Props {
  compact?: boolean;
  className?: string;
}

export default function WebVitalsPanel({ compact = false, className = "" }: Props) {
  const { data } = trpc.controlCenter.webVitals.useQuery(
    { windowMinutes: 60 },
    { refetchInterval: 120_000, staleTime: 60_000 },
  );

  if (!data || data.totalSamples === 0) {
    return (
      <div className={`rounded-xl border border-border/30 bg-card/50 p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          <Gauge className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-widest font-bold">Core Web Vitals</span>
        </div>
        <p className="text-xs text-muted-foreground">
          No samples in the last hour. CWV collector runs on every public page load —
          wait a few minutes or send traffic.
        </p>
      </div>
    );
  }

  const metrics = Object.entries(data.byMetric) as Array<
    [string, typeof data.byMetric[keyof typeof data.byMetric]]
  >;
  const anyPoor = metrics.some(([, m]) => m.rating === "poor");
  const allGood = metrics.every(([, m]) => m.rating === "good" || m.samples === 0);

  return (
    <div className={`rounded-xl border border-border/30 bg-card/50 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            Core Web Vitals · last {data.windowMinutes}m
          </span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {data.totalSamples} samples
          {anyPoor && <AlertTriangle className="inline w-3 h-3 ml-1 text-red-400" />}
          {allGood && <CheckCircle2 className="inline w-3 h-3 ml-1 text-emerald-400" />}
        </div>
      </div>

      <div className={`grid gap-2 ${compact ? "grid-cols-5" : "grid-cols-2 sm:grid-cols-5"}`}>
        {metrics.map(([key, m]) => {
          const cfg = RATING_CONFIG[m.rating];
          const label = METRIC_LABELS[key];
          return (
            <div
              key={key}
              className={`rounded-lg border px-2.5 py-2 ${cfg.bg}`}
              title={label?.long ?? key}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold tracking-wider text-muted-foreground">
                  {key}
                </span>
                <span className={`text-[9px] font-bold ${cfg.color}`}>{cfg.label}</span>
              </div>
              <div className={`font-mono font-black text-lg leading-tight ${cfg.color}`}>
                {m.samples > 0 ? label?.fmt(m.p75) ?? "—" : "—"}
              </div>
              <div className="text-[9px] text-muted-foreground font-mono">
                p50 {m.samples > 0 ? label?.fmt(m.p50) ?? "—" : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {!compact && data.topSlowRoutes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/20">
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1.5">
            Slowest LCP routes
          </div>
          <ul className="space-y-0.5">
            {data.topSlowRoutes.slice(0, 5).map((r) => (
              <li
                key={r.route}
                className="flex items-center justify-between text-[11px] font-mono"
              >
                <span className="truncate text-foreground/80">{r.route}</span>
                <span className="text-muted-foreground">
                  {Math.round(r.p75)}ms · {r.samples}n
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
