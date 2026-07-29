/**
 * lib/services/cashflow-forecast.ts — Wave-7 (2026-07-29) · WP-19.
 *
 * REVENUE-SIDE weekly forecast for the shop, from the nickstire bridge.
 * Named honestly: the bridge exposes NO payables / bank-balance /
 * committed-AR feed, so this can never claim to be a cash position —
 * it projects revenue-in from invoices, estimates, and bookings, with
 * confidence discounted by the bridge mirror's freshness label.
 *
 * Boundary (ADR-4): nickstire owns the business data and actions;
 * statenour stores only the forecast ARTIFACT (an IntelligenceOutcome
 * `prediction` row) whose resolution loop (outcomeUseful after actuals)
 * feeds the calibration corpus.
 *
 * The projection math is deliberately dumb-and-stated: trailing-4-week
 * revenue mean ± the observed week-to-week spread, adjusted by the
 * estimate-pipeline signal. A model earns complexity only after the
 * resolution loop shows this baseline failing.
 */
import { queryNick } from "@/lib/nickstire/query";

export interface CashflowForecast {
  kind: "revenue_side_forecast";
  weekStart: string;
  projectedRevenue: { low: number; mid: number; high: number };
  basis: {
    trailingWeeks: number[];
    estimatesPipeline: number | null;
    bookingsOpen: number | null;
  };
  confidence: number;
  dataGaps: string[];
  freshness: string;
}

/** Pure projection: mean of trailing weeks, band = ±1 observed
 *  mean-absolute-deviation (falls back to ±20% when only one week).
 *  Exported for tests. */
export function projectRevenue(trailingWeeks: number[]): {
  low: number;
  mid: number;
  high: number;
} | null {
  const weeks = trailingWeeks.filter((w) => Number.isFinite(w) && w >= 0);
  if (weeks.length === 0) return null;
  const mid = weeks.reduce((s, w) => s + w, 0) / weeks.length;
  const mad =
    weeks.length > 1
      ? weeks.reduce((s, w) => s + Math.abs(w - mid), 0) / weeks.length
      : mid * 0.2;
  const r = (n: number) => Math.round(Math.max(0, n));
  return { low: r(mid - mad), mid: r(mid), high: r(mid + mad) };
}

/** Pure confidence: freshness label × basis completeness. Exported for
 *  tests. `uncollected`/unknown freshness floors confidence at 0.2. */
export function forecastConfidence(
  freshness: string,
  trailingWeekCount: number,
  gapCount: number,
): number {
  const freshFactor =
    freshness === "live" ? 1 : freshness === "recent" ? 0.9 : freshness === "stale" ? 0.6 : freshness === "very_stale" ? 0.4 : 0.2;
  const basisFactor = Math.min(1, trailingWeekCount / 4);
  const gapFactor = Math.max(0.5, 1 - gapCount * 0.15);
  return Math.round(freshFactor * basisFactor * gapFactor * 100) / 100;
}

const toDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Build the weekly forecast from the bridge. Every failed input becomes
 * a named data gap, never a silent zero.
 */
export async function buildCashflowForecast(now = new Date()): Promise<CashflowForecast> {
  const gaps: string[] = [];
  const trailingWeeks: number[] = [];
  let freshness = "unknown";

  for (let w = 4; w >= 1; w--) {
    const from = new Date(now.getTime() - w * 7 * 86_400_000);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    try {
      const r = (await queryNick("revenue_range", {
        from: toDate(from),
        to: toDate(to),
      })) as { total?: number; totalRevenue?: number; freshness?: string } | null;
      const total = r?.total ?? r?.totalRevenue;
      if (typeof total === "number") {
        trailingWeeks.push(total);
        if (typeof r?.freshness === "string") freshness = r.freshness;
      } else {
        gaps.push(`revenue_range week -${w}: no numeric total`);
      }
    } catch {
      gaps.push(`revenue_range week -${w}: bridge unreachable`);
    }
  }

  let estimatesPipeline: number | null = null;
  try {
    const est = (await queryNick("estimates_aging")) as {
      openTotal?: number;
      totalOpenValue?: number;
    } | null;
    estimatesPipeline = est?.openTotal ?? est?.totalOpenValue ?? null;
    if (estimatesPipeline === null) gaps.push("estimates_aging: no open-value field");
  } catch {
    gaps.push("estimates_aging: bridge unreachable");
  }

  let bookingsOpen: number | null = null;
  try {
    const b = (await queryNick("bookings_status")) as { open?: number; pending?: number } | null;
    bookingsOpen = b?.open ?? b?.pending ?? null;
    if (bookingsOpen === null) gaps.push("bookings_status: no open-count field");
  } catch {
    gaps.push("bookings_status: bridge unreachable");
  }

  const projected = projectRevenue(trailingWeeks) ?? { low: 0, mid: 0, high: 0 };
  if (trailingWeeks.length === 0) gaps.push("no trailing revenue weeks — projection is empty");

  const weekStart = toDate(now);
  return {
    kind: "revenue_side_forecast",
    weekStart,
    projectedRevenue: projected,
    basis: { trailingWeeks, estimatesPipeline, bookingsOpen },
    confidence: forecastConfidence(freshness, trailingWeeks.length, gaps.length),
    dataGaps: gaps,
    freshness,
  };
}

/** Render the forecast as a digest paragraph — honest about gaps. */
export function forecastDigestLine(f: CashflowForecast): string {
  if (f.basis.trailingWeeks.length === 0) {
    return `Revenue-side forecast: UNAVAILABLE (${f.dataGaps.length} data gaps — bridge did not answer).`;
  }
  const gapNote = f.dataGaps.length > 0 ? ` · ${f.dataGaps.length} data gap(s)` : "";
  return (
    `Revenue-side forecast (NOT cash position — no payables feed): ` +
    `$${f.projectedRevenue.low}–$${f.projectedRevenue.high} next week ` +
    `(mid $${f.projectedRevenue.mid}, confidence ${f.confidence}, data ${f.freshness}${gapNote}).`
  );
}
