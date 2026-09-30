/**
 * todayPulse — pure derivation for the "Today, for real" card.
 *
 * The card reads three things, and only three, because those are the only ones
 * production actually carries: unclaimed declined work, calls in the last 24h,
 * and invoiced revenue over 7 days. See the `controlCenter.todayPulse` docblock
 * for the full list of what was measured and deliberately left out. Since Q-23
 * phase 3 it also shows the promise ledger's debt (`promiseDebtView` below), a
 * count of obligations rather than of shop activity.
 *
 * The judgement calls all live here so they can be tested without a database:
 * how stale the invoice mirror is, whether that staleness is worth interrupting
 * the operator over, and how to describe a call day.
 *
 * Pure + side-effect-free, like its sibling ./moneyRisks.
 */

import { type TileProvenance, metricProvenance, provenanceOf } from "@shared/tileProvenance";

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

/**
 * Q-23 · the label for a tile that shows a canonical metric, safe to call in render.
 *
 * `metricProvenance` throws on a name the contract does not carry, so a typo fails
 * the test run (ROS-003). In a production bundle the same throw would take the whole
 * card down over a label. So outside dev/test an unknown name falls back to ESTIMATE:
 * the one label that never overclaims a number as counted. Dev and test still throw,
 * which is what keeps the render test the gate for a renamed metric.
 */
function tileMetricProvenance(canonicalName: string): TileProvenance {
  try {
    return metricProvenance(canonicalName);
  } catch (err) {
    if (import.meta.env.DEV) throw err;
    return "ESTIMATE";
  }
}

/**
 * Q-23 · which of MEASURED / ESTIMATE / UNMEASURED each number on the card wears.
 *
 * Canonical names are used where the tile shows exactly that metric, so the label
 * follows METRICS-CONTRACT.md if the contract ever reclassifies it. Two tiles have
 * no exact canonical metric and state their evidence directly:
 *   - calls counts every `vapi_call_logs` row in 24h, inbound or not, so calling it
 *     "Total inbound calls" would claim a filter the SQL does not apply;
 *   - revenue is every paid invoice, the sum of the contract's "Verified attributed"
 *     and "Unmatched paid" revenue, which the contract names only separately.
 * A mirror lagging past the warn threshold makes revenue a lower bound (the card
 * already says it is understated), so it is a partial read, i.e. an ESTIMATE.
 * A mirror that has never synced an invoice supplies nothing, so the revenue
 * figure is not a lower bound of anything: it is UNMEASURED (phase 2).
 */
export function todayPulseProvenance(
  revenueMirrorStale: boolean,
  revenueNeverSynced = false,
): {
  declinedWork: TileProvenance;
  calls: TileProvenance;
  reachedTool: TileProvenance;
  abandoned: TileProvenance;
  revenue: TileProvenance;
} {
  return {
    // A sum of estimates nobody accepted: an opportunity, never money.
    declinedWork: tileMetricProvenance("Estimated recovery opportunity"),
    calls: provenanceOf("observed"),
    reachedTool: tileMetricProvenance("Tool engagements"),
    // "Hung up under 20s" is a duration heuristic for a genuine abandon.
    abandoned: tileMetricProvenance("Abandoned calls"),
    revenue: provenanceOf(
      "observed",
      revenueNeverSynced ? "unavailable" : revenueMirrorStale ? "partial" : "ok",
    ),
  };
}

/**
 * Q-23 phase 3 · the obligation-debt tile: promises the shop owes a customer.
 *
 * Three states the card must keep apart, because the whole point of the promise
 * ledger is that an obligation cannot be forgotten:
 *   - the read failed or the table is missing → UNMEASURED, and says so in words;
 *   - read, and nothing is open → a measured zero, stated, not hidden;
 *   - read, with open promises → MEASURED counts, loud when any are past due.
 * "Past due" means nobody pressed Keep by the due time. A callback made from the
 * counter phone is invisible to the system, so the words say "not marked kept"
 * rather than "missed".
 *
 * `undefined` is a server that predates this tile (a payload without the field),
 * not a failed read, so it returns null and the card draws no tile at all.
 */
export type PromiseDebtPayload =
  | { available: true; open: number; overdue: number; overdue4h: number }
  | { available: false; reason: string };

export function promiseDebtView(debt: PromiseDebtPayload | undefined): {
  provenance: TileProvenance;
  headline: string;
  detail: string | null;
  loud: boolean;
} | null {
  if (debt === undefined) return null;
  if (!debt.available) {
    return {
      provenance: provenanceOf("observed", "unavailable"),
      headline: "Promises owed: could not be read",
      detail: "Unknown, not zero. Check the Promises panel on the Today tab.",
      loud: true,
    };
  }
  const provenance = provenanceOf("observed");
  if (debt.open === 0) {
    return { provenance, headline: "0 promises owed", detail: null, loud: false };
  }
  const noun = debt.open === 1 ? "promise" : "promises";
  if (debt.overdue === 0) {
    return { provenance, headline: `${debt.open} ${noun} owed`, detail: "none past due", loud: false };
  }
  const late = debt.overdue4h > 0 ? ` · ${debt.overdue4h} by 4h or more` : "";
  return {
    provenance,
    headline: `${debt.open} ${noun} owed`,
    detail: `${debt.overdue} past due, not marked kept${late}`,
    loud: true,
  };
}
