/**
 * Flat rate vs hourly — the arithmetic behind /mechanic-pay-calculator.
 *
 * WHY THIS EXISTS (docs/recruiting/RECRUITING-ENGINE-2026-09.md, Sec. 5 and 15):
 * "flat rate vs hourly mechanic" (+ "reddit", "salary") is one of the phrase
 * families Google autocompletes for technicians, and it is the exact question
 * Nick's hourly pay answers. A calculator that uses the tech's own numbers is
 * useful whether or not they ever apply here — which is what keeps it from
 * being a doorway page.
 *
 * DELIBERATE SIMPLIFICATIONS (stated on the page too):
 *  - Hourly overtime is modelled at 1.5x over 40 hours in the week.
 *  - Flat-rate overtime is NOT modelled: how it is computed varies by shop
 *    and pay plan, so the page tells the tech to ask.
 *  - A flat-rate guarantee is modelled as guaranteed FLAG HOURS per week.
 *  - Annual = weekly x working weeks (default 50).
 * These are comparisons, not payroll — never an offer.
 */

export interface HourlyInput {
  ratePerHour: number;
  hoursWorked: number;
}

export interface FlatRateInput {
  ratePerFlagHour: number;
  flaggedHours: number;
  /** Guaranteed flag hours per week; 0 = no guarantee. */
  guaranteedHours: number;
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

/** Weekly hourly pay with 1.5x over 40. Negative or absurd inputs are clamped. */
export function weeklyHourlyPay({ ratePerHour, hoursWorked }: HourlyInput): number {
  const rate = clamp(ratePerHour, 0, 500);
  const hours = clamp(hoursWorked, 0, 100);
  const regular = Math.min(hours, 40);
  const overtime = Math.max(hours - 40, 0);
  return round2(rate * regular + rate * 1.5 * overtime);
}

/** Weekly flat-rate pay: the greater of flagged hours and the guarantee, times the flag rate. */
export function weeklyFlatRatePay({ ratePerFlagHour, flaggedHours, guaranteedHours }: FlatRateInput): number {
  const rate = clamp(ratePerFlagHour, 0, 500);
  const flagged = clamp(flaggedHours, 0, 150);
  const guaranteed = clamp(guaranteedHours, 0, 80);
  return round2(rate * Math.max(flagged, guaranteed));
}

/**
 * Flagged hours a flat-rate tech needs in a week to match the hourly job's
 * weekly pay. null when the flag rate is 0 (no amount of flagging matches).
 */
export function breakEvenFlagHours(hourly: HourlyInput, ratePerFlagHour: number): number | null {
  const rate = clamp(ratePerFlagHour, 0, 500);
  if (rate === 0) return null;
  return Math.round((weeklyHourlyPay(hourly) / rate) * 10) / 10;
}

export function annualize(weekly: number, workingWeeks = 50): number {
  return round2(weekly * clamp(workingWeeks, 0, 52));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
