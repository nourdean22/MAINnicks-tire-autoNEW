/**
 * The data-accuracy-check details string in plain words, each finding with the population it came from, and the
 * probe codes after " · probes: " (middle dot U+00B7). The Settings tab shows the text before that separator.
 * The queries stay in scheduler.ts; this only words their results.
 */
export interface DataAccuracyInput {
  /** Invoices in the last 7 days with no customer phone. */
  recentMissing: number;
  /** All invoices in the last 7 days: the population recentMissing is a part of. */
  total7d: number;
  /** Web leads still `new` after 7+ days. */
  staleLeads: number;
  /** Callbacks still `new` after 24+ hours. */
  staleCallbacks: number;
  freshness: { state: "fresh" | "warn" | "error" | "unmeasured"; reason: string };
  volumes: ReadonlyArray<{
    label: string;
    state: "normal" | "warn" | "error" | "unmeasured";
    current: number | null;
    expectedMean: number | null;
    zScore: number | null;
  }>;
  contractDetails: string;
}

/** A handful of untouched leads is normal for a shop that takes most work by phone; the old alarm used > 3. */
const STALE_LEADS_ALERT_FROM = 4;

const roundedExpected = (mean: number): string => (mean >= 10 ? String(Math.round(mean)) : mean.toFixed(1));

export function describeDataAccuracy(input: DataAccuracyInput): { issues: string[]; details: string } {
  const { recentMissing, total7d } = input;
  // A count that did not come back as a number is a failed read; "clean" over it would be a fabricated all-clear.
  if (!Number.isFinite(recentMissing) || !Number.isFinite(total7d) || recentMissing < 0 || recentMissing > total7d) {
    throw new Error(`data-accuracy-check: invoice counts unreadable (missing=${recentMissing}, total=${total7d})`);
  }
  if (!Number.isFinite(input.staleLeads) || !Number.isFinite(input.staleCallbacks)) {
    throw new Error(`data-accuracy-check: lead or callback counts unreadable (leads=${input.staleLeads}, callbacks=${input.staleCallbacks})`);
  }

  const issues: string[] = [];
  if (recentMissing > 0) {
    issues.push(
      `${recentMissing} of ${total7d} invoices in the last 7 days have no customer phone (cannot be texted; the import or the phone backfill may be broken)`,
    );
  }
  if (input.staleLeads >= STALE_LEADS_ALERT_FROM) issues.push(`${input.staleLeads} web leads untouched for 7+ days`);
  if (input.staleCallbacks > 0) issues.push(`${input.staleCallbacks} callbacks unanswered for 24+ hours`);
  if (input.freshness.state === "warn" || input.freshness.state === "error") {
    issues.push(`invoice mirror freshness ${input.freshness.state}: ${input.freshness.reason}`);
  }
  for (const v of input.volumes) {
    if ((v.state === "warn" || v.state === "error") && v.current !== null && v.expectedMean !== null) {
      const direction = v.current < v.expectedMean ? "low" : "high";
      issues.push(`weekday ${v.label} volume ${direction}: ${v.current} today, about ${roundedExpected(v.expectedMean)} expected`);
    }
  }

  if (issues.length > 0) return { issues, details: `${issues.join("; ")} · probes: ${input.contractDetails}` };

  const phonePart =
    total7d === 0
      ? "0 invoices in the last 7 days to check for a phone"
      : `${total7d} invoices in the last 7 days all carry a phone`;
  const leadPart =
    input.staleLeads === 0
      ? "no web lead untouched 7+ days"
      : `${input.staleLeads} web leads untouched 7+ days (fewer than ${STALE_LEADS_ALERT_FROM}, not flagged)`;
  return { issues, details: `All checks clean: ${phonePart}; ${leadPart} · probes: ${input.contractDetails}` };
}
