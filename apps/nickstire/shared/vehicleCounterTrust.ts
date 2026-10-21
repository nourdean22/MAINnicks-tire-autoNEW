/**
 * Is the car counter counting the cars? Judged against billed jobs, not against itself.
 *
 * WHY (2026-10-21). After the 2026-09-28 RTSP cutover the sign camera's PRODUCTION arrivals fell
 * from 23-122 a day to 0-10 (whole days at zero) while ShopDriver kept billing 16-30 jobs a week,
 * and every health surface stayed green. lotDataConfidence compares today with the counter's own
 * last 8 days, so once the history itself was broken, ~0 read as normal. Billed jobs are an
 * independent count: every billed job is a car that came in, so over the same complete days the
 * camera must count at least as many arrivals as the shop billed.
 *
 * Rules: a count that could not be read is UNKNOWN (never 0); under MIN_BILLED jobs there is too
 * little to judge; arrivals below billed is UNDERCOUNTING; anything else is OK (drive-ins that
 * bought nothing make arrivals above billed normal).
 */

export type VehicleCounterTrustLevel = "OK" | "UNDERCOUNTING" | "UNKNOWN";

export interface VehicleCounterTrust {
  level: VehicleCounterTrustLevel;
  arrivals: number | null;
  billed: number | null;
  days: number;
  reason: string;
}

/**
 * Fewer billed jobs than this in the window is too little to judge the counter. Not exported: no
 * production code reads it yet (knip orphan gate); the test restates it by value.
 */
const MIN_BILLED = 5;
/** Complete ET days before today that the comparison covers. */
export const WINDOW_DAYS = 7;

export function vehicleCounterTrust(input: { arrivals: number | null; billed: number | null; days: number }): VehicleCounterTrust {
  const { arrivals, billed, days } = input;
  const base = { arrivals, billed, days };
  if (arrivals === null || billed === null) {
    const missing = arrivals === null && billed === null ? "camera arrivals or billed jobs" : arrivals === null ? "camera arrivals" : "billed jobs";
    return { ...base, level: "UNKNOWN", reason: `Could not read ${missing} for the last ${days} days, so the counter cannot be judged.` };
  }
  if (billed < MIN_BILLED) {
    return { ...base, level: "UNKNOWN", reason: `${billed} jobs billed: too few billed jobs in the last ${days} days to judge the counter.` };
  }
  if (arrivals < billed) {
    return {
      ...base,
      level: "UNDERCOUNTING",
      reason: `The camera counted ${arrivals} arrivals in the last ${days} days while ${billed} jobs were billed. Every billed job is a car that came in, so the counter is missing cars.`,
    };
  }
  return { ...base, level: "OK", reason: `The camera counted ${arrivals} arrivals in the last ${days} days against ${billed} billed jobs.` };
}
