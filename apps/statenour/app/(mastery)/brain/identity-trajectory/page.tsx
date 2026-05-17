"use client";

/**
 * /brain/identity-trajectory — Wave 60 forward projection surface.
 *
 * v10.0.529.106 · Wave 73.
 *
 * Wave 60 added projectIdentityForward() · pure least-squares math
 * on the last 14 history rows per axis. Wave 72 exposed it via
 * /api/brain/identity-projection. This page renders it · "at your
 * current trajectory, where does each axis land in 30 days?"
 *
 * The highest-signal thing the identity layer could say · already
 * computed, just needed a surface. Editorial-minimalist · 8 axes
 * sorted by warning-first then biggest-delta-first.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AxisTrajectory {
  axis: string;
  label: string;
  currentValue: number;
  projectedValue30d: number;
  delta30d: number;
  slopePerDay: number;
  rSquared: number;
  warning: "below_30" | "above_85" | "rapid_decline" | "rapid_climb" | null;
}

interface ProjectionResponse {
  projectedAt: string;
  horizonDays: number;
  trajectories: AxisTrajectory[];
}

const WARNING_TONE: Record<NonNullable<AxisTrajectory["warning"]>, { bg: string; text: string; label: string }> = {
  below_30: {
    bg: "border-rose-500/40 bg-rose-500/[0.06]",
    text: "text-rose-300",
    label: "below 30",
  },
  rapid_decline: {
    bg: "border-amber-500/40 bg-amber-500/[0.06]",
    text: "text-amber-300",
    label: "rapid decline",
  },
  rapid_climb: {
    bg: "border-emerald-500/40 bg-emerald-500/[0.06]",
    text: "text-emerald-300",
    label: "rapid climb",
  },
  above_85: {
    bg: "border-sky-500/40 bg-sky-500/[0.06]",
    text: "text-sky-300",
    label: "above 85",
  },
};

function trendArrow(slope: number): string {
  if (slope > 0.3) return "↑";
  if (slope < -0.3) return "↓";
  return "·";
}

function deltaColor(delta: number): string {
  if (delta > 5) return "text-emerald-300";
  if (delta < -5) return "text-rose-300";
  if (delta > 0) return "text-sky-300";
  if (delta < 0) return "text-amber-300";
  return "text-[var(--text-tertiary)]";
}

export default function IdentityTrajectoryPage() {
  const { data, loading, error, reload } = usePollingFetch<ProjectionResponse>(
    "/api/brain/identity-projection?days=30",
    { intervalMs: 5 * 60_000 }, // 5min · daily-cadence data
  );

  return (
    <StandardPage
      eyebrow="brain · trajectory"
      title="identity trajectory · 30 days"
      description="Pure least-squares projection on the last 14 daily snapshots · where each axis lands at current velocity · warnings sorted up top"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.projectedAt}
          source="Wave 60 · projectIdentityForward()"
          onReload={reload}
        />
      }
    >
      {data && data.trajectories.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          No identity history yet · the daily identity-snapshot cron needs to
          run at least 4 days for the projection to compute. Check back
          tomorrow.
        </div>
      )}

      {data && data.trajectories.length > 0 && (
        <div className="grid gap-2">
          {data.trajectories.map((t) => {
            const warn = t.warning ? WARNING_TONE[t.warning] : null;
            return (
              <div
                key={t.axis}
                className={cn(
                  "rounded-lg border p-3",
                  warn ? warn.bg : "border-[var(--border-default)] bg-[var(--bg-raised)]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {t.label}
                      </span>
                      {warn && (
                        <Badge className={cn("h-auto rounded px-1.5 py-0.5 bg-transparent border-current text-[10px] font-normal uppercase tracking-wider", warn.text)}>
                          {warn.label}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex items-end gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                          today
                        </div>
                        <div className="text-2xl font-mono font-bold tabular-nums text-[var(--text-primary)]">
                          {t.currentValue}
                        </div>
                      </div>
                      <div className="text-[var(--text-tertiary)] text-xl">→</div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                          +30d
                        </div>
                        <div className={cn("text-2xl font-mono font-bold tabular-nums", warn ? warn.text : "text-[var(--text-primary)]")}>
                          {t.projectedValue30d}
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className={cn("text-lg font-mono font-bold tabular-nums", deltaColor(t.delta30d))}>
                          {t.delta30d > 0 ? "+" : ""}{t.delta30d.toFixed(1)}
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                          {trendArrow(t.slopePerDay)} {Math.abs(t.slopePerDay).toFixed(2)}/day
                        </div>
                      </div>
                    </div>
                    {t.rSquared > 0 && (
                      <div className="mt-2 text-[10px] text-[var(--text-tertiary)] tabular-nums">
                        confidence · R² {(t.rSquared * 100).toFixed(0)}%
                        {t.rSquared < 0.3 && " · noisy signal · weak prediction"}
                        {t.rSquared >= 0.7 && " · strong linear trend"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-[var(--text-tertiary)]">computing projections…</div>
      )}
      {error && !data && (
        <div className="text-sm text-rose-300">projection unavailable · tap reload</div>
      )}

      {/* Editorial footer · explains the math + what to act on */}
      <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.5] p-4 text-xs text-[var(--text-tertiary)]">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          how to read this
        </div>
        <p>
          Each row shows today's identity-axis value + where it lands in 30 days at
          the current slope (least-squares regression on the last 14 daily snapshots).
          Warnings fire when projected value crosses 30 (below) or 85 (above), or
          when the delta exceeds ±20 in the 30-day window. R² shows how linear the
          trend is · &lt;30% means noisy data, treat the projection as a weak signal.
        </p>
        <p className="mt-2">
          Act on warnings · adjust the behaviors that drive the axis. E.g.
          "promise_integrity projected to hit 42 in 28 days" = stop committing to
          things you won't deliver, or close the open commitments before they
          break.
        </p>
      </div>
    </StandardPage>
  );
}
