/**
 * "Neglected" — one definition, three consumers (2026-09-16, W8).
 *
 * WHY THIS FILE EXISTS. The predicate was written out by hand three times
 * (`lib/brain/people-intelligence.ts` twice, `app/api/people/route.ts` once)
 * and the three copies had already drifted at the boundary: the brain copies
 * compared a Date against `daysAgo(14)`, the route compared a day count
 * ROUNDED to the nearest integer against `> 14`, so a person 14.4 days quiet
 * was neglected in one surface and not in the other.
 *
 * THE THRESHOLD WAS ALSO MIS-SCALED, which is the defect that brought this
 * here. All three copies required `interactionCount >= 3` — "only alert for
 * people we interact with regularly". That was authored while the counter was
 * inflated: before the 2026-09-16 reconcile `interactionCount` ran to 69,
 * because a chat message that merely NAMED someone bumped it. With honest
 * counters (measured on prod the same day):
 *
 *   20 live profiles · 7 have ever been logged · max count 4 · `>= 3` matches 2
 *
 * So the filter silently dropped 5 of the 7 real candidates, and it dropped
 * exactly the wrong ones: a person logged ONCE and then untouched for months
 * is the clearest neglect case there is, and `>= 3` made them invisible. A
 * threshold the data cannot reach is a dead rule; a threshold the data can
 * barely reach is a rule that fires on the wrong rows.
 *
 * The repair keeps the concept and makes it reachable. The ledger counts only
 * DELIBERATELY LOGGED contact, so it undercounts real life and can never
 * support a "how regularly" judgment. What one logged contact DOES establish
 * is that the relationship exists in the record — and a relationship that
 * exists in the record and has gone quiet is precisely what "neglected"
 * means. Hence `>= 1`: existence, not frequency.
 *
 * Positive control: with `MIN_LOGGED_CONTACTS` restored to 3, the "one logged
 * contact is enough" test in tests/services/people-neglect.test.ts goes red.
 */

/** Days of silence after which a logged relationship reads as neglected. */
export const NEGLECT_AFTER_DAYS = 14;

/**
 * Logged contacts required before silence can be called neglect. ONE: enough
 * to prove the relationship exists in the ledger, which is all this counter
 * can honestly prove (see the header). Never raise this without re-measuring
 * the live distribution — on 2026-09-16 raising it to 3 cost 5 of 7 rows.
 */
export const MIN_LOGGED_CONTACTS = 1;

export interface NeglectInput {
  interactionCount: number;
  lastInteraction: Date | string | null;
}

/** Whole days since `lastInteraction`, or null when the person was never logged. */
export function daysSinceContact(row: NeglectInput, now: Date = new Date()): number | null {
  if (!row.lastInteraction) return null;
  const then = row.lastInteraction instanceof Date ? row.lastInteraction : new Date(row.lastInteraction);
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor((now.getTime() - ms) / 86_400_000);
}

/**
 * A relationship the ledger knows about that has gone quiet for
 * `NEGLECT_AFTER_DAYS` or more.
 *
 * Never-logged people are NOT neglected: with no contact on record there is
 * no relationship to have neglected, and 13 of the 20 live profiles are in
 * that state. That silence is an honest "nothing to say", not a finding.
 */
export function isNeglected(row: NeglectInput, now: Date = new Date()): boolean {
  if (row.interactionCount < MIN_LOGGED_CONTACTS) return false;
  const days = daysSinceContact(row, now);
  return days !== null && days >= NEGLECT_AFTER_DAYS;
}
