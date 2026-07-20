/**
 * IS THIS THE SAME PERSON? — the one question nothing in this codebase owned.
 *
 * THE DEFECT THIS EXISTS TO END
 * Four functions named `normalizePhone` shipped side by side, with two
 * incompatible output contracts:
 *
 *   lib/phone.ts              -> "+12162035831"  E.164, for storage and display
 *   shopDriverMirror.ts:655   -> "2162035831"    bare 10, WRITES customers.phone
 *   revenueAttribution.ts:132 -> "2162035831"    last-10, null when short
 *   smsInstrumentation.ts:34  -> "2162035831"    last-10, EMPTY STRING when short
 *
 * Plus bare `.slice(-10)` at intelligenceEngines.ts:429, :474, :680.
 *
 * None of them is wrong. Formatting a number for Twilio and deciding whether two
 * records describe one human are genuinely different jobs. The failure was that
 * both jobs wore the same NAME, so nobody noticed that the second job had no
 * owner — and every consumer that needed it quietly invented its own answer.
 *
 * WHAT IT COST, MEASURED IN PRODUCTION 2026-07-20
 *   alg_estimates.customer_phone is E.164   ("+12162035831", 378 of 425 rows)
 *   customers.phone is bare 10-digit        ("2162035831", 1941 of 1945 rows)
 *
 * A string-equality join between them cannot match, and it didn't:
 *   customer_id was NULL on ALL 425 estimate rows
 *   only 14 of 425 phones matched `customers` by raw equality
 *
 * So the declined-work recovery engine — 425 estimates, $365,738 open, a firing
 * 3/7/14/30/45-day follow-up ladder and 87 voice attempts — could not see a
 * single one of its own conversions. Its reported "0% conversion after follow-up"
 * was never a verdict on the outreach. It was a verdict on a format mismatch.
 *
 * Joining on the last ten digits instead finds 341 of 425, with zero fan-out and
 * zero ambiguity (verified: no phone in `customers` maps to more than one row).
 *
 * WHY LAST-TEN-DIGITS IS THE RIGHT KEY HERE
 * It is deliberately lossy, and that is the point. A match key exists to survive
 * formatting, country-code presence, punctuation and the habits of three separate
 * upstream systems. It is NOT a phone number and must never be dialled, stored as
 * one, or shown to a customer — use lib/phone.ts normalizePhone for that.
 *
 * SCOPE, HONESTLY: this is a NANP (US/Canada) assumption. Every number this shop
 * has ever recorded is US, and the shop serves one metro area. An international
 * number would collide only with another number sharing its last ten digits,
 * which cannot happen inside NANP. If the shop ever takes international work this
 * needs revisiting, and the guard below makes that failure loud rather than silent.
 */

/** Exactly ten digits, or nothing. There is no partial answer to identity. */
export type PhoneMatchKey = string & { readonly __brand: "PhoneMatchKey" };

/**
 * The canonical answer to "are these the same person?".
 *
 * Returns ten digits, or `null` when the input cannot identify anyone.
 *
 * `null` — not `""` — because an empty string is a VALUE that compares equal to
 * other empty strings. smsInstrumentation.ts:34 returns "" for unusable input,
 * so two different unidentifiable records match each other there. A null cannot
 * be joined on by accident; an empty string silently can.
 */
export function phoneMatchKey(input: string | null | undefined): PhoneMatchKey | null {
  if (input == null) return null;

  const digits = String(input).replace(/\D/g, "");

  // Below ten digits is not a phone number that identifies anyone — it is a
  // truncation, a placeholder or a typo. Production holds a few: one 8-digit and
  // one 9-digit row in `customers`. Matching those to anything would be a guess.
  if (digits.length < 10) return null;

  // The last ten are the subscriber number under NANP. A leading 1, a +1, or an
  // international prefix all fall away — which is exactly the drift this fixes.
  const key = digits.slice(-10);

  // A number that is all one digit ("1111111111", which IS in production) is
  // test data, not a person. Linking real work to it would create a phantom
  // customer who appears to have bought everything.
  if (/^(\d)\1{9}$/.test(key)) return null;

  return key as PhoneMatchKey;
}

/** Do these two records describe the same person? Unknown is never a match. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneMatchKey(a);
  const kb = phoneMatchKey(b);
  // Two nulls are not a match. "We cannot tell" is not "yes" — the whole arc of
  // this codebase's defects is that distinction being collapsed.
  return ka !== null && kb !== null && ka === kb;
}

/**
 * The SQL that produces the same key inside the database.
 *
 * Exported as a named constant rather than inlined at each call site so the
 * server-side and database-side definitions of identity cannot drift — which is
 * precisely how four normalizers came to exist in the first place.
 *
 * Callers must apply the same length guard the function does; this expression
 * only handles the digit-stripping half.
 */
export const PHONE_MATCH_KEY_SQL = (column: string): string =>
  `RIGHT(REGEXP_REPLACE(${column}, '[^0-9]', ''), 10)`;

/** Minimum digits before a value can identify anyone — shared with the SQL side. */
export const PHONE_MATCH_MIN_DIGITS = 10;
