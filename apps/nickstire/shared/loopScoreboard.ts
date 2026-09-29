/**
 * What each outbound loop is associated with, in dollars.
 *
 * WHY THIS EXISTS
 * The shop runs nine outbound SMS loops — retention_d7 through d365, declined
 * work at 3/7/14/30/45 days, cross_sell — and they all work. cron_log shows zero
 * money-loop failures in seven days. What none of them could report is whether
 * they MAKE ANYTHING. Every existing surface counts sends, replies and opt-outs;
 * `smsPerformance.summary30d` returns sent/replied/converted/optedOut and no
 * money at all.
 *
 * That is the difference between an activity generator and a money system, and
 * it is why "we sent 575 cross-sell texts" felt like progress while nobody could
 * say what it earned.
 *
 * It is only measurable now because #938 repaired the phone identity join —
 * before that, sms_conversations.phone (varied formats) could not be matched to
 * customers.phone (bare 10-digit) and every one of these numbers would have been
 * zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS CORRELATION. IT IS NOT ATTRIBUTION. READ THIS BEFORE QUOTING A NUMBER.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Revenue observed after" means: this customer received this text, and then paid
 * an invoice within the window. It does NOT mean the text caused the visit.
 *
 * Most of these customers would have come back anyway. A shop with 1,945
 * customers and 2,830 paid invoices has a substantial natural return rate, and
 * this measure cannot separate that from lift. Quoting the total as "revenue the
 * SMS system produced" would overstate it, probably by a lot.
 *
 * What it IS good for: COMPARING loops against each other. Every loop is measured
 * the same way over the same window, so the relative ordering is informative even
 * though the absolute figures are inflated.
 *
 * BUT ONLY IF THE DENOMINATOR IS HONEST — and the first version's was not.
 * It counted every row the loop created, including ones that never left the
 * building. The original docblock used "575 sends produced 2 invoices vs 72
 * produced 12" as the worked example of real signal. Measured on 2026-07-20,
 * 301 of those 575 had status='failed', and cross_sell had not sent a single
 * message since May — the cron runs and reports completed, but its predictor
 * never clears the ≥50% confidence gate. So that comparison was ranking a
 * two-month-dormant loop on stale, half-undelivered data and calling it copy
 * performance. `sent` now excludes failures and `failed` is surfaced beside it.
 *
 * A loop that sends nothing at all is invisible here BY CONSTRUCTION — it has no
 * rows to aggregate. Absence from this board is not a pass; check cron_log.
 *
 * True lift requires a holdout. Q-21 now provides a durable, default-OFF
 * no-contact assignment spine for explicit proactive lanes; cross-sell and
 * declined-work keep their independent experiment designs. Where a row has
 * matured treatment + control cohorts, this board can show incremental gross
 * revenue separately from the correlation fields. Net P&L stays unmeasured
 * until real provider/carrier cost is persisted.
 */

export type HoldoutMeasurementStatus =
  | "UNMEASURED"
  | "COLLECTING"
  | "OBSERVED_HOLDOUT";

export interface HoldoutObservationInput {
  experimentId: string;
  treatmentAssigned: number;
  controlAssigned: number;
  /** Cohorts old enough to have a complete attribution window. */
  treatmentMatured: number;
  controlMatured: number;
  treatmentPaidInvoices: number;
  controlPaidInvoices: number;
  treatmentRevenueCents: number;
  controlRevenueCents: number;
}

export interface HoldoutLift {
  status: HoldoutMeasurementStatus;
  experimentId: string | null;
  treatmentAssigned: number;
  controlAssigned: number;
  treatmentMatured: number;
  controlMatured: number;
  treatmentPaidInvoices: number;
  controlPaidInvoices: number;
  treatmentRevenueCents: number;
  controlRevenueCents: number;
  treatmentRevenuePerAssignedCents: number | null;
  controlRevenuePerAssignedCents: number | null;
  incrementalGrossRevenuePerTreatmentCents: number | null;
  incrementalGrossRevenueCents: number | null;
  /**
   * Net profit is intentionally unavailable until real provider/carrier cost is
   * persisted. Gross lift must never be silently relabeled as P&L.
   */
  netValueCents: null;
  netValueStatus: "UNMEASURED_PROVIDER_COST";
}

/**
 * Minimum MATURED assignments per arm before a lift is shown. Below it the lane
 * reads COLLECTING. One matured control customer who happened to pay (or not)
 * would otherwise print a confident red or green dollar figure that is pure noise.
 */
export const HOLDOUT_MIN_MATURED_PER_ARM = 30;

/**
 * Pure holdout math. Revenue rates use only MATURED assignments so a customer
 * assigned yesterday is not compared with one that already had the full
 * attribution window to return.
 */
export function buildHoldoutLift(
  input?: HoldoutObservationInput | null,
): HoldoutLift {
  const empty: HoldoutLift = {
    status: "UNMEASURED",
    experimentId: input?.experimentId ?? null,
    treatmentAssigned: input?.treatmentAssigned ?? 0,
    controlAssigned: input?.controlAssigned ?? 0,
    treatmentMatured: input?.treatmentMatured ?? 0,
    controlMatured: input?.controlMatured ?? 0,
    treatmentPaidInvoices: input?.treatmentPaidInvoices ?? 0,
    controlPaidInvoices: input?.controlPaidInvoices ?? 0,
    treatmentRevenueCents: input?.treatmentRevenueCents ?? 0,
    controlRevenueCents: input?.controlRevenueCents ?? 0,
    treatmentRevenuePerAssignedCents: null,
    controlRevenuePerAssignedCents: null,
    incrementalGrossRevenuePerTreatmentCents: null,
    incrementalGrossRevenueCents: null,
    netValueCents: null,
    netValueStatus: "UNMEASURED_PROVIDER_COST",
  };
  if (!input || (input.treatmentAssigned + input.controlAssigned) === 0) return empty;

  if (
    input.treatmentMatured < HOLDOUT_MIN_MATURED_PER_ARM ||
    input.controlMatured < HOLDOUT_MIN_MATURED_PER_ARM
  ) {
    return { ...empty, status: "COLLECTING" };
  }

  const treatmentRate = input.treatmentRevenueCents / input.treatmentMatured;
  const controlRate = input.controlRevenueCents / input.controlMatured;
  const incrementalPerTreatment = treatmentRate - controlRate;

  return {
    ...empty,
    status: "OBSERVED_HOLDOUT",
    treatmentRevenuePerAssignedCents: Math.round(treatmentRate),
    controlRevenuePerAssignedCents: Math.round(controlRate),
    incrementalGrossRevenuePerTreatmentCents: Math.round(incrementalPerTreatment),
    incrementalGrossRevenueCents: Math.round(
      incrementalPerTreatment * input.treatmentMatured,
    ),
  };
}

/** One outbound loop, measured identically to every other. */
export interface LoopRow {
  /** variantKey from sms_messages — the loop's own name for itself. */
  loop: string;
  /**
   * Rows the loop CREATED, including ones that never left the building.
   * Shown so a delivery problem cannot hide inside a performance number.
   */
  attempted: number;
  /**
   * Rows with `status IN ('sent','delivered')` — actually handed to a carrier.
   * THIS is the denominator for every rate, not `attempted`.
   *
   * Measured 2026-07-20: cross_sell had 575 attempted and 301 FAILED (52.3%)
   * inside the 180-day window, while every other loop sat at 0-6%. Ranking on
   * `attempted` therefore ranked DELIVERABILITY and called it effectiveness —
   * it reported "575 sends produced 2 invoices" when 301 of those sends never
   * went out.
   *
   * An ALLOWLIST of delivered states, not `<> 'failed'`. The first version of
   * this fix excluded only 'failed' and still counted 135 rows parked in
   * 'sending' — none of which carry a twilioSid, so not one was ever handed to
   * Twilio. Those are #962's permanently-stuck rehydration rows: a restart
   * moved them queued -> sending and lost them, one-way, and rehydration only
   * ever re-reads 'queued'. A denylist has to predict every bad state; an
   * allowlist only has to name the good ones.
   */
  sent: number;
  /**
   * attempted - sent. Everything that never made it out, whatever the reason —
   * failed, stuck in 'sending', still queued.
   *
   * NOT named `failed`: it counts states that are not failures. Shipping a
   * field whose name overstates what it holds is the same defect as
   * `convertedToLead` (set on tool contact, read as "a lead exists") and
   * `smsCampaignSent` (tri-state, read as boolean).
   */
  undelivered: number;
  replied: number;
  optedOut: number;
  /** Paid invoices from recipients inside the window. Correlation. */
  paidInvoicesAfter: number;
  revenueObservedCents: number;
  /** Randomized no-contact lift when the lane has a durable matured cohort. */
  holdout?: HoldoutLift;
}

export interface LoopScoreboard {
  windowDays: number;
  attributionWindowDays: number;
  loops: LoopRow[];
  totals: {
    attempted: number;
    sent: number;
    undelivered: number;
    replied: number;
    optedOut: number;
    paidInvoicesAfter: number;
    revenueObservedCents: number;
  };
  causalMeasurement: {
    observedHoldoutLanes: number;
    collectingLanes: number;
    unmeasuredLanes: number;
    providerCostMeasured: false;
  };
  /** Stated, never implied. A number without its limits invites over-reading. */
  limitations: string[];
}

/**
 * Rank and total the rows. Pure — rows in, scoreboard out — so the arithmetic is
 * testable and the same rows always produce the same answer.
 *
 * Sorted by revenue because that is the question being asked. Loops with zero
 * revenue are KEPT, not filtered: a loop that sent 575 messages and earned
 * nothing is the single most useful row on the board.
 */
export function buildLoopScoreboard(
  rows: readonly LoopRow[],
  opts: { windowDays: number; attributionWindowDays: number },
): LoopScoreboard {
  const loops = [...rows].sort((a, b) => b.revenueObservedCents - a.revenueObservedCents);

  const totals = loops.reduce(
    (acc, r) => ({
      attempted: acc.attempted + r.attempted,
      sent: acc.sent + r.sent,
      undelivered: acc.undelivered + r.undelivered,
      replied: acc.replied + r.replied,
      optedOut: acc.optedOut + r.optedOut,
      paidInvoicesAfter: acc.paidInvoicesAfter + r.paidInvoicesAfter,
      revenueObservedCents: acc.revenueObservedCents + r.revenueObservedCents,
    }),
    { attempted: 0, sent: 0, undelivered: 0, replied: 0, optedOut: 0, paidInvoicesAfter: 0, revenueObservedCents: 0 },
  );

  const causalMeasurement = loops.reduce(
    (acc, row) => {
      const status = row.holdout?.status ?? "UNMEASURED";
      if (status === "OBSERVED_HOLDOUT") acc.observedHoldoutLanes++;
      else if (status === "COLLECTING") acc.collectingLanes++;
      else acc.unmeasuredLanes++;
      return acc;
    },
    {
      observedHoldoutLanes: 0,
      collectingLanes: 0,
      unmeasuredLanes: 0,
      providerCostMeasured: false as const,
    },
  );

  const limitations = [
    "CORRELATION, NOT ATTRIBUTION: the Observed column counts customers who paid AFTER receiving a message, not because of it. Most would have returned anyway.",
    `Observed revenue is counted only for PAID invoices dated within ${opts.attributionWindowDays} days of the send.`,
    `Holdout lift, when present, uses randomized NO-CONTACT assignment and only matured cohorts with the full attribution window, and is shown only once each arm has at least ${HOLDOUT_MIN_MATURED_PER_ARM} matured customers. It is a causal experiment estimate, not a claim of statistical significance.`,
    "NET P&L IS UNMEASURED: provider/carrier SMS cost is not persisted in this repo, so incremental gross revenue is never relabeled as profit.",
    "Cross-sell and declined-work have independent control designs and are not silently merged into the generic contact-holdout cohort.",
    "A customer reached by two loops in the window is counted for both — the observed totals are not a sum of distinct dollars.",
  ];

  if (totals.undelivered > 0) {
    limitations.push(
      `${totals.undelivered} of ${totals.attempted} messages never left the building — failed, stuck in 'sending', or still queued — ` +
      `and are EXCLUDED from every rate here. A loop with a high undelivered count has a DELIVERY problem, not necessarily a copy problem.`,
    );
  }

  if (totals.sent > 0 && totals.paidInvoicesAfter === 0) {
    limitations.push("No recipient paid an invoice in this window. That is a real result, not a missing measurement.");
  }

  return {
    windowDays: opts.windowDays,
    attributionWindowDays: opts.attributionWindowDays,
    loops,
    totals,
    causalMeasurement,
    limitations,
  };
}

/**
 * Messages sent per invoice observed — the number that makes loops comparable.
 *
 * Returns null rather than Infinity or 0 when nothing converted. A loop with 575
 * sends and no invoices has no meaningful ratio, and rendering that as "0" would
 * make the WORST performer look like the BEST on a sorted column.
 */
export function sendsPerInvoice(row: LoopRow): number | null {
  // Divides by `sent`, NOT `attempted` — a message that never went out cannot
  // have failed to produce a sale.
  if (row.paidInvoicesAfter <= 0) return null;
  return Math.round((row.sent / row.paidInvoicesAfter) * 10) / 10;
}
