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
import { prisma } from "@/lib/prisma";
import { recordOutcome } from "@/lib/services/outcome-ledger";

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
 * The dollars in a `revenue_range` answer, or null. queryNick answers
 * `{ data, query, timestamp }` or `{ error }`, and a handler that could not read
 * its database answers 200 with `{ data: { error } }`. This read `total` /
 * `totalRevenue` off the envelope, fields no answer has ever carried, so every
 * week was a gap and every forecast UNAVAILABLE (found 2026-10-09).
 */
function revenueDollars(res: unknown): number | null {
  const data = (res as { data?: unknown } | null)?.data as { totalDollars?: unknown; error?: unknown } | undefined;
  if (!data || typeof data !== "object" || data.error) return null;
  const v = data.totalDollars;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `from` .. `to` is one week as revenue_range reads it: shop days, BOTH inclusive. */
const WEEK_LAST_DAY_MS = 6 * 86_400_000;

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
    // to = from + 6: `to` is inclusive, so from + 7 read 8 days and counted each
    // boundary day in two consecutive weeks.
    const to = new Date(from.getTime() + WEEK_LAST_DAY_MS);
    try {
      const r = (await queryNick("revenue_range", {
        from: toDate(from),
        to: toDate(to),
      })) as { data?: { freshness?: unknown } } | null;
      const total = revenueDollars(r);
      if (total !== null) {
        trailingWeeks.push(total);
        // revenue_range carries no freshness label today; read one if it ever does.
        if (typeof r?.data?.freshness === "string") freshness = r.data.freshness;
      } else {
        gaps.push(`revenue_range week -${w}: no numeric total`);
      }
    } catch {
      gaps.push(`revenue_range week -${w}: bridge unreachable`);
    }
  }

  // Known gap (2026-10-09): these two read fields off queryNick's envelope that
  // nickstire's handlers do not send (estimates_aging answers buckets and, with
  // scope "alg", totalDeclinedValue; bookings_status answers statusBreakdown), so
  // both are always named data gaps. Which value is "the pipeline" is not decided.
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

// ─── Resolution · score last week's forecast against actuals ────────────────
//
// 2026-10-02 · outcome-ledger census E5. Every weekly digest wrote a
// `prediction` row and promised "the resolution loop can score it against
// actuals"; no such loop existed, so every row stayed undecided and
// outcome-null forever. Operator decision (a): a forecast is CORRECT when the
// week's actual revenue lands inside its low–high band. Actuals come from the
// same `revenue_range` bridge query the forecast was built from.

export interface ForecastBand {
  low: number;
  high: number;
}

export interface ForecastResolution {
  weekStart: string;
  band: ForecastBand | null;
  actual: number | null;
  /** null when the row could not be scored; `reason` says why. */
  hit: boolean | null;
  reason?: string;
}

/** Band hit = actual inside [low, high], inclusive. Pure; exported for tests. */
export function forecastBandHit(actual: number, band: ForecastBand): boolean {
  return Number.isFinite(actual) && actual >= band.low && actual <= band.high;
}

/**
 * Recover the band from a digest line written before `projectedRevenue` was
 * stored on the row (`$800–$1200 next week`, en dash or hyphen). Null when the
 * line is the UNAVAILABLE shape or carries no band.
 */
export function parseForecastBand(summary: string): ForecastBand | null {
  const m = /\$(\d+)\s*[–-]\s*\$(\d+)/.exec(summary);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low || high <= 0) return null;
  return { low, high };
}

const WEEK_MS = 7 * 86_400_000;

/**
 * Score every unresolved cashflow-forecast row whose week has fully elapsed.
 * Writes `outcomeUseful` (band hit) and `resultRef week:<start>:actual:<n>` on
 * each scored row; a row whose actual the bridge cannot give is left untouched
 * and reported with its reason — never scored as a miss. Bounded to `limit`
 * rows per run so a long backlog drains over a few Sundays.
 */
export async function resolveForecastPredictions(
  now = new Date(),
  limit = 8,
): Promise<ForecastResolution[]> {
  // Only rows whose forecast week has fully elapsed, and never an UNAVAILABLE
  // forecast — without both filters, the current week's row and every
  // unscorable row would sit in the `limit` window forever and starve the
  // rows that can be scored.
  const rows = await prisma.intelligenceOutcome
    .findMany({
      where: {
        kind: "prediction",
        sourceEngine: "cashflow-forecast",
        outcomeAt: null,
        // 6 days, not 7: last Sunday's row was written seconds AFTER that run's
        // `now`, so an exact 7-day bound excluded it every week unless this run
        // started later (bug-hunt 2026-10-02). `weekEnd <= now` below still
        // keeps a running week out.
        shownAt: { lte: new Date(now.getTime() - 6 * 86_400_000) },
        NOT: { summary: { contains: "UNAVAILABLE" } },
      },
      orderBy: { shownAt: "desc" },
      take: limit,
      select: { id: true, summary: true, evidenceRefs: true, shownAt: true },
    })
    .catch(() => []);

  const out: ForecastResolution[] = [];
  for (const row of rows) {
    const ev = (row.evidenceRefs ?? {}) as {
      weekStart?: unknown;
      projectedRevenue?: { low?: unknown; high?: unknown } | null;
    };
    const weekStart = typeof ev.weekStart === "string" ? ev.weekStart : toDate(row.shownAt);
    const weekEnd = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + WEEK_MS);
    if (!(weekEnd.getTime() <= now.getTime())) continue; // week still running — not scorable yet

    const stored = ev.projectedRevenue;
    // A {0,0,0} band is what an empty projection stores; it is "no forecast",
    // never a band that every positive actual misses.
    const band: ForecastBand | null =
      stored && typeof stored.low === "number" && typeof stored.high === "number" && stored.high > 0
        ? { low: stored.low, high: stored.high }
        : parseForecastBand(row.summary);
    if (!band) {
      out.push({ weekStart, band: null, actual: null, hit: null, reason: "no band on the row (forecast was UNAVAILABLE)" });
      continue;
    }

    let actual: number | null = null;
    try {
      // The week's last day, inclusive (weekEnd is the start of the next week).
      const lastDay = toDate(new Date(weekEnd.getTime() - 86_400_000));
      actual = revenueDollars(await queryNick("revenue_range", { from: weekStart, to: lastDay }));
    } catch {
      actual = null;
    }
    if (actual === null) {
      out.push({ weekStart, band, actual: null, hit: null, reason: "actual unavailable (bridge gave no numeric total)" });
      continue;
    }

    const hit = forecastBandHit(actual, band);
    const written = await recordOutcome({
      id: row.id,
      useful: hit,
      resultRef: `week:${weekStart}:actual:${Math.round(actual)}`,
    });
    out.push({
      weekStart,
      band,
      actual,
      hit,
      ...(written ? {} : { reason: "outcome write did not land (row already resolved or write failed)" }),
    });
  }
  return out;
}

/** One digest line for the most recent scored week; names the gap when nothing could be scored. */
export function forecastResolutionLine(results: ForecastResolution[]): string {
  if (results.length === 0) return "Last week's forecast: nothing to score yet (no elapsed, unscored forecast on the ledger).";
  const scored = results.find((r) => r.hit !== null);
  if (scored && scored.band && scored.actual !== null) {
    return (
      `Last week's forecast (week of ${scored.weekStart}): $${scored.band.low}–$${scored.band.high} · ` +
      `actual $${Math.round(scored.actual)} · ${scored.hit ? "HIT" : "MISS"}.`
    );
  }
  const first = results[0];
  return `Last week's forecast (week of ${first.weekStart}): not scored — ${first.reason ?? "unknown reason"}.`;
}
