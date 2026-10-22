/**
 * Shop Status API — Real-time bay availability and wait times
 * Powers the live status marquee and customer-facing status page.
 */

import { BUSINESS } from "@shared/business";

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
   * therefore openBays + the wait number) came from the caller's
   * activeOrderCount. False means no complete occupancy source exists, and
   * clients must NOT render the wait/bay figures as fact.
   */
  waitIsFresh: boolean;
}

/**
 * Get current shop status: open/closed from the hours, bays and wait only
 * from a caller-supplied active-order count.
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

  // Bays and wait only from a caller-supplied count. Walk-ins are tracked
  // in ShopDriver, so no table here covers the line: bookings.stage left one
  // booking "in-progress" from April and read as "3 bays free" for six
  // months (prod read 2026-10-22), and a stage moved today proves activity,
  // not coverage. Without a complete source we claim no bays and no wait.
  const jobs = activeOrderCount ?? 0;
  const waitIsFresh = activeOrderCount !== undefined;

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
