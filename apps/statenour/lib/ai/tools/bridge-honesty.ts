/**
 * Pure guards that stop a dead shop bridge from being reported as real numbers.
 *
 * `fetchBridge` returns null on EVERY failure — no sync key, a non-2xx, a
 * timeout, a thrown error — and the business-intel services then compute their
 * totals from empty arrays. The result is a SUCCESS-SHAPED payload of zeros
 * (`totalRevenue: "0.00"`, `jobCount: 0`) carrying a `bridgeAvailable` /
 * `bridgeHealth` marker that, until now, had no consumer anywhere in the repo.
 *
 * That matters because these payloads go to an LLM. The chat rule permits
 * "I don't have access to that data" only AFTER a tool returns null, errors,
 * or is unavailable — and a zeros payload is none of those three, so the model
 * was being directed to state the fabricated zero as fact.
 *
 * PURE ON PURPOSE. The services fan out three bridge reads concurrently inside
 * a Promise.all, which makes them genuinely awkward to drive from a test; the
 * decision of what to redact does not need any of that machinery, so it lives
 * here where it can be exercised directly.
 */

/** The shape this module needs from getDashboardSummary. */
export interface DashboardBridgeHealth {
  revenue: boolean;
  customers: boolean;
  jobsToday: boolean;
}

export interface RedactableSummary {
  bridgeHealth: DashboardBridgeHealth;
  revenue?: unknown;
  customers?: unknown;
  jobs?: unknown;
  [key: string]: unknown;
}

/**
 * Blank the sections whose bridge read failed and name them.
 *
 * PARTIAL rather than all-or-nothing: each sub-read degrades independently, so
 * a summary can legitimately carry real customers and unreadable revenue. The
 * alternative — shipping the whole object with a flag — is exactly what failed
 * before, because a real number and a fabricated one look identical once they
 * are both in the payload.
 *
 * Returns the input UNCHANGED when everything was readable, so the healthy
 * path keeps its exact shape.
 */
export function redactUnreadableSections<T extends RedactableSummary>(
  summary: T,
): T | (T & { unavailable: string[]; reason: string }) {
  const unreadable = (Object.entries(summary.bridgeHealth) as Array<[string, boolean]>)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  if (unreadable.length === 0) return summary;

  return {
    ...summary,
    revenue: summary.bridgeHealth.revenue ? summary.revenue : null,
    customers: summary.bridgeHealth.customers ? summary.customers : null,
    jobs: summary.bridgeHealth.jobsToday ? summary.jobs : null,
    unavailable: unreadable,
    reason:
      `The shop bridge did not answer for: ${unreadable.join(", ")}. ` +
      "Those are UNKNOWN, not zero — do not state figures for them.",
  };
}

/** What the revenue tool returns instead of a fabricated zero month. */
export function revenueUnavailable(period: string) {
  return {
    unavailable: true as const,
    reason:
      "The nickstire shop bridge did not answer, so revenue could not be read. " +
      "This is UNKNOWN, not a zero-revenue period — do not state a figure.",
    period,
  };
}
