/**
 * Cleveland fall-freeze climatology — a sourced static constant.
 *
 * SOURCE: NOAA NCEI U.S. Climate Normals 1991-2020, annual/seasonal product,
 * station USW00014820 (CLEVELAND, OH US — Cleveland Hopkins), fields
 * ANN-TMIN-PRBFST-T32FP10/50/90: the date by which the first fall minimum
 * of 32°F or lower has occurred in 10% / 50% / 90% of years (30 years each).
 * https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access/USW00014820.csv
 * Read 2026-09-23: 10/21 · 11/03 · 11/17. These change once a decade, when
 * NCEI publishes the next normals period.
 */

const CLEVELAND_FIRST_FREEZE_NORMALS = {
  station: "USW00014820",
  period: "1991-2020",
  /** [month, day] — first 32°F has happened by this date in 10% of years. */
  p10: [10, 21],
  p50: [11, 3],
  p90: [11, 17],
} as const;

/**
 * Where a (forecast) freeze date sits against the normals, in one short line
 * for the operator: early, typical or late for Cleveland.
 */
export function describeFreezeTiming(date: Date, timeZone = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const key = month * 100 + day;
  const { p10, p50, p90 } = CLEVELAND_FIRST_FREEZE_NORMALS;
  const k = ([m, d]: readonly [number, number]) => m * 100 + d;
  // Spring freezes (Jan-Jun) are outside the fall-freeze distribution.
  if (month < 7) return "spring freeze (outside the fall first-freeze normals)";
  if (key < k(p10)) return "earlier than 9 in 10 Cleveland falls (10% date Oct 21)";
  if (key <= k(p50)) return "typical-early for Cleveland (median first freeze Nov 3)";
  if (key <= k(p90)) return "typical-late for Cleveland (median first freeze Nov 3)";
  return "later than 9 in 10 Cleveland falls (90% date Nov 17)";
}
