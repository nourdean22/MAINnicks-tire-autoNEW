/**
 * todayPulse — pure derivation for the "Today, for real" card.
 *
 * The card reads three things, and only three, because those are the only ones
 * production actually carries: unclaimed declined work, calls in the last 24h,
 * and invoiced revenue over 7 days. See the `controlCenter.todayPulse` docblock
 * for the full list of what was measured and deliberately left out.
 *
 * The judgement calls all live here so they can be tested without a database:
 * how stale the invoice mirror is, whether that staleness is worth interrupting
 * the operator over, and how to describe a call day.
 *
 * Pure + side-effect-free, like its sibling ./moneyRisks.
 */

/** The mirror normally runs a day behind. Beyond this, the number is suspect. */
export const MIRROR_STALE_WARN_DAYS = 3;

/**
 * Whole days between the newest invoice and now.
 *
 * Returns null when there is no date at all rather than 0 — "no invoices have
 * ever synced" and "an invoice synced today" are opposite conditions, and 0
 * would render the broken one as the healthy one.
 */
export function mirrorLagDays(throughDate: Date | null, now: Date): number | null {
  if (!throughDate) return null;
  const ms = now.getTime() - throughDate.getTime();
  if (ms < 0) return 0;  // clock skew — never report a negative age
  return Math.floor(ms / 86_400_000);
}

/**
 * How to describe the mirror's freshness, and whether to make it loud.
 *
 * A one-day lag is NORMAL here and must stay quiet, or the operator learns to
 * ignore the banner and misses the day it means something.
 */
export function mirrorFreshness(
  throughDate: Date | null,
  now: Date,
): { label: string; stale: boolean } {
  const lag = mirrorLagDays(throughDate, now);
  if (lag === null) return { label: "no invoices synced", stale: true };
  if (lag === 0) return { label: "current", stale: false };
  if (lag === 1) return { label: "through yesterday", stale: false };
  return { label: `${lag} days behind`, stale: lag > MIRROR_STALE_WARN_DAYS };
}

/**
 * Share of calls that ended before the assistant could do anything.
 *
 * Returns null on a zero-call window instead of 0 — an overnight hour with no
 * calls is not a 0% abandon rate, and showing one invents a measurement.
 */
export function abandonRate(calls: { last24h: number; abandoned24h: number }): number | null {
  if (calls.last24h <= 0) return null;
  return Math.round((calls.abandoned24h / calls.last24h) * 100);
}
