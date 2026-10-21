/**
 * Reads the two counts behind shared/vehicleCounterTrust.ts over the WINDOW_DAYS complete ET days
 * before today: camera arrivals (the lot.now definition: PRODUCTION, not already parked, not a
 * drive-by, one per episode) and billed jobs (every invoice, any source). ShopDriver rows land
 * around 3 AM and 8 PM ET, so today is never in the window.
 *
 * The day window is computed in SQL (CONVERT_TZ), never in JS: driver-parsed TiDB values come back
 * shifted on ET (apps/nickstire/AGENTS.md). A failed read is UNKNOWN with both counts null, never 0,
 * and is not memoized; a good read is memoized for 10 minutes within the ET day, since the window
 * is complete days and cannot change before midnight.
 */
import { sql, type SQL } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { WINDOW_DAYS, vehicleCounterTrust, type VehicleCounterTrust } from "@shared/vehicleCounterTrust";
import { createLogger } from "../lib/logger";

const log = createLogger("vehicle-counter-trust");

export type VehicleCounterTrustRead = VehicleCounterTrust & { fromDay: string | null; toDay: string | null };

const MEMO_MS = 10 * 60_000;
let memo: { etDay: string; at: number; value: VehicleCounterTrustRead } | null = null;

const etDayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS.timezone }).format(new Date(ms));

const countOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// The ET midnight `n` days before today, as UTC epoch seconds (same basis as lot.ts ET_DAY_START).
const etMidnightDaysAgo = (n: number) =>
  sql.raw(`UNIX_TIMESTAMP(CONVERT_TZ(DATE_SUB(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')), INTERVAL ${n} DAY), 'America/New_York', '+00:00'))`);

export async function readVehicleCounterTrust(d: { execute: (q: SQL) => Promise<unknown> }): Promise<VehicleCounterTrustRead> {
  const now = Date.now();
  const etDay = etDayOf(now);
  if (memo && memo.etDay === etDay && now - memo.at < MEMO_MS) return memo.value;

  const unknown = (): VehicleCounterTrustRead => ({
    ...vehicleCounterTrust({ arrivals: null, billed: null, days: WINDOW_DAYS }), fromDay: null, toDay: null,
  });
  try {
    const from = etMidnightDaysAgo(WINDOW_DAYS);
    const to = etMidnightDaysAgo(0);
    const result = await d.execute(sql`
      SELECT
        DATE_FORMAT(DATE_SUB(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')), INTERVAL ${sql.raw(String(WINDOW_DAYS))} DAY), '%Y-%m-%d') AS fromDay,
        DATE_FORMAT(DATE_SUB(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')), INTERVAL 1 DAY), '%Y-%m-%d') AS toDay,
        (SELECT COUNT(DISTINCT COALESCE(episodeId, visitId)) FROM vehicle_visits
          WHERE dataClass = 'PRODUCTION' AND preexisting = 0 AND state <> 'PASS_THROUGH'
            AND UNIX_TIMESTAMP(arrivedAt) >= ${from} AND UNIX_TIMESTAMP(arrivedAt) < ${to}) AS arrivals,
        (SELECT COUNT(*) FROM invoices
          WHERE UNIX_TIMESTAMP(invoiceDate) >= ${from} AND UNIX_TIMESTAMP(invoiceDate) < ${to}) AS billed
    `);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<Record<string, unknown>>;
    const r = Array.isArray(rows) ? rows[0] : undefined;
    if (!r) return unknown();
    const arrivals = countOrNull(r.arrivals);
    const billed = countOrNull(r.billed);
    const value: VehicleCounterTrustRead = {
      ...vehicleCounterTrust({ arrivals, billed, days: WINDOW_DAYS }),
      fromDay: r.fromDay == null ? null : String(r.fromDay),
      toDay: r.toDay == null ? null : String(r.toDay),
    };
    if (arrivals !== null && billed !== null) memo = { etDay, at: now, value };
    return value;
  } catch (err) {
    log.warn("counter trust read failed; verdict UNKNOWN", { error: err instanceof Error ? err.message : String(err) });
    return unknown();
  }
}
