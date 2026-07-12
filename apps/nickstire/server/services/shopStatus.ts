/**
 * Shop Status API — Real-time bay availability and wait times
 * Powers the live status marquee and customer-facing status page.
 */

import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import { sql } from "drizzle-orm";

import { BUSINESS } from "@shared/business";
const log = createLogger("shop-status");

const TOTAL_BAYS = 4;

interface BayStatus {
  bayNumber: number;
  status: "open" | "occupied" | "reserved";
  vehicle?: string;
  service?: string;
  techName?: string;
  estimatedCompletion?: string;
}

interface ShopStatus {
  isOpen: boolean;
  openBays: number;
  totalBays: number;
  estimatedWaitMinutes: number;
  currentJobs: number;
  walkInsAccepted: boolean;
  nextOpenTime?: string;
  bays: BayStatus[];
  statusMessage: string;
  /**
   * feat/home-v2 anti-fabrication gate: true only when currentJobs (and
   * therefore openBays + the wait number) came from REAL data — the
   * caller's activeOrderCount or the live bookings query. False means the
   * time-of-day estimateCurrentJobs() fallback invented the numbers, and
   * clients must NOT render the wait/bay figures as fact.
   */
  waitIsFresh: boolean;
}

/**
 * Get current shop status.
 * Query database for active work orders with active stages.
 */
export async function getShopStatus(activeOrderCount?: number): Promise<ShopStatus> {
  // Use Eastern Time — Railway runs UTC, but business hours are ET
  const now = new Date();
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
  const day = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone })).getDay(); // 0=Sun

  // Business hours check
  let isOpen = false;
  let nextOpenTime: string | undefined;

  if (day === 0) { // Sunday
    isOpen = hour >= 9 && hour < 16;
    if (!isOpen) nextOpenTime = hour < 9 ? "9:00 AM today" : "8:00 AM Monday";
  } else if (day >= 1 && day <= 6) { // Mon-Sat
    isOpen = hour >= 8 && hour < 18;
    if (!isOpen) nextOpenTime = hour < 8 ? "8:00 AM today" : day === 6 ? "9:00 AM Sunday" : "8:00 AM tomorrow";
  }

  // Bay usage from active orders (real) — or the time-of-day fallback,
  // which is an INVENTED number and must be flagged stale (waitIsFresh).
  let jobs: number;
  let waitIsFresh: boolean;
  if (activeOrderCount !== undefined) {
    jobs = activeOrderCount;
    waitIsFresh = true;
  } else {
    const d = await db();
    if (d) {
      try {
        const { bookings } = await import("../../drizzle/schema");
        const { and, inArray } = await import("drizzle-orm");
        const activeBookings = await d.select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              inArray(bookings.stage, ["inspecting", "waiting-parts", "in-progress", "quality-check"]),
              sql`status != 'cancelled'`
            )
          );
        jobs = activeBookings.length;
        waitIsFresh = true;
      } catch (dbErr) {
        log.warn("Failed to query active bookings for shop status:", dbErr);
        jobs = estimateCurrentJobs(hour, day);
        waitIsFresh = false;
      }
    } else {
      jobs = estimateCurrentJobs(hour, day);
      waitIsFresh = false;
    }
  }

  const occupiedBays = Math.min(jobs, TOTAL_BAYS);
  const openBays = TOTAL_BAYS - occupiedBays;

  // Wait time heuristic
  let estimatedWaitMinutes = 0;
  if (openBays === 0) estimatedWaitMinutes = 45;
  else if (openBays === 1) estimatedWaitMinutes = 20;
  else if (openBays === 2) estimatedWaitMinutes = 10;

  // Status message. When the numbers are the time-of-day fallback
  // (waitIsFresh=false), never assert bay counts or a wait time as fact —
  // hours-derived open/closed is the only thing we actually know.
  let statusMessage: string;
  if (!isOpen) {
    statusMessage = `We're closed right now. ${nextOpenTime ? `Opening at ${nextOpenTime}.` : ""}`;
  } else if (!waitIsFresh) {
    statusMessage = `Open now — first come, first served. Call to check the line: ${BUSINESS.phone.display}.`;
  } else if (openBays >= 3) {
    statusMessage = `${openBays} bays open — walk right in!`;
  } else if (openBays >= 1) {
    statusMessage = `${openBays} bay${openBays > 1 ? "s" : ""} available. Short wait possible.`;
  } else {
    statusMessage = `All bays full — about a 45-minute wait. Call ahead: ${BUSINESS.phone.display}.`;
  }

  const bays: BayStatus[] = Array.from({ length: TOTAL_BAYS }, (_, i) => ({
    bayNumber: i + 1,
    status: i < occupiedBays ? "occupied" as const : "open" as const,
  }));

  return {
    isOpen,
    openBays,
    totalBays: TOTAL_BAYS,
    estimatedWaitMinutes,
    currentJobs: jobs,
    walkInsAccepted: isOpen && openBays > 0,
    nextOpenTime,
    bays,
    statusMessage,
    waitIsFresh,
  };
}

/**
 * LINE OF CARS — Today's real-time count.
 *
 * The Pillar 1 metric: bookings received today + invoices created today.
 * Runs a single fast aggregate query. Uses today's local date in ET.
 *
 * Returns a decomposed breakdown so the UI can show momentum:
 *   - droppedOff = already checked in / in progress
 *   - booked     = scheduled-but-not-yet-there
 *   - invoicedToday = money in the register today (wins)
 */
export async function getLineOfCarsToday(): Promise<{
  total: number;
  droppedOff: number;
  booked: number;
  invoicedToday: number;
  weekAverage: number;
  trend: "up" | "down" | "flat";
}> {
  const d = await db();
  if (!d) {
    return { total: 0, droppedOff: 0, booked: 0, invoicedToday: 0, weekAverage: 0, trend: "flat" };
  }

  try {
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

    // Raw SQL helper — MySql2 .execute returns [rows, fields] as a tuple,
    // but TS types it as MySqlRawQueryResult which is a union. Cast via
    // unknown so we can pull typed row data out.
    const exec = async (q: ReturnType<typeof sql>) => {
      const result = (await d.execute(q)) as unknown;
      const rows = Array.isArray(result) && Array.isArray(result[0])
        ? (result[0] as Record<string, unknown>[])
        : (Array.isArray(result) ? (result as Record<string, unknown>[]) : []);
      return rows;
    };

    // Today's bookings broken down by stage
    const bookingRows = await exec(sql`
      SELECT
        SUM(CASE WHEN stage IN ('inspecting','waiting-parts','in-progress','quality-check','ready') THEN 1 ELSE 0 END) AS droppedOff,
        SUM(CASE WHEN stage = 'received' AND status != 'cancelled' THEN 1 ELSE 0 END) AS booked
      FROM bookings
      WHERE DATE(createdAt) = ${todayStr} OR preferredDate = ${todayStr}
    `);
    const row = bookingRows[0] ?? {};
    const droppedOff = Number(row.droppedOff ?? 0);
    const booked = Number(row.booked ?? 0);

    // Today's invoices (real wins — money collected)
    const invRows = await exec(sql`
      SELECT COUNT(*) AS cnt FROM invoices WHERE DATE(invoiceDate) = ${todayStr}
    `);
    const invoicedToday = Number(invRows[0]?.cnt ?? 0);

    // 7-day average (for trend arrow)
    const avgRows = await exec(sql`
      SELECT COUNT(*) / 7 AS avg7
      FROM bookings
      WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        AND createdAt < CURDATE()
    `);
    const weekAverage = Math.round(Number(avgRows[0]?.avg7 ?? 0));

    const total = droppedOff + booked;
    const trend: "up" | "down" | "flat" =
      total > weekAverage * 1.15 ? "up" :
      total < weekAverage * 0.85 ? "down" : "flat";

    return { total, droppedOff, booked, invoicedToday, weekAverage, trend };
  } catch (err) {
    log.warn("getLineOfCarsToday failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { total: 0, droppedOff: 0, booked: 0, invoicedToday: 0, weekAverage: 0, trend: "flat" };
  }
}

/** Estimate current jobs based on time of day patterns */
function estimateCurrentJobs(hour: number, day: number): number {
  if (day === 0) return hour >= 10 && hour <= 14 ? 3 : 1; // Sunday lighter
  // Weekday patterns
  if (hour < 9) return 1;
  if (hour < 11) return 3; // Morning rush
  if (hour < 13) return 4; // Peak
  if (hour < 15) return 3;
  if (hour < 17) return 2;
  return 1;
}
