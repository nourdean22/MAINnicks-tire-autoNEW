"use client";

/**
 * CalibrationTile: how well Nour's predictions resolved in the last 30 days (mean Brier, hit rate,
 * claim-vs-reality gap, verdict). Moved from the Brain Self-model fold to Stats Goals in wave E2
 * (2026-10-24), where it heads the calibration section. It is NOT CalibrationSection's "Reviewed
 * predictions" card: that one scores CalibrationReviewItem rows approved in review (Brier thresholds); this
 * one reads raw resolved Prediction rows (hit rate, claim-vs-reality verdict). Both show (round 4).
 *
 * Silent when resolved === 0: a quiet 30 days shows nothing. A FAILED read is not that: it renders
 * explicitly (2026-09-02); the helper used to swallow Prisma errors into `resolved: 0`.
 */

import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { readState } from "@/lib/query-state";
import { ReadingUnavailable, StaleNote } from "@/components/brain/brain-fold";

export function CalibrationTile() {
  const calibrationQ = trpc.brain.calibrationSummary.useQuery(
    { days: 30 },
    { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  );
  const { data, isError } = calibrationQ;
  if (isError && !data) return <ReadingUnavailable label="Calibration" />;
  if (!data && readState(calibrationQ) === "offline") return <ReadStateNote state="offline" label="Calibration" />;
  if (!data) return null;
  if (data.resolved === 0) return <StaleNote q={calibrationQ} label="Calibration" />;
  // Verdict map matches the helper's enum: "well-calibrated" | "drift" | "unknown"; drift is the
  // warning signal (>= 15% off).
  const verdictTint =
    data.verdict === "well-calibrated"
      ? "text-emerald-300"
      : data.verdict === "drift"
        ? "text-amber-300"
        : "text-fg-tertiary";
  return (
    <section aria-label="calibration" className="space-y-2 border-b border-edge-subtle pb-4">
      <StaleNote q={calibrationQ} label="Calibration" />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {/* "resolved 30d", not "30d": the population is predictions that RESOLVED in the last 30
            days, whenever they were made. */}
        <h3 className="text-[15px] font-medium text-fg">Predictions resolved in 30 days</h3>
        <p className={cn("text-[13px] font-mono tabular-nums", verdictTint)}>{data.verdict.replace(/-/g, " ")}</p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 font-mono text-[13px]">
        <span>
          <span className="mr-1 text-fg-tertiary">mean Brier</span>
          <span className="tabular-nums text-fg">{data.meanBrier != null ? data.meanBrier.toFixed(3) : "none"}</span>
          <span className="ml-1 text-fg-tertiary">(coin = 0.25)</span>
        </span>
        {data.hitRate !== null && (
          <span>
            <span className="mr-1 text-fg-tertiary">hit rate</span>
            <span className="tabular-nums text-fg">{Math.round(data.hitRate * 100)}%</span>
            <span className="ml-1 text-fg-tertiary">
              · {data.confirmed}/{data.resolved}
            </span>
          </span>
        )}
        {data.avgClaimVsRealityGap !== null && (
          <span>
            <span className="mr-1 text-fg-tertiary">claim-vs-reality gap</span>
            <span className="tabular-nums text-fg">{Math.round(data.avgClaimVsRealityGap * 100)}%</span>
          </span>
        )}
      </div>
    </section>
  );
}
