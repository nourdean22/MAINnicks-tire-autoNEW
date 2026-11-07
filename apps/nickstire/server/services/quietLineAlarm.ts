/**
 * Page Nour once when the receptionist line goes quiet during open hours.
 *
 * Fri 2026-10-31 the line took 0 calls from Thu 15:17 ET to Fri 16:21 ET (25.1 h; every other
 * overnight gap in 60 days is 15.5 to 19.6 h) while the Business Profile logged about 60
 * call-button taps: callers retried and nobody was told. Nothing watched inbound volume.
 *
 * The check: 0 vapi_call_logs rows in the last 120 min AND the whole 120 min window inside
 * 09:00 to 17:00 ET AND the shop open now. Without the window rule the 09:00 tick would read
 * the overnight gap and page every morning. One page per ET day (sendOncePerState, class
 * "incident"). Operator-only: this path cannot message a customer. Flag-gated and OFF by
 * default (quiet_line_alarm); an unreadable flag counts as off.
 */
import { sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { businessState, localClock } from "@shared/shopState";
import { getBusinessDateKey } from "../lib/timezoneAssert";
import { createLogger } from "../lib/logger";
import { sendOncePerState } from "./alertClaim";
import { isEnabled } from "./featureFlags";
import { sendTelegramResult } from "./telegram";

const log = createLogger("quiet-line-alarm");

const FLAG = "quiet_line_alarm";
const WINDOW_MINUTES = 120;
/** The window must start at or after 09:00 ET and end by 17:00 ET. */
const FLOOR_MINUTES = 9 * 60;
const CEILING_MINUTES = 17 * 60;
/** Calls per open hour: the 30-day mean 09 to 16 ET is 3.3 to 4.2. One floor and one mean is enough. */
const EXPECTED_CALLS_PER_HOUR = 3.5;

type Result = { recordsProcessed: number; details: string };

function windowInsideOpenHours(now: Date): boolean {
  if (businessState(now, BUSINESS.timezone, BUSINESS.hours.structured as Record<string, string>).state !== "open") return false;
  const end = localClock(now, BUSINESS.timezone).minutes;
  const start = localClock(new Date(now.getTime() - WINDOW_MINUTES * 60_000), BUSINESS.timezone).minutes;
  return start >= FLOOR_MINUTES && end <= CEILING_MINUTES;
}

function etClock(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** Calls in the window, or null when the count could not be read (never zero: empty-vs-error). */
async function countRecentCalls(): Promise<number | null> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const [rows] = await db.execute(sql`
      SELECT COUNT(*) AS n FROM vapi_call_logs WHERE createdAt >= NOW() - INTERVAL ${WINDOW_MINUTES} MINUTE
    `);
    const n = (rows as Array<{ n?: unknown }> | undefined)?.[0]?.n;
    if (n == null) throw new Error("count row missing");
    const count = Number(n);
    if (!Number.isFinite(count) || count < 0) throw new Error(`count unreadable: ${String(n)}`);
    return count;
  } catch (err) {
    log.warn("quiet-line count read failed; no alarm this tick", { errorId: "QUIET_LINE_COUNT_READ", error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function checkQuietLine(now: Date = new Date()): Promise<Result> {
  let on = false;
  try {
    on = await isEnabled(FLAG);
  } catch {
    on = false;
  }
  if (!on) return { recordsProcessed: 0, details: `off: ${FLAG}` };

  if (!windowInsideOpenHours(now)) return { recordsProcessed: 0, details: "skip: 2 h window not inside open hours" };

  const calls = await countRecentCalls();
  if (calls === null) return { recordsProcessed: 0, details: "count read failed" };
  if (calls > 0) return { recordsProcessed: 0, details: `ok: ${calls} calls in ${WINDOW_MINUTES} min` };

  const since = etClock(new Date(now.getTime() - WINDOW_MINUTES * 60_000));
  const expected = Math.round((WINDOW_MINUTES / 60) * EXPECTED_CALLS_PER_HOUR);
  const text = `No calls have reached the receptionist since ${since} ET (shop open, about ${expected} expected by now). Check the line and the forwarding.`;

  const sent = await sendOncePerState(`quiet-line:${getBusinessDateKey(now)}`, () => sendTelegramResult(text, "incident"), now);
  if (sent === null) return { recordsProcessed: 0, details: "QUIET: already paged today" };
  if (sent.status === "failed") {
    log.warn("quiet-line page not delivered; will retry next tick", { errorId: "QUIET_LINE_PAGE_NOT_DELIVERED" });
    return { recordsProcessed: 0, details: "QUIET: page not delivered, retrying next tick" };
  }
  if (sent.status === "held") return { recordsProcessed: 0, details: `QUIET: page held by ${sent.heldBy ?? "a mute"}` };
  return { recordsProcessed: 1, details: "QUIET: paged" };
}
