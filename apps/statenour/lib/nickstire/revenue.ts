/**
 * Canonical reader for nickstire revenue out of a synced business payload
 * (the `revenue` object on `ceo_business_context` / `business_metrics_sync`
 * audit events, or a live bridge `revenue_today` result).
 *
 * WHY THIS EXISTS (2026-05-29): nickstire's bridge sends revenue as
 * `{ totalDollars, invoiceCount }` (DOLLARS). Over time, ~5 different
 * statenour readers each guessed their own key — `todayCents`, `cents`,
 * `todayEstimate`, `yesterday`, `weekRevenue` — and swallowed the miss
 * with `?? 0` / `return null`. Result: the /scoreboard showed "$0", the
 * morning brief omitted revenue, Nick's page context dropped it, etc.,
 * while the live ticker (which reads `totalDollars`) showed the real
 * number. A classic silent-failure CLASS born from per-file key drift.
 *
 * Fix: ONE accessor that tolerates every historical key shape. Route all
 * payload-revenue reads through it so the payload contract lives in one
 * place and can never drift per-file again.
 */

export interface NickRevenue {
  /** Today's revenue in whole dollars (0 if absent). */
  todayDollars: number;
  /** This week's revenue in whole dollars (0 if absent). */
  weekDollars: number;
  /** Today's invoice/job count (0 if absent). */
  jobs: number;
  /** True when the payload actually carried a today-revenue figure. */
  hasToday: boolean;
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

/**
 * Extract revenue from a nickstire `revenue` object, tolerant of every
 * historical key. Pass `payload.revenue` (NOT the whole payload).
 *
 *   const { todayDollars, jobs, hasToday } = readNickRevenue(ctx.revenue);
 */
export function readNickRevenue(revenueObj: unknown): NickRevenue {
  const r = (revenueObj ?? {}) as Record<string, unknown>;

  // Today — canonical `totalDollars`, then legacy dollar keys, then cents.
  const todayDollarsRaw = firstNumber(r, ["totalDollars", "todayEstimate", "todayDollars", "today"]);
  const todayCents = firstNumber(r, ["todayCents", "cents"]);
  const todayDollars =
    todayDollarsRaw !== null
      ? Math.round(todayDollarsRaw)
      : todayCents !== null
        ? Math.round(todayCents / 100)
        : 0;

  // Week — best-effort across the known key variants.
  const weekDollarsRaw = firstNumber(r, ["weekDollars", "weekRevenue", "weekEstimate", "week"]);
  const weekCents = firstNumber(r, ["weekCents"]);
  const weekDollars =
    weekDollarsRaw !== null
      ? Math.round(weekDollarsRaw)
      : weekCents !== null
        ? Math.round(weekCents / 100)
        : 0;

  const jobs = firstNumber(r, ["invoiceCount", "jobs", "jobCount", "invoices"]) ?? 0;

  return {
    todayDollars,
    weekDollars,
    jobs: Math.round(jobs),
    hasToday: todayDollarsRaw !== null || todayCents !== null,
  };
}
