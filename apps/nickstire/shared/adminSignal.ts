/**
 * Admin Signal — the normalized "something needs Nour" unit.
 *
 * PURE by design: no clock, no DB, no fetch. Same pattern as
 * `shared/customerDimension.ts`, `server/services/loopShapeContract.ts` and
 * `shared/metricsContract.ts`, and for the same reason — the FOLD is where the
 * bugs live, so the fold must be testable without a database.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `Admin.tsx` computed sidebar badges with a hand-written switch:
 *
 *     if (id === "overview")   return opsTotal === null ? null : counts.total + opsTotal;
 *     if (id === "instagram")  return opsTotal;
 *     if (id === "leads")      return counts.newLeads;
 *     if (id === "tireOrders") return stats?.tires?.new ?? 0;
 *     if (id === "memberships")return stats?.memberships?.warning ?? 0;
 *     return 0;                        // <-- 11 of 16 sections
 *
 * That function's own docblock says a count that could not be read "must not
 * render as zero: a failed query showing 0 is a green light the system never
 * gave" — and then returns 0 for every section nobody wired. The doctrine was
 * stated and violated in the same function.
 *
 * Two distinct silences were both rendered as `0`:
 *   1. WE COULD NOT COUNT      — the query failed. Must show as "?".
 *   2. NOTHING MEASURES THIS   — no source was ever built. Must show NOTHING.
 *
 * Collapsing (2) into `0` is worse than collapsing (1), because "0" on an
 * unwired section is a green light for a question that was never asked. The
 * operator reads "Money: 0" as "no money problems", when the truth is "this
 * badge has never been connected to anything".
 *
 * Hence three states, not a nullable number.
 *
 * ── THE `??  0` FAMILY ─────────────────────────────────────────────────────
 *
 * The same shape appears one layer down: `getAdminActionableCounts` does
 * `input.bookings ?? []`, so when the overview bundle FAILS it returns
 * `total: 0`. Admin.tsx knows the bundle failed (`overviewUnavailable`) and
 * renders a DegradedDataBanner about it — but never passed that fact to the
 * badge, so leads / tireOrders / memberships / overview all showed confident
 * zeros beside a banner saying the data was degraded. `reading()` below is the
 * one place to convert "the fetch failed" into `unknown`, so a caller cannot
 * forget again.
 */

/** Admin section ids that can own a signal. Kept as a string to avoid a client-type import in shared/. */
export type AdminSignalSection = string;

/** How loud this is. Ordered — `rank()` relies on the order. */
export const SIGNAL_SEVERITIES = ["info", "warning", "urgent"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

/**
 * A single reading.
 *
 * `counted` with `count: 0` is REAL INFORMATION — "we looked, there is nothing".
 * It is not the same as either failure state and must not be conflated with them.
 */
export type SignalReading =
  | { state: "counted"; count: number }
  /** We queried and could not get an answer. Renders as "?". */
  | { state: "unknown"; reason: string }
  /** Nothing measures this yet. Renders as NO badge — never 0, never "?". */
  | { state: "not_measured"; reason: string };

export interface AdminSignal {
  /** Stable id, e.g. "held-reels". Used for dedupe and as a React key. */
  id: string;
  /** Which admin section owns it. */
  section: AdminSignalSection;
  /** Operator-facing phrase, e.g. "held reels". Lowercase; callers compose sentences. */
  label: string;
  reading: SignalReading;
  severity: SignalSeverity;
  /** Where the number came from — a procedure path. Shown in the tooltip so a number can be traced. */
  source: string;
  /** ISO string, or null when the source does not report freshness. NEVER defaults to "now". */
  updatedAt: string | null;
  /** Optional deep link for the operator to act on it. */
  href?: string;
}

/** A folded, render-ready badge for one section. */
export type BadgeReading =
  | { state: "counted"; count: number; severity: SignalSeverity; contributors: number }
  | { state: "unknown"; reason: string }
  | { state: "not_measured" };

/**
 * Build a reading from a fetch result, so every call site converts failure the
 * same way.
 *
 * `failed` WINS over a present value on purpose: react-query keeps the last
 * successful `data` while `isError` is true on a refetch, so trusting `value`
 * would render a stale number as current — the frozen-cache class.
 */
export function reading(opts: {
  failed?: boolean;
  /** Source-reported "I could not count this" (e.g. operationsSignal.unknown). */
  unknown?: boolean;
  /** `undefined` = still loading / never fetched. */
  value: number | null | undefined;
  /** Why it is unmeasured, if it is. Required to make an unwired badge self-explaining. */
  notMeasuredReason?: string;
  sourceLabel: string;
}): SignalReading {
  if (opts.failed) return { state: "unknown", reason: `${opts.sourceLabel} could not be read` };
  if (opts.unknown) return { state: "unknown", reason: `${opts.sourceLabel} reported an unreadable count` };
  if (opts.value === null) return { state: "unknown", reason: `${opts.sourceLabel} returned no count` };
  if (opts.value === undefined) {
    return {
      state: "not_measured",
      reason: opts.notMeasuredReason ?? `${opts.sourceLabel} has not reported yet`,
    };
  }
  return { state: "counted", count: opts.value };
}

function rank(s: SignalSeverity): number {
  return SIGNAL_SEVERITIES.indexOf(s);
}

/**
 * Fold every signal for one section into a single badge.
 *
 * RULES, in order — each exists because the alternative lies:
 *  1. ANY `unknown` contributor makes the whole badge unknown. Summing the
 *     readable half and showing it as the total under-reports outstanding work,
 *     and under-reporting is the direction that gets ignored.
 *  2. All contributors `not_measured` (or none at all) => `not_measured`. No
 *     badge. This is the case the old `return 0` was faking for 11 sections.
 *  3. Otherwise sum the counted ones. `not_measured` siblings are EXCLUDED from
 *     the sum but recorded in `contributors`, so a partially-wired section still
 *     shows the part that is real.
 *
 * Severity is the max across CONTRIBUTING signals only — a signal counting 0 does
 * not get to colour the badge urgent.
 */
export function foldSignals(signals: readonly AdminSignal[]): BadgeReading {
  if (signals.length === 0) return { state: "not_measured" };

  const unknown = signals.find((s) => s.reading.state === "unknown");
  if (unknown && unknown.reading.state === "unknown") {
    return { state: "unknown", reason: unknown.reading.reason };
  }

  const counted = signals.filter(
    (s): s is AdminSignal & { reading: { state: "counted"; count: number } } =>
      s.reading.state === "counted",
  );
  if (counted.length === 0) return { state: "not_measured" };

  const count = counted.reduce((sum, s) => sum + s.reading.count, 0);
  const severity = counted
    .filter((s) => s.reading.count > 0)
    .reduce<SignalSeverity>((max, s) => (rank(s.severity) > rank(max) ? s.severity : max), "info");

  return { state: "counted", count, severity, contributors: counted.length };
}

/** Signals for one section, most severe first, then largest count. */
export function signalsForSection(
  signals: readonly AdminSignal[],
  section: AdminSignalSection,
): AdminSignal[] {
  return signals
    .filter((s) => s.section === section)
    .sort((a, b) => {
      const bySeverity = rank(b.severity) - rank(a.severity);
      if (bySeverity !== 0) return bySeverity;
      const ac = a.reading.state === "counted" ? a.reading.count : 0;
      const bc = b.reading.state === "counted" ? b.reading.count : 0;
      return bc - ac;
    });
}

/**
 * The exception feed: everything actually demanding attention, most severe first.
 *
 * `unknown` signals ARE included — "we cannot tell whether customers are waiting"
 * is itself an exception, and dropping it would recreate the silence this module
 * exists to end. Signals counting 0, and unmeasured ones, are excluded.
 */
export function exceptionFeed(signals: readonly AdminSignal[]): AdminSignal[] {
  return signals
    .filter((s) => s.reading.state === "unknown" || (s.reading.state === "counted" && s.reading.count > 0))
    .sort((a, b) => {
      // Unknown outranks counted at equal severity: an unreadable queue is worse
      // than a readable one, because its size could be anything.
      const bySeverity = rank(b.severity) - rank(a.severity);
      if (bySeverity !== 0) return bySeverity;
      const aUnknown = a.reading.state === "unknown" ? 1 : 0;
      const bUnknown = b.reading.state === "unknown" ? 1 : 0;
      if (aUnknown !== bUnknown) return bUnknown - aUnknown;
      const ac = a.reading.state === "counted" ? a.reading.count : 0;
      const bc = b.reading.state === "counted" ? b.reading.count : 0;
      return bc - ac;
    });
}

/** Tooltip text. Always names the source, so any number on screen can be traced. */
export function describeBadge(badge: BadgeReading, signals: readonly AdminSignal[]): string {
  if (badge.state === "not_measured") return "Nothing measures this section yet";
  if (badge.state === "unknown") return `Could not read outstanding work — ${badge.reason}`;
  const parts = signals
    .filter((s) => s.reading.state === "counted" && s.reading.count > 0)
    .map((s) => `${(s.reading as { count: number }).count} ${s.label} (${s.source})`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing outstanding";
}
