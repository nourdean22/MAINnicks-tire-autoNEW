/**
 * Which invoice rows are NOT real customers?
 *
 * WHY THIS EXISTS, measured 2026-08-25. The unpaid-invoice recovery lane found
 * 5 eligible invoices worth $2,221.35 and the admin dashboard published that
 * figure as money to collect. THREE of the five were seeded test rows:
 * "John Test Doe" and "Nour Test" both on 216-555-9999, and "test test" on the
 * 11-digit 77777777777. $1,167.27 of that $2,221.35 - 52.5% - was fiction.
 *
 * BASE RATE, because a ratio inside a filter is not a fact about the table:
 * across ALL 2,959 invoices only 4 rows look like tests (0.14%), worth
 * $1,270.03 of $1,432,056.23 (0.09% of dollars). `alg_estimates` is CLEAN -
 * 0 of 452. So table-wide revenue, margin and conversion figures are NOT
 * materially contaminated, and nothing in today's dollar reporting inherits a
 * problem.
 *
 * The concentration is real but largely DEFINITIONAL: test rows are created by
 * hand and never paid, so they cannot drain out of the unpaid bucket the way
 * real invoices do. They pool there permanently. Measured: 60% of the unpaid
 * 7-90d set vs 0.14% table-wide vs 0.03% of paid invoices. The lesson is
 * narrow and worth stating exactly - any figure derived from the UNPAID slice
 * is badly contaminated; figures over the whole table are not.
 *
 * DELIBERATELY CONSERVATIVE. Every signal below is a phone that CANNOT reach a
 * person, or a name that says "test" as its own word. It does not guess from
 * round amounts, low volume, or silence. Excluding a real customer from a
 * payment reminder costs the shop money, which is the same failure in the
 * opposite direction - so an ambiguous row stays IN and a human decides.
 *
 * Known NOT caught, on purpose: 216-848-8888 ("Nick Rabah", $846.72). It has
 * 18 outbound messages, all `delivered`, and zero inbound. Deliverable and
 * possibly internal, but nothing proves it is not a customer, so the filter
 * leaves it alone.
 *
 * ONE IMPLEMENTATION, IN JS. There is deliberately no parallel SQL predicate:
 * two copies of a rule like this drift, and the eligible set is bounded at 500
 * rows, so filtering in memory costs nothing and cannot disagree with itself.
 */

export interface MaybeTestRow {
  customerName?: string | null;
  customerPhone?: string | null;
}

/** Why a row was excluded — surfaced so an exclusion is never silent. */
export type TestRowReason =
  | "name-says-test"
  | "phone-555-exchange"
  | "phone-repeated-digit"
  | "phone-wrong-length";

function digits(p: string | null | undefined): string {
  return (p ?? "").replace(/[^0-9]/g, "");
}

/**
 * `test` as a WHOLE WORD only. Substring matching would exclude real people -
 * "Testa", "Contested", the surname "Tester" - and a suppressed reminder is a
 * bill that never gets paid.
 */
const NAME_TEST_WORD = /(^|[^a-z])test([^a-z]|$)/i;

/** NANP reserved fictional exchange: no 555 number reaches a subscriber. */
const PHONE_555 = /^[0-9]{3}555[0-9]{4}$/;

/** Ten or more of the same digit — 7777777777, 9999999999. Not dialable. */
const PHONE_REPEATED = /^([0-9])\1{9,}$/;

/**
 * Returns the reason a row is not a real customer, or null if it is (or might
 * be). Null means "keep it" — the default is always to keep.
 */
export function testRowReason(row: MaybeTestRow): TestRowReason | null {
  if (row.customerName && NAME_TEST_WORD.test(row.customerName)) return "name-says-test";
  const d = digits(row.customerPhone);
  if (d === "") return null; // no phone is a separate problem, not a test row
  if (PHONE_555.test(d)) return "phone-555-exchange";
  if (PHONE_REPEATED.test(d)) return "phone-repeated-digit";
  // A US number is 10 digits, or 11 beginning with 1. Anything else cannot be
  // dialled — normalizePhone() returns null for it and sendSms refuses.
  if (d.length !== 10 && !(d.length === 11 && d.startsWith("1"))) return "phone-wrong-length";
  return null;
}

export function isLikelyTestRow(row: MaybeTestRow): boolean {
  return testRowReason(row) !== null;
}

/** Split a set into the real rows and the excluded ones, with reasons. */
export function partitionTestRows<T extends MaybeTestRow>(
  rows: T[],
): { real: T[]; excluded: Array<{ row: T; reason: TestRowReason }> } {
  const real: T[] = [];
  const excluded: Array<{ row: T; reason: TestRowReason }> = [];
  for (const r of rows) {
    const reason = testRowReason(r);
    if (reason) excluded.push({ row: r, reason });
    else real.push(r);
  }
  return { real, excluded };
}
