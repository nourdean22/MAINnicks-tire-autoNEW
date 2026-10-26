import { and, inArray, sql } from "drizzle-orm";
import { customerEvents } from "../../drizzle/schema";
import { shopDayRange, sqlUtcDateTime } from "../services/autonomyControl";
import { requireDb } from "./db-helper";
import { logSafeErrorMessage } from "./dbErrors";
import { getBusinessDateKey, shiftDateKey } from "./timezoneAssert";

/** The five customer events the public tire flow logs, counted by exact name. */
const TIRE_EVENT_NAMES = [
  "tire_search_submitted",
  "tire_quote_cta_click",
  "vehicle_size_selected",
  "tire_option_selected",
  "top_pick_selected",
] as const;

type TireActivityRead =
  | { available: true; days: number; fromDayKey: string; from: string; to: string; counts: Record<(typeof TIRE_EVENT_NAMES)[number], number> }
  | { available: false; reason: "error"; message: string };

/**
 * Tire-flow event counts over the last `days` days. Unlike customerEvents.summary (top 20 event names, so a
 * rare event vanishes), this asks for the five names directly: no cap, and a name with no rows is a real 0.
 */
export async function readTireActivity(days: number): Promise<TireActivityRead> {
  try {
    const d = await requireDb();
    // The last `days` SHOP days (America/New_York): today plus the days-1 before it, from that day's ET midnight.
    // Not now - days*24h (a UTC duration that is wrong across DST and not aligned to shop days). The bound is
    // compared as UTC text, the form a TIMESTAMP column takes in raw SQL (a bound Date is formatted in the process zone).
    const to = new Date();
    const fromDayKey = shiftDateKey(getBusinessDateKey(to), -(days - 1));
    const { start } = shopDayRange(fromDayKey);
    const rows = await d
      .select({ eventName: customerEvents.eventName, count: sql<number>`COUNT(*)` })
      .from(customerEvents)
      .where(and(
        inArray(customerEvents.eventName, [...TIRE_EVENT_NAMES]),
        sql`${customerEvents.createdAt} >= ${sqlUtcDateTime(start)}`,
      ))
      .groupBy(customerEvents.eventName);
    const counts = Object.fromEntries(TIRE_EVENT_NAMES.map((n) => [n, 0])) as Record<(typeof TIRE_EVENT_NAMES)[number], number>;
    for (const r of rows) {
      if (r.eventName in counts) counts[r.eventName as keyof typeof counts] = Number(r.count);
    }
    return { available: true, days, fromDayKey, from: start.toISOString(), to: to.toISOString(), counts };
  } catch (err) {
    return { available: false, reason: "error", message: `The tire activity could not be read: ${logSafeErrorMessage(err)}` };
  }
}
