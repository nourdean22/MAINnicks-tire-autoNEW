/**
 * Is the declined-work ledger actually MEASURING anything?
 *
 * THE DEFECT, measured against production 2026-08-25.
 *
 * getDeclinedWorkLedger() and getDeclinedWorkStats() both read `work_orders`
 * and `work_order_items`. Those tables hold ONE row and ZERO rows
 * respectively. The ledger loop does `if (items.length === 0) continue;`, so
 * with no item rows it can only ever return an empty array, and the stats
 * query can only ever sum to 0.
 *
 * That zero is then PUBLISHED as if it were a measurement:
 *
 *   statenourSync   -> declinedWork.totalRecoverable: 0, under a section
 *                      commented "revenue on the table"
 *   nour-os-bridge  -> declinedValue30d: 0
 *
 * A number that cannot be non-zero is not evidence that there is nothing to
 * recover. It is evidence that nobody is looking. The shop is demonstrably
 * working declined quotes in the same window - the alg-declined-work-recovery
 * cron sent 14 SMS across its last 7 runs - while its twin, the
 * declined-work-recovery ledger job, logged "0 unrecovered ($0)" every single
 * run.
 *
 * DELIBERATELY NOT FIXED HERE: this module does not repoint the ledger at
 * alg_estimates. An unmatched estimate is not the same business fact as a line
 * item a customer declined at the counter, and silently redefining the number
 * would be a worse lie than reporting it honestly as unmeasured. The house
 * precedent is UnpaidInvoicesSection: unknown is not zero, and money you are
 * owed reported as collected is the worst false-green in this admin.
 */

/**
 * populated - there are declined line items to measure, so a 0 is real.
 * empty     - the source tables carry no declined items at all, so any total
 *             is an artifact of an unpopulated subsystem, not a finding.
 * unknown   - the count could not be read. NOT collapsed into "empty":
 *             a failed read must never present as a confident answer.
 */
export type DeclinedSourceState = "populated" | "empty" | "unknown";

/**
 * `null` means the count could not be read - a failed query, not a zero.
 * Note that `Number(null)` is 0 in JS, which is exactly how a failed read
 * becomes a confident "nothing to recover"; the null is checked first.
 */
export function sourceStateFrom(declinedItemRows: number | null | undefined): DeclinedSourceState {
  // ONE guard, deliberately. An earlier version also tested null/undefined
  // explicitly on the line above; a mutation probe proved that line was dead,
  // because Number.isFinite already rejects both - and a canary that cannot
  // tell which line protects the behaviour is not a canary.
  //
  // It must be Number.isFinite, never the global isFinite: the global COERCES
  // its argument, so isFinite(null) is TRUE and a failed read would sail
  // through as a confident zero. Number.isFinite does not coerce.
  if (!Number.isFinite(declinedItemRows as number) || (declinedItemRows as number) < 0) return "unknown";
  return (declinedItemRows as number) > 0 ? "populated" : "empty";
}

/** Only a populated source makes a published total a measurement. */
export function isMeasured(state: DeclinedSourceState): boolean {
  return state === "populated";
}

/** One short sentence for a log line or an operator payload. */
export function sourceNote(state: DeclinedSourceState): string {
  if (state === "populated") return "declined-work totals are measured from work_order_items";
  if (state === "empty") {
    return "work_order_items holds no declined rows - declined-work totals are UNMEASURED, not zero";
  }
  return "work_order_items could not be counted - declined-work totals are UNKNOWN, not zero";
}

/** Counts declined line items. Never throws; a failed read reports "unknown". */
export async function declinedWorkSourceState(): Promise<DeclinedSourceState> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return "unknown";
    const { workOrderItems } = await import("../../drizzle/schema");
    const { eq, sql } = await import("drizzle-orm");
    const [row] = await d
      .select({ n: sql<number>`count(*)` })
      .from(workOrderItems)
      .where(eq(workOrderItems.declined, true));
    const n = row?.n;
    return sourceStateFrom(n === undefined || n === null ? null : Number(n));
  } catch {
    return "unknown";
  }
}
