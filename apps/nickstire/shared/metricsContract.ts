/**
 * METRICS CONTRACT — the measurement rules, as code.
 *
 * THE PROBLEM IT SOLVES
 * `docs/METRICS-CONTRACT.md` is a genuinely rigorous document. It names 27
 * canonical metrics, assigns each an evidence level, states which are safe for
 * ROI reporting, and closes with ten "data quality requirements" that every
 * executive metric response "should expose". All of it is prose. Nothing reads
 * it. So the rules it states are only as good as whoever last remembered them —
 * and the issue registry is a list of what happens when someone doesn't:
 *
 *   ROS-001  detail-row sums reported as headline totals
 *   ROS-002  straight-averaged CTR and position
 *   ROS-003  tool engagement labelled a conversion
 *   ROS-007  modeled pipeline value resembling recovered revenue
 *   ROS-008  technical failures dropped from the quality denominator
 *   ROS-041  100% approval rate rendered from a zero denominator
 *
 * Every one of those is the contract being violated by code that had never been
 * shown the contract. This module is the contract in a form code can be shown.
 *
 * WHAT IT IS NOT
 * It does not query anything. It carries the vocabulary (`CANONICAL_METRICS`),
 * the envelope every metric response should travel in (`MetricEnvelope`), and
 * the two rules the document states as absolute:
 *
 *   - no percentage may be shown without its denominator;
 *   - no modeled value may be labeled verified revenue.
 *
 * `metricsContractParity.test.ts` fails the build if the markdown names a
 * canonical metric this registry does not carry, so the document and the code
 * cannot drift the way the brand voice did.
 */

/** Contract §"Evidence levels", plus `modeled` from §"Revenue concepts". */
export type EvidenceLevel =
  /** Deterministic source event or persisted row. */
  | "observed"
  /** Classifier or matching logic derived from observed evidence. */
  | "inferred"
  /** Direct business-system evidence confirms the outcome. */
  | "verified"
  /** Opportunities multiplied by disclosed assumptions. Never ROI-safe. */
  | "modeled";

/** Whether a metric may appear in executive reporting or ROI math. */
export type ReportingUse =
  | "executive-and-roi"
  | "executive-only"
  | "executive-with-label"
  | "diagnostic-only"
  | "planning-only";

export interface CanonicalMetric {
  /** The exact name used in METRICS-CONTRACT.md. Never rename in isolation. */
  name: string;
  section: "voice-demand" | "rates" | "revenue" | "gsc";
  definition: string;
  evidence: EvidenceLevel;
  use: ReportingUse;
  /** For rates: what the denominator must be. The contract is explicit. */
  denominator?: string;
  /** Limitations the contract requires be disclosed alongside the number. */
  limitations?: readonly string[];
}

/**
 * The canonical vocabulary. A metric surfaced to an operator should name one of
 * these; inventing a synonym is how "tool engagement" became "conversions".
 */
export const CANONICAL_METRICS: readonly CanonicalMetric[] = Object.freeze([
  // ─── Voice and demand ────────────────────────────────────────────────────
  {
    name: "Total inbound calls",
    section: "voice-demand",
    definition: "Unique inbound VAPI calls received in the window",
    evidence: "observed",
    use: "executive-only",
  },
  {
    name: "Qualified service inquiries",
    section: "voice-demand",
    definition: "Inbound customer conversations with a detected service or pricing intent",
    evidence: "inferred",
    use: "executive-with-label",
    limitations: ["Requires classifier version alongside the number"],
  },
  {
    name: "Tool engagements",
    section: "voice-demand",
    definition: "Calls where a tracked voice tool was invoked",
    evidence: "observed",
    use: "diagnostic-only",
    limitations: ["A tool engagement is not a lead, booking, arrival or paid job (ROS-003/004)"],
  },
  {
    name: "Leads created",
    section: "voice-demand",
    definition: "Calls linked to an actual `leads` row",
    evidence: "verified",
    use: "executive-only",
    limitations: ["Excludes tool-only activity"],
  },
  {
    name: "Callbacks created",
    section: "voice-demand",
    definition: "Calls linked to an actual `callback_requests` row",
    evidence: "verified",
    use: "executive-only",
  },
  {
    name: "Bookings created",
    section: "voice-demand",
    definition: "Calls linked to an actual `bookings` row",
    evidence: "verified",
    use: "executive-only",
    limitations: ["`bookSlot` walk-in guidance without a booking row does not count (ROS-014)"],
  },
  {
    name: "Walk-ins directed",
    section: "voice-demand",
    definition: "Calls where the customer was instructed to visit or drop off",
    evidence: "inferred",
    use: "executive-with-label",
    limitations: ["Does not imply arrival"],
  },
  {
    name: "Transfer attempts",
    section: "voice-demand",
    definition: "Calls where transfer execution was initiated",
    evidence: "observed",
    use: "diagnostic-only",
    limitations: ["Does not imply a human answered"],
  },
  {
    name: "Transfer connections",
    section: "voice-demand",
    definition: "Transfer attempts with a direct human-answer signal",
    evidence: "verified",
    use: "executive-only",
  },
  {
    name: "Likely transfer connections",
    section: "voice-demand",
    definition: "Duration-based estimate among transfer attempts",
    evidence: "inferred",
    use: "diagnostic-only",
    limitations: ["Must be labelled inferred", "Withheld below the reliability threshold"],
  },
  {
    name: "Arrivals verified",
    section: "voice-demand",
    definition: "Customer arrival or check-in linked to the originating demand record",
    evidence: "verified",
    use: "executive-and-roi",
    limitations: ["Directions alone are excluded"],
  },
  {
    name: "Paid call conversions",
    section: "voice-demand",
    definition: "Paid invoices defensibly linked to an originating call",
    evidence: "verified",
    use: "executive-and-roi",
    limitations: ["A weak phone/time match remains inferred and is reported separately"],
  },
  {
    name: "Technical failures",
    section: "voice-demand",
    definition: "Calls classified as provider, audio, webhook or assistant failure",
    evidence: "observed",
    use: "executive-only",
    limitations: ["Never removed from the reliability denominator (ROS-008)"],
  },
  {
    name: "Abandoned calls",
    section: "voice-demand",
    definition: "Genuine customer calls ending before useful connection",
    evidence: "inferred",
    use: "executive-only",
    limitations: ["Spam and sub-2-second misdials excluded"],
  },

  // ─── Rates ───────────────────────────────────────────────────────────────
  {
    name: "Qualified-call to lead rate",
    section: "rates",
    definition: "Calls with verified lead creation over qualified service inquiries",
    evidence: "verified",
    use: "executive-only",
    denominator: "Qualified service inquiries",
    limitations: ["Never use all calls as the denominator"],
  },
  {
    name: "Qualified-call to booking rate",
    section: "rates",
    definition: "Calls with verified booking creation over qualified service inquiries",
    evidence: "verified",
    use: "executive-only",
    denominator: "Qualified service inquiries",
    limitations: ["A callback or walk-in direction is not a booking"],
  },
  {
    name: "Paid conversion rate",
    section: "rates",
    definition: "Qualified calls linked to a paid invoice over qualified service inquiries",
    evidence: "verified",
    use: "executive-and-roi",
    denominator: "Qualified service inquiries",
    limitations: ["Not available until matching is verified"],
  },
  {
    name: "Technical-failure rate",
    section: "rates",
    definition: "Technical failures over all inbound calls",
    evidence: "observed",
    use: "executive-only",
    denominator: "Total inbound calls",
  },
  {
    name: "Abandonment rate",
    section: "rates",
    definition: "Genuine abandons over all inbound calls",
    evidence: "inferred",
    use: "executive-only",
    denominator: "Total inbound calls",
  },
  {
    name: "Transfer-connection rate",
    section: "rates",
    definition: "Verified connections over transfer attempts",
    evidence: "verified",
    use: "executive-only",
    denominator: "Transfer attempts",
    limitations: ["A duration proxy must be labelled inferred"],
  },
  {
    name: "Recovery rate",
    section: "rates",
    definition: "Previously lost opportunities later verified won, over eligible lost opportunities",
    evidence: "verified",
    use: "executive-only",
    denominator: "Eligible lost opportunities",
    limitations: ["Requires durable queue outcome evidence"],
  },

  // ─── Revenue ─────────────────────────────────────────────────────────────
  {
    // The north star. The only revenue concept the contract marks ROI-safe.
    name: "Verified attributed revenue",
    section: "revenue",
    definition: "Paid invoice linked to a source through direct IDs or an operator-confirmed match",
    evidence: "verified",
    use: "executive-and-roi",
  },
  {
    name: "Modeled pipeline value",
    section: "revenue",
    definition:
      "Observed or inferred opportunities multiplied by disclosed ticket and close-rate assumptions",
    evidence: "modeled",
    use: "planning-only",
    limitations: ["Never label as revenue (ROS-007)", "Assumptions must be disclosed inline"],
  },
  {
    name: "Potential pipeline value",
    section: "revenue",
    definition: "Sum of quoted or estimated work not yet paid",
    evidence: "observed",
    use: "planning-only",
  },
  {
    name: "Unmatched paid revenue",
    section: "revenue",
    definition: "Paid invoices without a canonical source link",
    evidence: "verified",
    use: "executive-only",
    limitations: ["Verified revenue, unknown attribution — valid for totals, never for channel ROI"],
  },
  {
    name: "Estimated recovery opportunity",
    section: "revenue",
    definition: "Open lost or declined work with an estimate or bounded value assumption",
    evidence: "modeled",
    use: "planning-only",
  },

  // ─── GSC ─────────────────────────────────────────────────────────────────
  {
    name: "Official GSC clicks",
    section: "gsc",
    definition: "No-dimension Search Analytics clicks for the window",
    evidence: "observed",
    use: "executive-only",
  },
  {
    name: "Official GSC impressions",
    section: "gsc",
    definition: "No-dimension Search Analytics impressions",
    evidence: "observed",
    use: "executive-only",
  },
  {
    name: "Official GSC CTR",
    section: "gsc",
    definition: "Official clicks divided by official impressions",
    evidence: "observed",
    use: "executive-only",
    denominator: "Official GSC impressions",
    limitations: ["Aggregate — never an average of detail rows (ROS-002)"],
  },
  {
    name: "Official GSC average position",
    section: "gsc",
    definition: "No-dimension GSC position",
    evidence: "observed",
    use: "executive-with-label",
    limitations: ["Not a universal rank tracker", "Weight by impressions, never straight-average"],
  },
  {
    name: "Stored detailed clicks/impressions",
    section: "gsc",
    definition: "Sum of persisted query/page/date/device/country rows",
    evidence: "observed",
    use: "diagnostic-only",
    limitations: ["Bounded detail, potentially incomplete — never a headline total (ROS-001)"],
  },
  {
    name: "Detailed-row coverage",
    section: "gsc",
    definition: "Stored detail divided by the official aggregate",
    evidence: "observed",
    use: "diagnostic-only",
    denominator: "Official GSC clicks or impressions",
    limitations: ["An operational diagnostic, not a completeness proof"],
  },
  {
    name: "Detailed row count",
    section: "gsc",
    definition: "Persisted rows in the window",
    evidence: "observed",
    use: "diagnostic-only",
    limitations: ["Affected by dimensions, row limit and dedupe"],
  },
]);

const BY_NAME = new Map(CANONICAL_METRICS.map((m) => [m.name.toLowerCase(), m]));

export function getCanonicalMetric(name: string): CanonicalMetric | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** ROI-safety, straight from §"Revenue concepts". */
export function isRoiSafe(name: string): boolean {
  return getCanonicalMetric(name)?.use === "executive-and-roi";
}

// ─── The envelope ───────────────────────────────────────────────────────────

/**
 * Whether the value can be trusted. `unavailable` is NOT zero and NOT empty —
 * that distinction is the entire ROS-036/037/049 class ("a failed read rendered
 * as the happiest state"). A caller must be able to render "—" rather than "$0".
 */
export type MetricState = "ok" | "partial" | "unavailable";

/**
 * Every field METRICS-CONTRACT.md §"Data quality requirements" says an
 * executive metric response should expose. Required rather than optional on
 * purpose: an omitted denominator is how a zero-denominator rate reported 100%.
 */
export interface MetricEnvelope<T = number> {
  /** Must be a name from CANONICAL_METRICS. */
  canonicalMetric: string;
  /** `null` when unavailable. Never coerce a failed read to 0 or []. */
  value: T | null;
  state: MetricState;
  window: { from: string; to: string; timeZone: string };
  source: string;
  evidence: EvidenceLevel;
  /** Definition or classifier version, e.g. "classifier-v2". */
  version: string;
  numerator?: number | null;
  denominator?: number | null;
  lastAttemptedAt: string;
  lastSuccessfulAt: string | null;
  dataAsOf: string | null;
  limitations: readonly string[];
}

export const SHOP_TIME_ZONE = "America/New_York";

export interface BuildEnvelopeInput<T> {
  metric: string;
  value: T | null;
  window: { from: string; to: string; timeZone?: string };
  source: string;
  version: string;
  now: string;
  state?: MetricState;
  numerator?: number | null;
  denominator?: number | null;
  lastSuccessfulAt?: string | null;
  dataAsOf?: string | null;
  extraLimitations?: readonly string[];
}

/**
 * Build a contract-compliant response.
 *
 * Deliberately takes `now` rather than reading the clock: a metric response is
 * data, and a function that stamps itself is untestable and non-deterministic.
 */
export function buildEnvelope<T>(input: BuildEnvelopeInput<T>): MetricEnvelope<T> {
  const canonical = getCanonicalMetric(input.metric);
  if (!canonical) {
    throw new Error(
      `[metrics-contract] "${input.metric}" is not a canonical metric. Add it to ` +
        `CANONICAL_METRICS and METRICS-CONTRACT.md, or use the canonical name. ` +
        `Inventing a synonym is how "tool engagement" became "conversions" (ROS-003).`,
    );
  }

  const state: MetricState = input.state ?? (input.value === null ? "unavailable" : "ok");

  return {
    canonicalMetric: canonical.name,
    value: input.value,
    state,
    window: {
      from: input.window.from,
      to: input.window.to,
      timeZone: input.window.timeZone ?? SHOP_TIME_ZONE,
    },
    source: input.source,
    evidence: canonical.evidence,
    version: input.version,
    numerator: input.numerator ?? null,
    denominator: input.denominator ?? null,
    lastAttemptedAt: input.now,
    lastSuccessfulAt: input.lastSuccessfulAt ?? (state === "ok" ? input.now : null),
    dataAsOf: input.dataAsOf ?? (state === "ok" ? input.now : null),
    limitations: [...(canonical.limitations ?? []), ...(input.extraLimitations ?? [])],
  };
}

export interface ContractViolation {
  rule: string;
  detail: string;
}

/**
 * Check an envelope against the two absolute rules in the contract header, plus
 * the honesty rules the issue registry was written in blood for.
 *
 * Returns violations rather than throwing so a caller can log-and-degrade on a
 * reporting surface instead of taking a dashboard down.
 */
export function validateEnvelope(env: MetricEnvelope<unknown>): ContractViolation[] {
  const out: ContractViolation[] = [];
  const canonical = getCanonicalMetric(env.canonicalMetric);

  if (!canonical) {
    out.push({
      rule: "canonical-name",
      detail: `"${env.canonicalMetric}" is not in CANONICAL_METRICS`,
    });
    return out;
  }

  // "no percentage may be shown without its denominator"
  const isRate = canonical.section === "rates" || canonical.name === "Official GSC CTR";
  if (isRate && env.value !== null) {
    if (env.denominator === null || env.denominator === undefined) {
      out.push({
        rule: "denominator-required",
        detail: `${canonical.name} is a rate and must travel with its denominator (${canonical.denominator ?? "see contract"})`,
      });
    } else if (env.denominator === 0) {
      // ROS-041: a zero denominator rendered 100% approval and painted a quiet
      // day as flawless. A rate over zero is unavailable, not perfect.
      out.push({
        rule: "zero-denominator",
        detail: `${canonical.name} has a zero denominator — the value must be null and the state unavailable, not a number`,
      });
    }
  }

  // "no modeled value may be labeled verified revenue"
  if (canonical.evidence === "modeled" && env.evidence === "verified") {
    out.push({
      rule: "modeled-not-verified",
      detail: `${canonical.name} is modeled and can never be reported as verified (ROS-007)`,
    });
  }

  if (env.evidence !== canonical.evidence) {
    out.push({
      rule: "evidence-mismatch",
      detail: `${canonical.name} is ${canonical.evidence} in the contract but the envelope claims ${env.evidence}`,
    });
  }

  // A failed read must not present as a real zero.
  if (env.state === "unavailable" && env.value !== null) {
    out.push({
      rule: "unavailable-must-be-null",
      detail: `${canonical.name} is unavailable but carries a value — render "—", never 0 (ROS-036/037/049)`,
    });
  }

  if (env.state === "ok" && env.value === null) {
    out.push({
      rule: "ok-must-have-value",
      detail: `${canonical.name} claims state "ok" with a null value`,
    });
  }

  return out;
}
