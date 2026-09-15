"use client";

/**
 * <Metric /> · a number with its "relative to what?" · 2026-09-15.
 *
 * Renders lib/ui/metric-datum.ts. `unavailable` shows "unknown" and the
 * reason — never a zero (empty-state.tsx doctrine applied to numbers);
 * `degraded` shows the stale value with an amber reason line. The data
 * attribute `data-metric-status` is what tests assert on.
 */

import { cn } from "@/lib/utils";
import type { MetricResult } from "@/lib/services/metric-result";
import { describeMetric, type MetricSpec, type MetricTone } from "@/lib/ui/metric-datum";

export interface MetricProps {
  result: MetricResult<number>;
  spec: MetricSpec;
  now?: Date;
  className?: string;
}

const TONE_CLASS: Record<MetricTone, string> = {
  good: "text-emerald-300",
  bad: "text-red-300",
  neutral: "text-fg-secondary",
};

export function Metric({ result, spec, now, className }: MetricProps) {
  const view = describeMetric(result, spec, now);
  return (
    <div className={cn("space-y-0.5", className)} data-metric-status={view.status} data-metric-out-of-range={view.outOfRange || undefined}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">{view.label}</p>
      <p className="flex items-baseline gap-1">
        <span
          className={cn(
            "font-[var(--font-display)] text-2xl font-bold tabular-nums",
            view.status === "unavailable" ? "text-fg-tertiary" : view.outOfRange ? "text-amber-300" : "text-fg",
          )}
        >
          {view.primary}
        </span>
        {view.unit ? <span className="font-mono text-[11px] text-fg-tertiary">{view.unit}</span> : null}
      </p>
      {view.delta ? <p className={cn("font-mono text-[11px]", TONE_CLASS[view.delta.tone])}>{view.delta.text}</p> : null}
      {view.reason ? (
        <p className={cn("font-mono text-[11px]", view.status === "unavailable" ? "text-red-300/80" : "text-amber-300/80")}>
          {view.reason}
        </p>
      ) : null}
      {view.context.length > 0 ? <p className="font-mono text-[11px] text-fg-tertiary">{view.context.join(" · ")}</p> : null}
    </div>
  );
}
