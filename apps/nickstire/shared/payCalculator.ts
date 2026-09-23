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

/**
 * Upper limits the math clamps each input to (negatives clamp to 0). Exported
 * so the page states the value it actually used — it printed "$600" while
 * computing with $500 (review of #2557, 2026-09-23).
 */
export const PAY_INPUT_LIMITS = {
  rate: 500,
  hoursWorked: 100,
  flaggedHours: 150,
  guaranteedHours: 80,
  workingWeeks: 52,
} as const;

/** The value the math uses for an input: finite, >= 0, <= its limit. */
export function clampPayInput(field: keyof typeof PAY_INPUT_LIMITS, n: number): number {
  return Number.isFinite(n) ? Math.min(PAY_INPUT_LIMITS[field], Math.max(0, n)) : 0;
}

/** Weekly hourly pay with 1.5x over 40. Negative or absurd inputs are clamped. */
export function weeklyHourlyPay({ ratePerHour, hoursWorked }: HourlyInput): number {
  const rate = clampPayInput("rate", ratePerHour);
  const hours = clampPayInput("hoursWorked", hoursWorked);
  const regular = Math.min(hours, 40);
  const overtime = Math.max(hours - 40, 0);
  return round2(rate * regular + rate * 1.5 * overtime);
}

/** Weekly flat-rate pay: the greater of flagged hours and the guarantee, times the flag rate. */
export function weeklyFlatRatePay({ ratePerFlagHour, flaggedHours, guaranteedHours }: FlatRateInput): number {
  const rate = clampPayInput("rate", ratePerFlagHour);
  const flagged = clampPayInput("flaggedHours", flaggedHours);
  const guaranteed = clampPayInput("guaranteedHours", guaranteedHours);
  return round2(rate * Math.max(flagged, guaranteed));
}

/**
 * Flagged hours a flat-rate tech needs in a week to match the hourly job's
 * weekly pay. null when the flag rate is 0 (no amount of flagging matches).
 */
export function breakEvenFlagHours(hourly: HourlyInput, ratePerFlagHour: number): number | null {
  const rate = clampPayInput("rate", ratePerFlagHour);
  if (rate === 0) return null;
  return Math.round((weeklyHourlyPay(hourly) / rate) * 10) / 10;
}

export function annualize(weekly: number, workingWeeks = 50): number {
  return round2(weekly * clampPayInput("workingWeeks", workingWeeks));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
