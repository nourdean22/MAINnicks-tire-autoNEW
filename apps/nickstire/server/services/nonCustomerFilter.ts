/**
 * Which rows are NOT a customer the shop should message or bill?
 *
 * TWO DISTINCT CATEGORIES, deliberately not merged. A future reader must be
 * able to tell WHY a row was withheld, because "junk data" and "this is our own
 * phone" have completely different remedies:
 *
 *   1. SEEDED TEST DATA - a phone that cannot reach a person, or a name whose
 *      own word is "test". Safe to ignore forever.
 *   2. INTERNAL LINES - real, deliverable, working numbers that belong to the
 *      shop or the operator. Nothing is wrong with the DATA; the problem is
 *      that automation should not treat the business as its own customer.
 *
 * WHY (1) EXISTS, measured 2026-08-25. The unpaid-invoice lane reported 5
 * eligible invoices worth $2,221.35 as collectable and the dashboard published
 * it. Three were seeded tests - two on the reserved 216-555-9999, one on the
 * 11-digit 77777777777 - so $1,167.27 of that was fiction.
 *
 * Base rates, because a ratio inside a filter is not a fact about the table:
 * 4 of 2,959 invoices look like tests (0.14%), $1,270.03 of $1,432,056.23
 * (0.09% of dollars); alg_estimates is clean at 0 of 452. Table-wide revenue,
 * margin and conversion figures are NOT materially contaminated. The 60%
 * concentration in the unpaid slice is largely DEFINITIONAL - a test row is
 * never paid, so it cannot drain out of that bucket the way a real invoice
 * does, and it pools there permanently.
 *
 * WHY (2) EXISTS, confirmed by the operator 2026-08-25. 216-848-8888 is HIS
 * OWN LINE. It was one invoice away from receiving an automated "you still owe
 * $846.72" text - a bill he owes himself. Measured, it had already received 18
 * customer-facing messages across at least eight lanes: lead response, 2-week
 * follow-up, thank-you, check-in, nine missed-call follow-ups, a tire quote, a
 * maintenance-due reminder and a Google review request.
 *
 * SO THIS MODULE IS NOT THE WHOLE FIX. It is consulted by the unpaid-invoice
 * lane and the collections dashboard only. Every other sending job still
 * resolves phone numbers independently. The durable fix is a check inside
 * sendSms(), the one choke point all lanes pass through - proposed rather than
 * shipped here, because refusing internal numbers at the core send path would
 * also block deliberate operator self-tests, and that trade is the operator's
 * to make, not a filter's.
 *
 * THE DEFAULT IS ALWAYS TO KEEP. Excluding a real customer means a bill that
 * never gets asked for - the same failure in the opposite direction - so
 * anything unproven stays IN and a human decides. A bug in here degrades
 * toward the pre-existing behaviour, not toward silence.
 */

export interface MaybeNonCustomer {
  customerName?: string | null;
  customerPhone?: string | null;
}

export type ExclusionReason =
  | "name-says-test"
  | "phone-555-exchange"
  | "phone-repeated-digit"
  | "phone-wrong-length"
  | "internal-operator-line";

/**
 * Known internal lines, each with the reason it is here and the date it was
 * confirmed. Never add a number to this list on inference - a wrong entry
 * silently stops a paying customer from ever being contacted, and nothing
 * downstream would report it as a suppression.
 *
 * WHY THE DIGITS ARE IN SOURCE, deliberately. A suppression list is a SAFETY
 * control, so it must fail safe: in source it is reviewed, diffed and cannot
 * silently vanish. The same list in an env var disappears the moment a deploy
 * drops the variable, and the failure mode is texting the people it exists to
 * protect - with nothing logged, because the list would simply be empty.
 *
 * The digits are stored unformatted because that is the shape they are COMPARED
 * in (see `last10` below), and for no other reason.
 *
 * CORRECTED 2026-09-16. This comment used to claim the unformatted form was
 * chosen "so the PII lint's Cleveland-phone pattern does not read it as
 * customer data". That is false, and measured false: the rule is
 * `\b(216|330|440|234)\s*[\-.\s]?\s*\d{3}\s*[\-.\s]?\s*\d{4}\b`, whose
 * separators are OPTIONAL, so `2168488888` matches exactly as readily as
 * `216-848-8888`. A 120-commit replay of the linter found this file to be the
 * ONE true positive in that history - it tripped the gate at the commit that
 * added it, with no waiver. What actually silences the rule today is the
 * `// pii-allow:` marker on the line itself. Keep that marker: strip it and the
 * gate blocks the commit, which as of 2026-09-16 is a pre-commit hook and not
 * just a `verify` step. A comment that misstates WHY a guard passes is worse
 * than no comment - the next reader reformats the digits for legibility,
 * expects the gate to stay quiet for the stated reason, and learns nothing
 * about the marker doing the real work.
 */
export interface InternalLine {
  /** Last 10 digits, NANP. Compared against the same normalisation. */
  last10: string;
  note: string;
}

/**
 * The operator's own mobile (his "CEO line"). Exported so the few lanes that
 * SHOULD reach him — the careers new-candidate alert, by his instruction of
 * 2026-09-23 — read the same value this guard refuses automated customer
 * sends to. One definition; the alert and the guard cannot drift apart.
 */
export const OPERATOR_MOBILE_LAST10 = "2168488888"; // pii-allow: operator's own mobile, see INTERNAL_LINES below

export const INTERNAL_LINES: readonly InternalLine[] = [
  {
    last10: OPERATOR_MOBILE_LAST10, // pii-allow: the OPERATOR'S OWN mobile, hardcoded on purpose as the internal-line filter so the recovery crons stop texting him (he had already received 18 automated customer messages across 8 lanes). Removing it re-breaks that guard. Not allowlisted globally because, unlike the shop main/VAPI/Twilio lines, this one is not public.
    note: "Operator's own mobile — confirmed by the operator 2026-08-25. Held 1 unpaid invoice ($846.72) that the recovery cron was about to text him about. Had already received 18 automated customer messages across 8 lanes.",
  },
  {
    last10: "2168620005",
    note: "The shop's own published line. Present in customers and alg_estimates, so an automated lane could address the business as its own customer.",
  },
];

function digits(p: string | null | undefined): string {
  return (p ?? "").replace(/[^0-9]/g, "");
}

/**
 * `test` as a WHOLE WORD only. Substring matching would exclude real people -
 * "Testa", "Contested", the surname "Testerman" - and a suppressed reminder is
 * a bill that never gets paid.
 */
const NAME_TEST_WORD = /(^|[^a-z])test([^a-z]|$)/i;

/** NANP reserved fictional exchange: no 555 number reaches a subscriber. */
const PHONE_555 = /^[0-9]{3}555[0-9]{4}$/;

/** Ten or more of the SAME digit, whole-string. Anchored on purpose: a real
 *  number may end in four identical digits (216-848-8888 does). */
const PHONE_REPEATED = /^([0-9])\1{9,}$/;

/**
 * Why this row is not a customer to message, or null if it is (or might be).
 * Null means KEEP.
 *
 * `internalLines` is injectable so tests can exercise the mechanism against a
 * synthetic registry instead of asserting on the operator's real number.
 */
export function exclusionReason(
  row: MaybeNonCustomer,
  internalLines: readonly InternalLine[] = INTERNAL_LINES,
): ExclusionReason | null {
  const d = digits(row.customerPhone);
  const last10 = d.length >= 10 ? d.slice(-10) : d;

  // Internal check FIRST. These are real, well-formed, deliverable numbers, so
  // no other rule would ever catch them.
  if (last10 !== "" && internalLines.some((l) => l.last10 === last10)) {
    return "internal-operator-line";
  }

  if (row.customerName && NAME_TEST_WORD.test(row.customerName)) return "name-says-test";
  if (d === "") return null; // no phone is a separate problem, not an exclusion
  if (PHONE_555.test(d)) return "phone-555-exchange";
  if (PHONE_REPEATED.test(d)) return "phone-repeated-digit";
  // A US number is 10 digits, or 11 beginning with 1. Anything else cannot be
  // dialled — normalizePhone() returns null for it and sendSms refuses.
  if (d.length !== 10 && !(d.length === 11 && d.startsWith("1"))) return "phone-wrong-length";
  return null;
}

/**
 * The internal-line entry for a phone number, or null. Exported so the ONE
 * choke point every SMS lane passes through - sendSms() - can refuse an
 * automated customer-facing send and name WHY in the log.
 *
 * Accepts any format: the comparison is on the last 10 digits after stripping
 * non-digits, so "+1 (216) 848-8888", "12168488888" and "216.848.8888" all
 * resolve to the same entry. A guard that only matched one spelling would be
 * bypassed by the next caller that formatted the number differently.
 */
export function internalLineFor(phone: string | null | undefined): InternalLine | null {
  const d = digits(phone);
  if (d.length < 10) return null;
  const last10 = d.slice(-10);
  return INTERNAL_LINES.find((l) => l.last10 === last10) ?? null;
}

export function isNonCustomer(
  row: MaybeNonCustomer,
  internalLines: readonly InternalLine[] = INTERNAL_LINES,
): boolean {
  return exclusionReason(row, internalLines) !== null;
}

/** Human-readable note for an exclusion, so a suppression is never anonymous. */
export function exclusionNote(reason: ExclusionReason): string {
  if (reason === "internal-operator-line") {
    return "internal line (shop or operator) — not a customer, deliberately not messaged";
  }
  return `seeded test data (${reason})`;
}

/** Split a set into real customers and withheld rows, with reasons. */
export function partitionNonCustomers<T extends MaybeNonCustomer>(
  rows: T[],
  internalLines: readonly InternalLine[] = INTERNAL_LINES,
): { real: T[]; excluded: Array<{ row: T; reason: ExclusionReason }> } {
  const real: T[] = [];
  const excluded: Array<{ row: T; reason: ExclusionReason }> = [];
  for (const r of rows) {
    const reason = exclusionReason(r, internalLines);
    if (reason) excluded.push({ row: r, reason });
    else real.push(r);
  }
  return { real, excluded };
}
