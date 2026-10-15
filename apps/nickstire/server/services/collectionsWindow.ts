import { shopInstant } from "../lib/timezoneAssert";

/**
 * The collections window, in one place: where an unpaid invoice's age puts it
 * relative to 7 and 90 days. The admin Unpaid list reads it.
 *
 * A recovery cron used this window to text customers. It was removed on
 * 2026-10-15 because payment is taken on a separate register, so nothing sends
 * from these numbers any more.
 *
 * Measured 2026-08-25: of 8 unpaid invoices, three ($1,606.62, aged
 * 108/128/138 days) were past the upper bound.
 */

export const COLLECTIONS_MIN_AGE_DAYS = 7;
export const COLLECTIONS_MAX_AGE_DAYS = 90;

export type CollectionsState =
  /** Younger than the courtesy delay. Will become eligible on its own. */
  | "too-new"
  /** Inside the 7-90 day window. */
  | "eligible"
  /** Past the upper bound. Needs a person, not a rule. */
  | "aged-out";

/** Pure. Age in days -> where the invoice sits relative to the window. */
export function collectionsState(ageDays: number): CollectionsState {
  if (ageDays < COLLECTIONS_MIN_AGE_DAYS) return "too-new";
  if (ageDays > COLLECTIONS_MAX_AGE_DAYS) return "aged-out";
  return "eligible";
}

/** Whole days between an invoice date and now. Computed here so callers agree. */
export function invoiceAgeDays(invoiceDate: Date | string | null, now: Date = new Date()): number {
  if (!invoiceDate) return 0;
  const wall = invoiceDate instanceof Date ? invoiceDate : new Date(invoiceDate);
  if (Number.isNaN(wall.getTime())) return 0;
  // invoiceDate is the shop's wall clock as stored, so the age is measured from its real instant.
  const d = shopInstant(wall);
  return Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
}
