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
        // Only bookings whose stage moved TODAY (shop day, bounded in SQL:
        // driver-parsed timestamps shift on ET). Walk-ins live in ShopDriver,
        // so a tracker nobody touched today says nothing about the line: a
        // booking left "in-progress" in April read as 1 car in the shop and
        // "3 bays free" for six months (prod read 2026-10-22).
        const { bookings } = await import("../../drizzle/schema");
        const { and, ne } = await import("drizzle-orm");
        const { minutesSinceShopMidnight } = await import("../lib/timezoneAssert");
        const movedToday = await d.select({ stage: bookings.stage, status: bookings.status })
          .from(bookings)
          .where(
            and(
              ne(bookings.stage, "received"),
              sql`${bookings.stageUpdatedAt} >= NOW() - INTERVAL ${minutesSinceShopMidnight(now)} MINUTE`
            )
          );
        const ACTIVE = new Set(["inspecting", "waiting-parts", "in-progress", "quality-check"]);
        jobs = movedToday.filter((b: { stage: string; status?: string }) => ACTIVE.has(b.stage) && b.status !== "cancelled").length;
        waitIsFresh = movedToday.length > 0;
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
