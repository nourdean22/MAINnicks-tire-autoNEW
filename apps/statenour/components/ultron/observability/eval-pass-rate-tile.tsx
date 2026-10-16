"use client";

/**
 * v10.0.526 · EvalPassRateTile — latest regression run pass rate + 7d trend.
 *
 * Fed over tRPC (see hooks/use-observability.ts). The regression harness runs
 * nightly via cron · this tile is the morning glance:
 *   · headline: latest run pass rate (0-100%)
 *   · trend arrow: vs run-7-back (avg of trailing 6 vs latest)
 *   · top failure category: surfaces WHERE the eval is leaking
 *
 * 2026-08-25 · TWO CLAIMS IN THIS HEADER WERE FALSE, and both are corrected.
 * It said "Backed by /api/system/eval-results (live since v524)" — no such
 * route exists; the tile is fed over tRPC. And it advertised "click →
 * /system/eval-results (full drilldown)" — that page was never built either,
 * so the whole card was a link to a 404. The wrapper is removed rather than
 * repointed: a link to the wrong page is worse than no link.
 *
 * Worth knowing before restoring the drilldown: use-observability.ts:69 records
 * that NO PRODUCER writes eval_result rows, so this tile shows a no-signal
 * state by construction. A drilldown would open on nothing.
 *
 * Tier mapping (passRateTier helper · same thresholds as agent-eval skill):
 *   · ≥90% → green (healthy)
 *   · 75-90% → amber (drift starting)
 *   · <75% → red (regression — investigate)
 *
 * Accessibility: the trend arrow is paired with text ("up 2pp" / "down 4pp")
 * rather than direction alone. The tile is no longer interactive, so the
 * chevron affordance went with the link — a chevron on a non-clickable card
 * promises a destination that does not exist.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { passRateTier, type EvalResultsShape, type TileState } from "@/hooks/use-observability";
import { EmptyTile, ErrorTile } from "./cost-slo-tile";

interface Props {
  state: TileState<EvalResultsShape>;
}

export function EvalPassRateTile({ state }: Props) {
  if (state.kind === "loading") {
    return <ShimmerSkeleton variant="card" className="min-h-[112px]" />;
  }
  if (state.kind === "empty") {
    // A stale hint means runs existed and stopped, so the default "check back after first run" would be false.
    // eval-results.ts: this store has had no producer since 2026-08-09; the date of the last run is in the hint.
    const footer = state.hint ? "no eval writer is wired" : undefined;
    return <EmptyTile label="eval · pass rate" hint={state.hint ?? "no regression runs yet"} footer={footer} icon={<Target size={14} />} />;
  }
  if (state.kind === "error") {
    return <ErrorTile label="eval · pass rate" message={state.message} />;
  }

  const results = state.data.results ?? [];
  const latest = results[0];

  // Defensive: even though `classify` filtered empty, results[0] could be
  // a malformed row. Treat that as empty rather than crashing the tile.
  if (!latest) {
    return <EmptyTile label="eval · pass rate" hint="no regression runs yet" icon={<Target size={14} />} />;
  }

  // Latest pass rate · normalize to 0-1 if server sent a percentage.
  const rawRate = latest.passRate ?? 0;
  const passRate = rawRate > 1 ? rawRate / 100 : rawRate;
  const tier = passRateTier(passRate);

  // 7d trend = average of trailing 6 (excluding latest) vs latest.
  // Servers older than 6 runs: trend is still computed against whatever
  // history we have (>= 2 rows). Single row · no trend.
  const trailing = results.slice(1, 7);
  const trailingAvg =
    trailing.length >= 1
      ? trailing.reduce((sum, r) => sum + ((r.passRate > 1 ? r.passRate / 100 : r.passRate) ?? 0), 0) / trailing.length
      : null;
  const deltaPp = trailingAvg !== null ? Math.round((passRate - trailingAvg) * 100) : 0;

  const TrendIcon = deltaPp > 1 ? TrendingUp : deltaPp < -1 ? TrendingDown : Minus;
  const trendColor =
    deltaPp > 1
      ? "text-emerald-300"
      : deltaPp < -1
        ? "text-rose-300"
        : "text-fg-tertiary";
  const trendLabel =
    deltaPp > 1
      ? `up ${deltaPp}pp`
      : deltaPp < -1
        ? `down ${Math.abs(deltaPp)}pp`
        : "flat";

  const tierBorder = {
    green: "border-l-emerald-400/70",
    amber: "border-l-amber-400",
    red: "border-l-rose-400",
  }[tier];

  const tierText = {
    green: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-rose-300",
  }[tier];

  // Top failure category. Computed from the max, not worstCategories[0]: on a
  // tie the first in dataset order is not "worst", so name none.
  const categories = latest.worstCategories ?? [];
  const maxFailed = Math.max(0, ...categories.map((c) => c.failed));
  const leaders = categories.filter((c) => c.failed === maxFailed);
  const worst = maxFailed > 0 && leaders.length === 1 ? leaders[0] : undefined;
  const tied = maxFailed > 0 && leaders.length > 1;

  return (
    <GlassCard ruled className={cn("min-h-[112px]", tierBorder)}>
        <div className="flex items-center justify-between mb-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-tertiary">
            <Target size={11} />
            Eval · pass rate
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={cn(
            "stat-number text-[26px] leading-none",
            tier === "green" ? "text-fg" : tierText,
          )}>
            {Math.round(passRate * 100)}
            <span className="ml-1 text-[12px] font-mono text-fg-tertiary">%</span>
          </span>
          {trailingAvg !== null && (
            <span className={cn("inline-flex items-center gap-1 font-mono text-[11px]", trendColor)}>
              <TrendIcon size={10} />
              {trendLabel}
            </span>
          )}
        </div>

        <p className="mt-1 font-mono text-[11px] text-fg-secondary tabular-nums">
          {latest.passed}/{latest.totalRan} passed
        </p>

        {worst && (
          <p className="mt-2 font-mono text-[11px] text-fg-tertiary">
            worst: <span className="text-fg">{worst.category}</span>{" "}
            <span className="text-rose-300 tabular-nums">
              {worst.failed}/{worst.total} fail
            </span>
          </p>
        )}
        {tied && (
          <p className="mt-2 font-mono text-[11px] text-fg-tertiary">
            no single worst category ({leaders.length} tied at {maxFailed} fail)
          </p>
        )}
    </GlassCard>
  );
}
