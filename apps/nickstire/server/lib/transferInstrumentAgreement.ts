/**
 * TWO INSTRUMENTS MEASURE THE TRANSFER. NOTHING COMPARED THEM.
 *
 * `transferArtifact.ts` reads the PROVIDER's verdict (`artifact.transfers[].status`)
 * — what VAPI says happened to the hand-off.
 * `transferOutcomeEvidence.ts` reads the CALLER's BEHAVIOUR — a forward followed
 * by the same phone redialling inside a short window is hard evidence the
 * forward did not resolve their need.
 *
 * Keeping them separate was deliberate and is recorded as such: "if they
 * disagree, that disagreement is the finding and should be investigated rather
 * than averaged." That was right, and it was also incomplete — because nothing
 * in the system ever computed the disagreement. Two independent instruments
 * whose contradiction is the whole point, and no consumer of the contradiction.
 * The audit then listed reconciling them under a 30-day bucket, which is how a
 * finding becomes a calendar entry instead of a fact.
 *
 * WHAT A DISAGREEMENT ACTUALLY MEANS — and this is the point of the module.
 * The two are not redundant measures of one quantity:
 *
 *   provider says CONNECTED  +  caller REDIALS  ->  the hand-off completed and
 *       the human did not resolve the need. That is a COUNTER problem, not a
 *       telephony problem, and every telephony fix in the roadmap is wasted on it.
 *
 *   provider says NOT_CONNECTED  +  caller stays QUIET  ->  the hand-off failed
 *       and the caller gave up without redialling. The worst case for the shop,
 *       and invisible to a redial-only instrument.
 *
 *   both point the same way  ->  the instruments corroborate, and the roadmap's
 *       warm-transfer question can be answered by measurement instead of taste.
 *
 * NEITHER IS PROMOTED TO TRUTH. They are not averaged, not blended into a score,
 * and neither is declared the tie-breaker. The output names what each says, and
 * whether they point the same way.
 *
 * Pure and total: no DB, no clock beyond what callers pass in.
 */
import type { ConnectRate } from "./transferArtifact";
import type { TransferOutcomeEvidence } from "./transferOutcomeEvidence";

export type AgreementVerdict =
  /** Both instruments are reliable and point the same way. */
  | "corroborated"
  /** Both are reliable and point OPPOSITE ways. This is the finding. */
  | "contradicted"
  /** At least one instrument lacks the sample to say anything. */
  | "insufficient";

export interface InstrumentAgreement {
  verdict: AgreementVerdict;
  /**
   * What the provider says, as a share of the attempts it actually resolved.
   * Null when coverage is too thin to mean anything.
   */
  providerConnectRate: number | null;
  /** Share of attempts the provider resolved at all. */
  providerCoveragePct: number | null;
  /**
   * What the callers did: share of classifiable forwards followed by a redial.
   * Null until the sample is reliable.
   */
  redialRate: number | null;
  /**
   * The one sentence an operator should read. Never blank, and it names which
   * instrument is missing when the verdict is `insufficient` — an unreadable
   * comparison must say WHICH half is unreadable, or it reads as "fine".
   */
  detail: string;
  /**
   * Present only on `contradicted`: what the contradiction implies about where
   * the problem actually is. This is the decision the comparison exists to
   * inform, and it is stated rather than left for the reader to derive.
   */
  implication: string | null;
}

/**
 * Above this redial share, callers are demonstrably not being resolved.
 *
 * Not a tuned threshold — a redial rate at or above this means a third of
 * forwarded callers rang back within the window, which no reading of "the
 * hand-off worked" survives. Deliberately coarse: the module's job is to
 * detect a contradiction loud enough to act on, not to score one.
 */
export const REDIAL_TROUBLE_PCT = 33;

/**
 * Above this provider connect rate, the provider is claiming the hand-offs land.
 */
export const PROVIDER_HEALTHY_PCT = 67;

export function compareTransferInstruments(
  provider: ConnectRate,
  behaviour: TransferOutcomeEvidence,
): InstrumentAgreement {
  const providerConnectRate = provider.connectRate;
  const providerCoveragePct = provider.coveragePct;
  const redialRate = behaviour.reliable ? behaviour.redialRate : null;

  const base = {
    providerConnectRate,
    providerCoveragePct,
    redialRate,
  };

  // INSUFFICIENT IS NAMED, NOT IMPLIED. Saying "we cannot compare" without
  // saying which half is missing is the same failure as a silent zero.
  if (providerConnectRate === null && redialRate === null) {
    return {
      ...base,
      verdict: "insufficient",
      detail:
        "Neither instrument has enough data: the provider resolved too few transfers, and too few forwards are old enough to judge by redial. No comparison is possible yet.",
      implication: null,
    };
  }
  if (providerConnectRate === null) {
    return {
      ...base,
      verdict: "insufficient",
      detail:
        `Only caller behaviour is readable (${redialRate}% of classifiable forwards were redialled). The provider resolved too few transfers to compare against — VAPI gates transfer-outcome reporting per organisation, so this may never populate on this account.`,
      implication: null,
    };
  }
  if (redialRate === null) {
    return {
      ...base,
      verdict: "insufficient",
      detail:
        `Only the provider verdict is readable (${providerConnectRate}% connected at ${providerCoveragePct}% coverage). Too few forwards are old enough for the redial window to have elapsed, so caller behaviour cannot corroborate it yet.`,
      implication: null,
    };
  }

  const providerSaysHealthy = providerConnectRate >= PROVIDER_HEALTHY_PCT;
  const behaviourSaysTrouble = redialRate >= REDIAL_TROUBLE_PCT;

  if (providerSaysHealthy && behaviourSaysTrouble) {
    return {
      ...base,
      verdict: "contradicted",
      detail:
        `The provider reports ${providerConnectRate}% of transfers connected (at ${providerCoveragePct}% coverage), yet ${redialRate}% of forwarded callers rang back within the window. Both cannot be describing a resolved call.`,
      implication:
        "The hand-off is COMPLETING and the caller is still not being helped — a counter problem, not a telephony problem. Warm transfer, dialTimeout and sipVerb changes would all be spent on the wrong half of the call. Investigate who answers the forwarded line and what happens next, before changing how the call is routed.",
    };
  }

  if (!providerSaysHealthy && !behaviourSaysTrouble) {
    return {
      ...base,
      verdict: "contradicted",
      detail:
        `The provider reports only ${providerConnectRate}% of transfers connected (at ${providerCoveragePct}% coverage), yet just ${redialRate}% of forwarded callers rang back. Failed hand-offs are not producing the redials that failed hand-offs produce.`,
      implication:
        "Either the provider verdict is wrong on this account, or callers whose transfer failed are giving up instead of redialling — which is the worst outcome for the shop and the one a redial-only instrument cannot see. Do not treat the quiet as success: check a sample of not_connected calls against their transcripts before trusting either number.",
    };
  }

  return {
    ...base,
    verdict: "corroborated",
    detail: providerSaysHealthy
      ? `Both instruments agree the hand-off is working: ${providerConnectRate}% connected (at ${providerCoveragePct}% coverage) and only ${redialRate}% of forwarded callers rang back.`
      : `Both instruments agree the hand-off is failing: ${providerConnectRate}% connected (at ${providerCoveragePct}% coverage) and ${redialRate}% of forwarded callers rang back.`,
    implication: null,
  };
}
