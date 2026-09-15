/**
 * ShopState assembly — gathers the four inputs and hands them to the pure
 * deriver in shared/shopState.ts. Every input is best-effort and independent:
 * a dead weather fetch does not blank the capacity band, and vice versa.
 *
 * LOT INPUT IS AN AGGREGATE. The queries below select a COUNT from
 * vehicle_visits and the latest producer heartbeat from camera_runtime and
 * nothing else — no plateText, no customerId, no per-row data ever leaves
 * this function. It is also flag-gated (`shopstate_lot_band`): until the
 * operator flips it, the lot band is "unknown", which is exactly what the
 * public site showed before.
 */
import { sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { deriveShopState, type ShopState, type ShopStateInputs } from "@shared/shopState";
import { createLogger } from "../lib/logger";

const log = createLogger("shop-state");

async function lotInput(): Promise<ShopStateInputs["lot"]> {
  try {
    const { isEnabled } = await import("./featureFlags");
    if (!(await isEnabled("shopstate_lot_band"))) return null;
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return null;
    const exec = async (q: ReturnType<typeof sql>) => {
      const result = (await d.execute(q)) as unknown;
      return Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as Record<string, unknown>[]) : [];
    };
    // PRODUCTION rows only (dataClass): a commissioning drive is not a customer.
    const [visitRow] = await exec(sql`
      SELECT SUM(CASE WHEN arrivedAt IS NOT NULL AND departedAt IS NULL
                       AND arrivedAt >= DATE_SUB(NOW(), INTERVAL 12 HOUR) THEN 1 ELSE 0 END) AS activeVisits
      FROM vehicle_visits
      WHERE dataClass = 'PRODUCTION'
    `);
    // FRESHNESS IS THE FEED'S, NOT THE LOT'S. A car that sits for an hour is a
    // healthy feed with no transitions; a camera that died mid-visit is a dead
    // feed with a recent transition. camera_runtime.receivedAt is the producer
    // heartbeat (migration 0120) — the only thing that says "the sensor is alive".
    const [feedRow] = await exec(sql`SELECT MAX(receivedAt) AS lastHeartbeatAt FROM camera_runtime`);
    const last = feedRow?.lastHeartbeatAt ? new Date(feedRow.lastHeartbeatAt as string | Date) : null;
    return { activeVisits: Number(visitRow?.activeVisits ?? 0), lastObservationAt: last && Number.isFinite(last.getTime()) ? last : null };
  } catch (err) {
    log.warn("lot aggregate unavailable — lot band unknown", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function capacityInput(): Promise<ShopStateInputs["capacity"]> {
  try {
    const { getShopStatus } = await import("./shopStatus");
    const s = await getShopStatus();
    return { openBays: s.openBays, totalBays: s.totalBays, waitIsFresh: s.waitIsFresh };
  } catch (err) {
    log.warn("shop status unavailable — capacity band unknown", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function weatherInput(): Promise<ShopStateInputs["weather"]> {
  try {
    const { getWeather } = await import("../weather");
    const w = await getWeather();
    return w ? { code: w.weather_code, tempF: w.temperature_f } : null;
  } catch {
    return null;
  }
}

export async function getShopState(now: Date = new Date()): Promise<ShopState> {
  const [capacity, lot, weather] = await Promise.all([capacityInput(), lotInput(), weatherInput()]);
  return deriveShopState({
    now,
    timezone: BUSINESS.timezone,
    hours: BUSINESS.hours.structured as Record<string, string>,
    capacity,
    lot,
    weather,
  });
}
