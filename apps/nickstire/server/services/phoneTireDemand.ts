/**
 * Today's phone tire demand for the counter (Today -> Arrival load).
 * The rule and its rationale: server/lib/tireDemand.ts.
 */
import { db } from "../lib/db-helper";
import { summarizeTireDemand, type TireDemandSummary } from "../lib/tireDemand";
import { minutesSinceShopMidnight } from "../lib/timezoneAssert";

/**
 * THROWS when the database is unreachable: an unreadable count is not zero
 * callers, and the card says so instead of showing an empty list.
 */
export async function getPhoneTireDemandToday(now = new Date()): Promise<TireDemandSummary> {
  const d = await db();
  if (!d) throw new Error("Database not available");
  const { and, eq, gte, sql } = await import("drizzle-orm");
  const { voiceLatencyEvents } = await import("../../drizzle/schema");
  // Since Eastern midnight, as a duration from the DB's own NOW(): no driver-parsed timestamp involved.
  const minutes = minutesSinceShopMidnight(now);
  const rows = await d
    .select({ metadata: voiceLatencyEvents.metadata })
    .from(voiceLatencyEvents)
    .where(and(
      eq(voiceLatencyEvents.stage, "state_tool_called"),
      gte(voiceLatencyEvents.createdAt, sql`NOW() - INTERVAL ${minutes} MINUTE`),
    ))
    .limit(2000);
  return summarizeTireDemand(rows.map((r: { metadata: unknown }) => r.metadata));
}
