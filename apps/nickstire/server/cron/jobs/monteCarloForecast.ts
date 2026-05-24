/**
 * Cron · Monte-Carlo Revenue Forecast (weekly · Mondays)
 *
 * Tier A · wave-181.x · simulates next-week revenue under stochastic
 * booking volume, close rate, and ticket size · surfaces variance
 * bands so the operator sees the realistic range, not just a point
 * estimate.
 *
 * Why this matters · point forecasts are a lie. "Next week we'll do
 * $42K" hides the fact that the realistic range is $28K-$58K
 * depending on weather, paid-ad spend variance, and seasonality.
 * The operator should make staffing + ad-spend decisions against
 * the BAND, not the midpoint.
 *
 * Inputs (read from last 13 weeks)
 *   · booking volume: bookings created per day · mean + stdev
 *   · close rate: bookings → invoices (paid) ratio · mean + stdev
 *   · avg ticket size: invoice total / paid invoices · mean + stdev
 *
 * Simulation · 10,000 trials over 7 days = 70,000 sampled days. For
 * each day draws bookings ~ Normal(μ, σ), close_rate ~ Normal(μ, σ)
 * clipped [0,1], ticket ~ Normal(μ, σ) clipped >= $1. Daily revenue
 * = bookings × close_rate × ticket. Week total = sum.
 *
 * Outputs (Telegram digest)
 *   · P10 / P50 / P90 weekly revenue band
 *   · expected_value (mean of all trials)
 *   · sensitivity (which input drives most variance · ranks
 *     booking-volume, close-rate, ticket separately)
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
const DAYS_AHEAD = 7;

// Box-Muller transform · sample from N(0, 1)
function sampleNormal(mean: number, stdev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdev * z;
}

function clip(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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

  // 1 · daily bookings sample over last 13 weeks
  let bookingsStats: { mean: number; stdev: number } = { mean: 0, stdev: 0 };
  let closeStats: { mean: number; stdev: number } = { mean: 0, stdev: 0 };
  let ticketStats: { mean: number; stdev: number } = { mean: 0, stdev: 0 };

  try {
    const r = await d.execute(sql`
      WITH daily AS (
        SELECT
          DATE(created_at) AS d,
          COUNT(*) AS daily_bookings
        FROM bookings
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${SAMPLE_WEEKS} WEEK)
        GROUP BY DATE(created_at)
      )
      SELECT AVG(daily_bookings) AS m, STDDEV_POP(daily_bookings) AS s FROM daily
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ m: number | null; s: number | null }>;
    bookingsStats = { mean: Number(rows[0]?.m ?? 0), stdev: Math.max(0.1, Number(rows[0]?.s ?? 1)) };
  } catch (e) {
    log.warn("[monte-carlo] bookings stats failed", { error: e instanceof Error ? e.message : String(e) });
    return { recordsProcessed: 0, details: "bookings stats failed" };
  }

  try {
    // close rate = invoices / bookings per week
    const r = await d.execute(sql`
      SELECT
        WEEK(b.created_at) AS w,
        COUNT(DISTINCT b.id) AS bk,
        COUNT(DISTINCT i.id) AS inv
      FROM bookings b
      LEFT JOIN invoices i ON i.created_at >= b.created_at AND i.created_at < DATE_ADD(b.created_at, INTERVAL 14 DAY)
      WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL ${SAMPLE_WEEKS} WEEK)
      GROUP BY WEEK(b.created_at)
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ bk: number; inv: number }>;
    const rates = rows.filter(r => r.bk > 0).map(r => Math.min(1, r.inv / r.bk));
    if (rates.length > 0) {
      const m = rates.reduce((s, v) => s + v, 0) / rates.length;
      const variance = rates.reduce((s, v) => s + (v - m) ** 2, 0) / rates.length;
      closeStats = { mean: m, stdev: Math.max(0.02, Math.sqrt(variance)) };
    }
  } catch (e) {
    log.warn("[monte-carlo] close-rate stats failed · using default 0.45±0.1", { error: e instanceof Error ? e.message : String(e) });
    closeStats = { mean: 0.45, stdev: 0.1 };
  }

  try {
    const r = await d.execute(sql`
      SELECT AVG(total) AS m, STDDEV_POP(total) AS s
      FROM invoices
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${SAMPLE_WEEKS} WEEK) AND total > 0
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ m: number | null; s: number | null }>;
    ticketStats = { mean: Number(rows[0]?.m ?? 0) / 100, stdev: Math.max(5, Number(rows[0]?.s ?? 50) / 100) };
  } catch (e) {
    log.warn("[monte-carlo] ticket stats failed", { error: e instanceof Error ? e.message : String(e) });
    return { recordsProcessed: 0, details: "ticket stats failed" };
  }

  if (bookingsStats.mean <= 0 || ticketStats.mean <= 0) {
    log.info("[monte-carlo] insufficient history · skipping forecast");
    return { recordsProcessed: 0, details: "insufficient history" };
  }

  // 2 · run trials
  const weekTotals: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    let weekTotal = 0;
    for (let day = 0; day < DAYS_AHEAD; day++) {
      const bookings = Math.max(0, sampleNormal(bookingsStats.mean, bookingsStats.stdev));
      const closeRate = clip(sampleNormal(closeStats.mean, closeStats.stdev), 0, 1);
      const ticket = Math.max(1, sampleNormal(ticketStats.mean, ticketStats.stdev));
      weekTotal += bookings * closeRate * ticket;
    }
    weekTotals.push(weekTotal);
  }
  weekTotals.sort((a, b) => a - b);

  const p10 = percentile(weekTotals, 10);
  const p50 = percentile(weekTotals, 50);
  const p90 = percentile(weekTotals, 90);
  const mean = weekTotals.reduce((s, v) => s + v, 0) / weekTotals.length;

  // 3 · sensitivity · which input contributes most variance? Single-
  // variable sensitivity: holding two constant at mean, vary one over
  // ±1σ band, compute resulting revenue swing.
  const baselineDaily = bookingsStats.mean * closeStats.mean * ticketStats.mean;
  const swingBookings = ((bookingsStats.mean + bookingsStats.stdev) - (bookingsStats.mean - bookingsStats.stdev)) * closeStats.mean * ticketStats.mean * DAYS_AHEAD;
  const swingClose = bookingsStats.mean * ((closeStats.mean + closeStats.stdev) - (closeStats.mean - closeStats.stdev)) * ticketStats.mean * DAYS_AHEAD;
  const swingTicket = bookingsStats.mean * closeStats.mean * ((ticketStats.mean + ticketStats.stdev) - (ticketStats.mean - ticketStats.stdev)) * DAYS_AHEAD;
  const swings = [
    { name: "booking volume", swing: swingBookings, stat: bookingsStats },
    { name: "close rate", swing: swingClose, stat: closeStats },
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
      `Inputs (13-week sample · daily means)`,
      `  Bookings: ${bookingsStats.mean.toFixed(1)} ± ${bookingsStats.stdev.toFixed(1)}/day`,
      `  Close rate: ${(closeStats.mean * 100).toFixed(1)}% ± ${(closeStats.stdev * 100).toFixed(1)}%`,
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
