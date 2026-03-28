/**
 * Shop Status API — Real-time bay availability and wait times
 * Powers the live status marquee and customer-facing status page.
 */

import { createLogger } from "../lib/logger";

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
}

/**
 * Get current shop status.
 * In v1, this uses heuristics. In v2, will be driven by real-time bay tracking.
 */
export function getShopStatus(activeOrderCount?: number): ShopStatus {
  // Use Eastern Time — Railway runs UTC, but business hours are ET
  const now = new Date();
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
  const day = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay(); // 0=Sun

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

  // Estimate bay usage from active orders or time of day
  const jobs = activeOrderCount ?? estimateCurrentJobs(hour, day);
  const occupiedBays = Math.min(jobs, TOTAL_BAYS);
  const openBays = TOTAL_BAYS - occupiedBays;

  // Wait time heuristic
  let estimatedWaitMinutes = 0;
  if (openBays === 0) estimatedWaitMinutes = 45;
  else if (openBays === 1) estimatedWaitMinutes = 20;
  else if (openBays === 2) estimatedWaitMinutes = 10;

  // Status message
  let statusMessage: string;
  if (!isOpen) {
    statusMessage = `We're closed right now. ${nextOpenTime ? `Opening at ${nextOpenTime}.` : ""}`;
  } else if (openBays >= 3) {
    statusMessage = `${openBays} bays open — walk right in!`;
  } else if (openBays >= 1) {
    statusMessage = `${openBays} bay${openBays > 1 ? "s" : ""} available. Short wait possible.`;
  } else {
    statusMessage = "All bays full — about a 45-minute wait. Call ahead: (216) 862-0005.";
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
