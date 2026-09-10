/**
 * The 48-hour reply promise /careers makes, as a testable function.
 *
 * WHY ITS OWN MODULE. The banding started life inline inside
 * `getCandidateSlaBreaches` in db.ts, which meant the only way to test it was
 * to read db.ts as a string and assert on source text. A source-text assertion
 * passes for a rule that is written down and never applied, which is the exact
 * failure this repo keeps finding. Extracted, the thresholds can be asserted as
 * BEHAVIOUR — including the boundaries, where an off-by-one lives.
 *
 * The thresholds themselves are PROVISIONAL. 48 is the public promise
 * (Careers.tsx states it twice); 24 and 40 are operating thresholds chosen to
 * leave room to act before the promise breaks. They are not external truths —
 * set them from observed first-response times once there are enough to measure.
 */

/** Hours waited at which each band begins. Ordered least to most severe. */
export const SLA_THRESHOLD_HOURS = {
  /** Surfaced at all — a day has passed with no reply. */
  warning: 24,
  /** Eight hours of runway left against the public promise. */
  urgent: 40,
  /** The promise on /careers is now broken. */
  breached: 48,
} as const;

export type SlaBand = keyof typeof SLA_THRESHOLD_HOURS;

/**
 * `null` hours means the row's createdAt was NULL, so the wait is UNKNOWN.
 * Unknown escalates to `breached` rather than resting in `warning`: a row we
 * cannot age is the one most likely to have been sitting longest, and the
 * calmest band is the wrong default for missing information. (`Number(null)`
 * is 0, which is how the naive version filed those under `warning`.)
 */
export function slaBand(hoursWaiting: number | null): SlaBand {
  if (hoursWaiting == null) return "breached";
  if (hoursWaiting >= SLA_THRESHOLD_HOURS.breached) return "breached";
  if (hoursWaiting >= SLA_THRESHOLD_HOURS.urgent) return "urgent";
  return "warning";
}
