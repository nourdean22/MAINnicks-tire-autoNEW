/**
 * Cron · Monte-Carlo Revenue Forecast (weekly · Mondays)
 *
 * Tier A · wave-181.x · simulates next-week revenue under stochastic
 * job volume and ticket size · surfaces variance bands so the operator
 * sees the realistic range, not just a point estimate.
 *
 * Why this matters · point forecasts are a lie. "Next week we'll do
 * $42K" hides the fact that the realistic range is $28K-$58K
 * depending on weather, paid-ad spend variance, and seasonality.
 * The operator should make staffing + ad-spend decisions against
 * the BAND, not the midpoint.
 *
 * 2026-07-27 · THIS JOB HAD NEVER PRODUCED A FORECAST.
 * Every query named columns that do not exist: `bookings.created_at`,
 * `invoices.created_at`, `invoices.total`. The real columns are
 * `createdAt` and `totalAmount` — this database mixes snake_case and
 * camelCase per table, and these three guessed wrong. The first query
 * threw, the catch returned a normal result, and the scheduler recorded
 * `completed`. Verified in cron_log: the one Monday in the window reads
 * `completed | rec=0 | bookings stats failed`.
 *
 * FIXING THE COLUMN NAMES ALONE WOULD HAVE SHIPPED A WRONG NUMBER.
 * The old model was bookings × close_rate × ticket. Measured over the
 * last 13 weeks: 4 bookings, 337 invoices. Web bookings are ~1% of
 * revenue events here — this shop is phone/walk-in dominant. Feeding
 * that funnel real data yields close_rate clamped to 1.0 and a forecast
 * near $3.4K/week against ~$12.5K actual: ~3.7x LOW, delivered weekly
 * to the operator's phone with percentile bands that make it look
 * measured. A dead job is better than a confident wrong one.
 *
 * Inputs (read from last 13 weeks) — both directly measured
 *   · weekly invoice count: invoices per ISO week · mean + stdev
 *   · avg ticket size: totalAmount (CENTS — verified, avg 48253 = $482.53)
 *
 * WHY WEEKLY, NOT DAILY. Averaging daily counts averages only the days
 * that HAVE rows, so closed days vanish from the sample instead of
 * counting as zero — then the mean gets multiplied by 7. The old code
 * had exactly that flaw. A week always has data, so weekly sampling has
 * no missing observations to drop, and the forecast unit is the week
 * anyway.
 *
 * Simulation · 10,000 trials. Each trial draws weekly_count ~
 * Normal(μ, σ) clipped >= 0 and ticket ~ Normal(μ, σ) clipped >= $1;
 * week revenue = weekly_count × ticket. Count and ticket are treated as
 * independent, which is an approximation — a busy week may skew toward
 * smaller jobs — so the band is indicative, not a confidence interval.
 *
 * Outputs (Telegram digest)
 *   · P10 / P50 / P90 weekly revenue band
 *   · expected_value (mean of all trials)
 *   · sensitivity (which input drives most variance · ranks job
 *     volume against ticket size — staffing versus pricing/mix)
 *
 * Runs weekly · Mondays only · this is forward-looking, not
 * reactive. Daily would be noise.
 */

import { createLogger } from "../../lib/logger";

const log = createLogger("cron:monte-carlo");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

const SAMPLE_WEEKS = 13;
const TRIALS = 10_000;
// DAYS_AHEAD and clip() were removed with the daily-draw model: the
// forecast now samples whole weeks, so there is no per-day loop and no
// close-rate to clip into [0,1].
/**
 * Weeks that must actually contain invoices before a band is published.
 * Percentile bands imply a distribution, and a distribution needs
 * observations — publishing P10/P50/P90 off two or three weeks dresses
 * noise up as measurement. Prod currently has all 13.
 */
const MIN_WEEKS = 6;

// Box-Muller transform · sample from N(0, 1)
function sampleNormal(mean: number, stdev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdev * z;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

export async function processMonteCarloForecast(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[monte-carlo] start");

  // Skip non-Mondays
  const dow = new Date().getDay();
  if (dow !== 1) {
    return { recordsProcessed: 0, details: `skip · not Monday (dow=${dow})` };
  }

  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  /**
   * A query that names a column the table does not have is a BUG, not a
   * quiet condition — and reporting it as a normal result is what let this
   * job report `completed` on every Monday for as long as it has existed.
   * Same distinction the cross-sell job now makes (#1125): a schema error
   * is LOUD; a genuinely absent table is not.
   */
  const isSchemaBug = (e: unknown) =>
    typeof (e as { code?: string })?.code === "string" &&
    ["ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR", "ER_PARSE_ERROR"].includes((e as { code: string }).code);

  const statsFailed = (what: string, e: unknown) => {
    const error = e instanceof Error ? e.message : String(e);
    if (isSchemaBug(e)) {
      log.error(`[monte-carlo] BROKEN · ${what} names a column/table that does not exist — the forecast cannot run`, { error });
      return { recordsProcessed: 0, details: `BROKEN: ${what} — ${error.slice(0, 120)}` };
    }
    log.warn(`[monte-carlo] ${what} failed`, { error });
    return { recordsProcessed: 0, details: `${what} failed` };
  };

  // 1 · weekly invoice volume over the last 13 weeks.
  let volumeStats: { mean: number; stdev: number } = { mean: 0, stdev: 0 };
  let ticketStats: { mean: number; stdev: number } = { mean: 0, stdev: 0 };
  let weeksSampled = 0;

  try {
    const r = await d.execute(sql`
      WITH weekly AS (
        SELECT YEARWEEK(createdAt, 3) AS yw, COUNT(*) AS invoices_in_week
        FROM invoices
        WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${SAMPLE_WEEKS} WEEK)
          AND totalAmount > 0
        GROUP BY YEARWEEK(createdAt, 3)
      )
      SELECT AVG(invoices_in_week) AS m, STDDEV_POP(invoices_in_week) AS s, COUNT(*) AS weeks FROM weekly
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ m: number | null; s: number | null; weeks: number | null }>;
    weeksSampled = Number(rows[0]?.weeks ?? 0);
    volumeStats = { mean: Number(rows[0]?.m ?? 0), stdev: Math.max(0.5, Number(rows[0]?.s ?? 1)) };
  } catch (e) {
    return statsFailed("weekly invoice volume", e);
  }

  try {
    // totalAmount is CENTS (verified against prod: avg 48253 = $482.53).
    const r = await d.execute(sql`
      SELECT AVG(totalAmount) AS m, STDDEV_POP(totalAmount) AS s
      FROM invoices
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${SAMPLE_WEEKS} WEEK) AND totalAmount > 0
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ m: number | null; s: number | null }>;
    ticketStats = { mean: Number(rows[0]?.m ?? 0) / 100, stdev: Math.max(5, Number(rows[0]?.s ?? 50) / 100) };
  } catch (e) {
    return statsFailed("ticket stats", e);
  }

  /**
   * Refuse on a thin sample instead of forecasting from it. The old guard
   * was `mean <= 0`, which four bookings across thirteen weeks passes — so
   * it would have published percentile bands built on four data points.
   * Bands imply a distribution; a distribution needs observations.
   */
  if (weeksSampled < MIN_WEEKS || volumeStats.mean <= 0 || ticketStats.mean <= 0) {
    log.info("[monte-carlo] insufficient history · skipping forecast", { weeksSampled, minWeeks: MIN_WEEKS });
    return {
      recordsProcessed: 0,
      details: `insufficient history (${weeksSampled}/${MIN_WEEKS} weeks with invoices)`,
    };
  }

  // 2 · run trials
  const weekTotals: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    // One draw per WEEK, not seven daily draws. Seven independent daily
    // draws cancel each other out and understate the week's true spread —
    // the operator is staffing against week-to-week variance, which is
    // what the sample actually measures.
    const invoicesThisWeek = Math.max(0, sampleNormal(volumeStats.mean, volumeStats.stdev));
    const ticket = Math.max(1, sampleNormal(ticketStats.mean, ticketStats.stdev));
    weekTotals.push(invoicesThisWeek * ticket);
  }
  weekTotals.sort((a, b) => a - b);

  const p10 = percentile(weekTotals, 10);
  const p50 = percentile(weekTotals, 50);
  const p90 = percentile(weekTotals, 90);
  const mean = weekTotals.reduce((s, v) => s + v, 0) / weekTotals.length;

  // 3 · sensitivity · which input contributes most variance? Single-
  // variable sensitivity: holding two constant at mean, vary one over
  // ±1σ band, compute resulting revenue swing.
  // Two variables now, both measured, so the ranking means something: it
  // tells the operator whether next week swings on HOW MANY jobs come in
  // or on WHAT THEY'RE WORTH — staffing versus pricing/mix.
  const swingVolume = 2 * volumeStats.stdev * ticketStats.mean;
  const swingTicket = volumeStats.mean * 2 * ticketStats.stdev;
  const swings = [
    { name: "job volume", swing: swingVolume, stat: volumeStats },
    { name: "ticket size", swing: swingTicket, stat: ticketStats },
  ].sort((a, b) => b.swing - a.swing);

  // 4 · Telegram digest
  try {
    const { sendTelegram } = await import("../../services/telegram");
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
    const lines = [
      `🎲 MONTE-CARLO · Next 7 days revenue forecast`,
      ``,
      `Range (10/50/90 percentile): ${fmt(p10)} / ${fmt(p50)} / ${fmt(p90)}`,
      `Expected value: ${fmt(mean)}`,
      ``,
      `Inputs (${weeksSampled}-week sample · weekly means)`,
      `  Jobs invoiced: ${volumeStats.mean.toFixed(1)} ± ${volumeStats.stdev.toFixed(1)}/week`,
      `  Ticket: ${fmt(ticketStats.mean)} ± ${fmt(ticketStats.stdev)}`,
      ``,
      `Top driver of variance: ${swings[0].name} (±${fmt(swings[0].swing / 2)} swing/week)`,
      ``,
      `Plan against ${fmt(p10)} downside · staff to ${fmt(p50)} · don't promise ${fmt(p90)} unless inputs lean upper-band.`,
    ];
    await sendTelegram(lines.join("\n"));
  } catch (e) {
    log.warn("[monte-carlo] telegram failed", { error: e instanceof Error ? e.message : String(e) });
  }

  const durMs = Date.now() - start;
  log.info(`[monte-carlo] done in ${durMs}ms`, { p10, p50, p90, mean });

  return {
    recordsProcessed: TRIALS,
    details: `p10=${Math.round(p10)} p50=${Math.round(p50)} p90=${Math.round(p90)} mean=${Math.round(mean)}`,
  };
}
