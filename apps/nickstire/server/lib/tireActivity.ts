import { and, gte, inArray, sql } from "drizzle-orm";
import { customerEvents } from "../../drizzle/schema";
import { requireDb } from "./db-helper";
import { logSafeErrorMessage } from "./dbErrors";

/** The five customer events the public tire flow logs, counted by exact name. */
const TIRE_EVENT_NAMES = [
  "tire_search_submitted",
  "tire_quote_cta_click",
  "vehicle_size_selected",
  "tire_option_selected",
  "top_pick_selected",
] as const;

type TireActivityRead =
  | { available: true; days: number; from: string; to: string; counts: Record<(typeof TIRE_EVENT_NAMES)[number], number> }
  | { available: false; reason: "error"; message: string };

/**
 * Tire-flow event counts over the last `days` days. Unlike customerEvents.summary (top 20 event names, so a
 * rare event vanishes), this asks for the five names directly: no cap, and a name with no rows is a real 0.
 */
export async function readTireActivity(days: number): Promise<TireActivityRead> {
  try {
    const d = await requireDb();
    const to = new Date();
    const since = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const rows = await d
      .select({ eventName: customerEvents.eventName, count: sql<number>`COUNT(*)` })
      .from(customerEvents)
      .where(and(inArray(customerEvents.eventName, [...TIRE_EVENT_NAMES]), gte(customerEvents.createdAt, since)))
      .groupBy(customerEvents.eventName);
    const counts = Object.fromEntries(TIRE_EVENT_NAMES.map((n) => [n, 0])) as Record<(typeof TIRE_EVENT_NAMES)[number], number>;
    for (const r of rows) {
      if (r.eventName in counts) counts[r.eventName as keyof typeof counts] = Number(r.count);
    }
    return { available: true, days, from: since.toISOString(), to: to.toISOString(), counts };
  } catch (err) {
    return { available: false, reason: "error", message: `The tire activity could not be read: ${logSafeErrorMessage(err)}` };
  }
}
