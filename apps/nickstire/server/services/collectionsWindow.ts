/**
 * The collections window, in one place.
 *
 * ─── Why this file exists ──────────────────────────────────────────────
 *
 * The unpaid-invoice recovery cron selects invoices aged between 7 and 90
 * days. Both ends matter and only one was ever visible:
 *
 * · The LOWER bound is a courtesy delay - do not chase a bill that is 3 days
 *   old.
 * · The UPPER bound is a silent cliff. Measured 2026-08-25: of 8 unpaid
 *   invoices, THREE ($1,606.62, aged 108/128/138 days) are past 90 and can
 *   never be selected again. No escalation, no alert, no list. They simply
 *   stopped being anybody's problem.
 *
 * The numbers lived only inside the cron, so the admin surface could not show
 * which invoices were in the window and which had fallen out of it. Hoisting
 * them means the cron and the UI cannot drift into disagreeing about what
 * "eligible" means - the same one-number discipline the cost-detail floor uses.
 */

export const COLLECTIONS_MIN_AGE_DAYS = 7;
export const COLLECTIONS_MAX_AGE_DAYS = 90;

export type CollectionsState =
  /** Younger than the courtesy delay. Will become eligible on its own. */
  | "too-new"
  /** Inside the window the cron selects from. */
  | "eligible"
  /**
   * Past the upper bound. The cron will NEVER select it again. Without a
   * human, this invoice is finished - which is why it is named rather than
   * quietly excluded.
   */
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
  const d = invoiceDate instanceof Date ? invoiceDate : new Date(invoiceDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Is live sending armed?
 *
 * Deliberately a READ, never a write. Flipping this is the operator's call and
 * is made on Railway; this module only reports which way it is set so the
 * admin surface can show "identified but not chased" instead of implying the
 * money is being worked.
 */
export function recoverySendingArmed(): boolean {
  return process.env.FEATURE_UNPAID_INVOICE_RECOVERY === "1";
}
