/**
 * CALL TAXONOMY KERNEL — one authority for what a call MEANS operationally.
 *
 * THE PROBLEM IT SOLVES
 * "Which outcomes count?" was answered in ten places and no two agreed. Audited
 * 2026-09-18:
 *
 *   1. cron/jobs/vapiCallEval.ts:248      4 outcomes  (WRITE side: stamps queueStatus)
 *   2. routers/vapi.ts:500                same 4      (READ side: re-derives independently)
 *   3. routers/vapi.ts:296  ACTIONABLE    6 outcomes  (dashboard "actionable rate")
 *   4. routers/vapi.ts:287  EXCLUDED      4 outcomes  (quality-score denominator)
 *   5. routers/revenueOps.ts:64           6 outcomes  (scorecard "qualified")
 *   6. services/receptionistRoi.ts:92     same 6      (ROI denominator)
 *   7. services/vapiActionExtraction.ts:46 a DIFFERENT 4 (draft-proposal gate)
 *   8. services/promptEvolution.ts:125    4 outcomes  (SUCCESS labels)
 *   9. services/promptEvolution.ts:93     raw SQL     (failure examples)
 *  10. services/promptEvolution.ts:153    raw SQL     (success examples)
 *
 * Two of those disagreements are live contradictions, not drift:
 *
 *   walk_in_directed is SUCCESS in (8) and ACTIONABLE in (3), and simultaneously
 *   a MISSED-REVENUE obligation in (1) and (2). A caller who said "I'll come by"
 *   was counted as a win by the scorecard and as lost money by the queue.
 *
 *   tech_failure is NOT A VALID CONVERSATION in (4) — excluded from quality
 *   scoring and from every "qualified" denominator — and simultaneously a queue
 *   row the operator is told to work.
 *
 * THE FIX IS THE SHAPE, NOT THE VALUES. A call does not have one boolean
 * ("queue or not"); it has a LANE. Recovery, arrival, operations, safety and
 * engineering are different jobs done by different people on different clocks.
 * Collapsing them into a single "Missed Revenue Queue" is what produced a
 * 1,118-row wall that nobody worked.
 *
 * PRECEDENT: same disease, same cure, both pinned by parity tests —
 * `nickSmsPersona.ts` (ROS-042) and `businessFacts.ts` (ROS-043), and most
 * recently `shared/voice.ts`. `callTaxonomyParity.test.ts` fails the build if a
 * consumer re-types one of these lists.
 *
 * Pure and browser-safe: `shared/` is bundled into the client, so the admin UI
 * renders the SAME verdict the server computed, including its reasons.
 */

/* ────────────────────────────── outcomes ────────────────────────────── */

/**
 * The twelve outcomes `classifyCall` can emit. Declared here rather than in the
 * server so the client can reason about them without importing server code.
 * `callTaxonomyParity.test.ts` pins this list against the classifier's union —
 * if one grows a thirteenth, the build fails rather than silently defaulting.
 */
export const CALL_OUTCOMES = [
  "hard_conversion",
  "walk_in_directed",
  "human_handoff",
  "callback_needed",
  "tire_availability_intent",
  "quote_or_inspection_intent",
  "resolved_info",
  "lost_opportunity",
  "spam_or_wrong_number",
  "abandoned_before_connect",
  "tech_failure",
  "unknown",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/* ──────────────────────────────── lanes ─────────────────────────────── */

/**
 * WHO owns this call next. A lane is a different human, clock and success
 * condition — which is precisely why they must not share one queue.
 *
 * - `recovery`     money is at risk and nobody has it. The only lane that
 *                  belongs in a "needs attention" count.
 * - `arrival`      the caller said they are coming. A provisional SUCCESS, not
 *                  a loss. Becomes recovery ONLY if they never show.
 * - `operations`   real work, zero new revenue (status on a car already here).
 *                  Route to the counter; never a sales obligation.
 * - `safety`       bypasses commercial handling entirely.
 * - `engineering`  the system failed, not the customer. Needs a fix, and a
 *                  customer recovery only when demand was actually expressed.
 * - `none`         resolved, or never a customer (spam, wrong number, silence).
 * - `unclassified` WE DO NOT KNOW. Not a synonym for `none`.
 */
export type CallLane =
  | "recovery"
  | "arrival"
  | "operations"
  | "safety"
  | "engineering"
  | "none"
  | "unclassified";

/**
 * Why a call is NOT in the recovery queue. Rendered to the operator verbatim,
 * because "it disappeared" is how a queue loses trust.
 *
 * `unattributable` is deliberately distinct from `no_customer_speech`: one
 * means we could not read the call, the other means we read it and the caller
 * said nothing. Collapsing them is the empty-vs-error defect this repo has paid
 * for repeatedly.
 */
export type ExclusionReason =
  | "spam_or_wrong_number"
  | "no_customer_speech"
  | "unattributable"
  | "already_resolved"
  | "informational_only"
  | "expected_to_arrive"
  | "operational_not_sales"
  | "already_invoiced"
  | "safety_lane"
  | null;

/* ─────────────────────────── priority reasons ───────────────────────── */

/**
 * One explainable contribution to priority. The UI renders these as
 * "Why is this #1?" — an opaque score is a score nobody trusts or debugs.
 */
export interface PriorityReason {
  code: string;
  label: string;
  delta: number;
}

export interface CallFacts {
  outcome: CallOutcome;
  /** Provenance of the customer speech the outcome was derived from. */
  speakerAttribution: "messages" | "transcript" | "unavailable";
  /** True when the caller produced at least one substantive (non-filler) turn. */
  hasCustomerSpeech: boolean;
  durationSeconds: number;
  /** Minutes since the call ended. Drives SLA and urgency decay. */
  ageMinutes: number;
  /** VERIFIED transfer failure — never inferred from `assistant-forwarded-call`. */
  transferFailed?: boolean;
  /** Caller dialled again within the redial window on the same unresolved intent. */
  repeatWithinWindow?: boolean;
  /** An explicit safety signal was raised during the call. */
  safetyFlag?: boolean;
  /** The caller's vehicle is already at the shop — an operations call. */
  existingVehicleAtShop?: boolean;
  /** A paid invoice already matched this caller after the call. */
  invoiceMatched?: boolean;
  /** An expected-arrival record already exists and has not expired. */
  expectedArrivalOpen?: boolean;
  /** Buying specifics were captured (size/qty/vehicle). Raises expected value. */
  hasCapturedSpecifics?: boolean;
}

export interface CallDisposition {
  lane: CallLane;
  /** True ONLY for the recovery lane. This is what "Needs Attention" counts. */
  queueEligible: boolean;
  /** Minutes allowed before the obligation breaches. `null` when not on a clock. */
  slaMinutes: number | null;
  priority: number;
  reasons: PriorityReason[];
  excludedBecause: ExclusionReason;
}

/* ───────────────────────────── lane mapping ─────────────────────────── */

/**
 * Base lane per outcome, BEFORE per-call facts refine it.
 *
 * The two corrections this table encodes, stated plainly:
 *
 *   walk_in_directed -> `arrival`, NOT `recovery`. Someone saying "I'll come
 *   by" is the outcome the assistant was TRYING to produce. Treating it as
 *   missed revenue both inflated the backlog and punished success. It becomes
 *   recovery only when the arrival window expires with no invoice.
 *
 *   tech_failure -> `engineering`, NOT `recovery` by default. The system broke;
 *   that is a defect ticket. It earns a customer-recovery obligation only when
 *   the caller actually expressed demand before it broke — otherwise the queue
 *   fills with our own outages.
 */
const BASE_LANE: Record<CallOutcome, CallLane> = {
  hard_conversion: "none",
  walk_in_directed: "arrival",
  human_handoff: "none",
  callback_needed: "recovery",
  tire_availability_intent: "recovery",
  quote_or_inspection_intent: "recovery",
  resolved_info: "none",
  lost_opportunity: "recovery",
  spam_or_wrong_number: "none",
  abandoned_before_connect: "none",
  tech_failure: "engineering",
  unknown: "unclassified",
};

/**
 * Response clocks, in minutes. These are Nick's OPERATING TARGETS, chosen for a
 * walk-in shop with a busy counter — they are NOT industry benchmarks, and the
 * widely-quoted "5-minute speed-to-lead" figure is not evidence for them: that
 * canon traces to a single vendor (InsideSales/XANT, whose CEO co-authored the
 * HBR piece), measures CONTACT and QUALIFY odds rather than sales, and has no
 * independent replication. Tune these from Nick's own measured outcomes.
 */
const SLA_MINUTES: Partial<Record<CallOutcome, number>> = {
  callback_needed: 60,
  tire_availability_intent: 120,
  quote_or_inspection_intent: 120,
  lost_opportunity: 120,
};

/** A verified transfer failure is the tightest clock in the system. */
export const TRANSFER_FAILURE_SLA_MINUTES = 15;
/** Quote-shoppers with no urgency signal: batched, not chased. */
export const QUOTE_SHOPPER_SLA_MINUTES = 24 * 60;

/* ───────────────────────────── the verdict ──────────────────────────── */

/**
 * Classify one call into its operating lane, with an explainable priority.
 *
 * Total and pure: every input yields a disposition, never a throw. Ordering is
 * deliberate — exclusions that protect the customer (safety) and exclusions
 * that protect the queue's honesty (attribution) are evaluated before any
 * revenue reasoning.
 */
export function disposeCall(facts: CallFacts): CallDisposition {
  const reasons: PriorityReason[] = [];
  const add = (code: string, label: string, delta: number) => {
    reasons.push({ code, label, delta });
  };

  const done = (
    lane: CallLane,
    excludedBecause: ExclusionReason,
    slaMinutes: number | null = null,
  ): CallDisposition => ({
    lane,
    queueEligible: lane === "recovery",
    slaMinutes,
    priority: reasons.reduce((n, r) => n + r.delta, 0),
    reasons,
    excludedBecause,
  });

  // 1. Safety outranks every commercial consideration, always.
  if (facts.safetyFlag) {
    add("safety", "Safety-critical call", 100);
    return done("safety", "safety_lane");
  }

  // 2. Never a customer. Excluded before anything can score it.
  if (facts.outcome === "spam_or_wrong_number") return done("none", "spam_or_wrong_number");

  // 3. The honest third state. We could not tell who spoke, so we cannot claim
  //    demand — and must not claim its ABSENCE either. `unclassified`, never
  //    `none`, so this can be counted and driven to zero instead of hiding.
  if (facts.speakerAttribution === "unavailable") {
    return done("unclassified", "unattributable");
  }

  // 4. The caller never spoke. Measured, not assumed — see (3).
  if (!facts.hasCustomerSpeech || facts.outcome === "abandoned_before_connect") {
    return done("none", "no_customer_speech");
  }

  // 5. Already money in the till. Closing the loop beats working the row.
  if (facts.invoiceMatched) return done("none", "already_invoiced");
  if (facts.outcome === "hard_conversion") return done("none", "already_resolved");

  // 6. The car is already here. Real work, no new revenue — route to the
  //    counter, never into a sales obligation.
  if (facts.existingVehicleAtShop) return done("operations", "operational_not_sales");

  // 7. The ASSISTANT directed them to walk in. `walk_in_directed` is the
  //    assistant's outcome, not the caller's words — most of these calls are
  //    "how much for an alignment?" answered with "come on by", and the
  //    expected-arrival row behind `expectedArrivalOpen` is written by the
  //    bookSlot tool, which the prompt fires for any non-tire walk-in lead and
  //    in parallel with every transfer. Provisional success — recovery ONLY
  //    once the arrival window has lapsed without an invoice.
  //
  //    The reason text used to read "Said they were coming, no arrival
  //    matched". Measured 2026-09-22: of 89 rows it produced in 30 days, 63
  //    were price/inquiry calls and 66 carried no day the customer named. That
  //    was the assistant's suggestion recorded as the customer's commitment —
  //    the same class as the classifier once scoring its own greeting. The lane
  //    is legitimate lost-lead follow-up; the claim about who said what was
  //    not, so the text now says only what this kernel can establish.
  if (facts.outcome === "walk_in_directed") {
    if (facts.expectedArrivalOpen) return done("arrival", "expected_to_arrive");
    add("no_show", "Directed to walk in; no invoice inside the arrival window", 6);
  }

  // 8. Our outage, not their disinterest. Only a customer who actually asked
  //    for something earns a recovery obligation on top of the defect ticket.
  if (facts.outcome === "tech_failure" && !facts.hasCapturedSpecifics && !facts.repeatWithinWindow) {
    add("tech_failure", "System failure with no captured demand", 0);
    return done("engineering", null);
  }

  // 9. Answered and answered fully.
  if (facts.outcome === "resolved_info") return done("none", "informational_only");
  if (facts.outcome === "human_handoff" && !facts.transferFailed && !facts.repeatWithinWindow) {
    return done("none", "already_resolved");
  }

  /* ── recovery lane: score it, explainably ── */

  let sla: number | null = SLA_MINUTES[facts.outcome] ?? QUOTE_SHOPPER_SLA_MINUTES;

  if (facts.transferFailed) {
    add("transfer_failed", "Verified transfer failure — caller reached nobody", 25);
    sla = TRANSFER_FAILURE_SLA_MINUTES;
  }
  if (facts.repeatWithinWindow) {
    add("repeat_unresolved", "Called again on the same unresolved need", 15);
    sla = Math.min(sla ?? TRANSFER_FAILURE_SLA_MINUTES, 30);
  }
  if (facts.outcome === "callback_needed") {
    add("callback_promised", "Caller explicitly asked to be called back", 20);
  }
  if (facts.hasCapturedSpecifics) {
    add("specifics_captured", "Size / vehicle / quantity captured — quotable now", 12);
  }
  if (facts.outcome === "tire_availability_intent") {
    add("tire_demand", "Tire purchase intent", 8);
  }
  if (facts.outcome === "quote_or_inspection_intent") {
    add("service_demand", "Service or inspection intent", 6);
  }
  if (facts.outcome === "lost_opportunity") {
    add("no_next_step", "Demand expressed, no next step agreed", 5);
  }

  // Urgency decays; it never inverts. A four-hour-old buyer still outranks a
  // fresh price-shopper, so decay is bounded rather than proportional.
  if (facts.ageMinutes <= 15) add("fresh", "Under 15 minutes old", 10);
  else if (facts.ageMinutes <= 60) add("recent", "Under an hour old", 6);
  else if (facts.ageMinutes <= 60 * 8) add("today", "Same business day", 2);
  else if (facts.ageMinutes > 60 * 24 * 7) add("stale", "Over a week old", -8);

  if (facts.durationSeconds >= 60) add("engaged", "Talked for a minute or more", 3);

  return done("recovery", null, sla);
}

/**
 * Outcomes a SQL `WHERE` must fetch because the kernel could route them to
 * recovery. DERIVED by asking the kernel, never hand-typed — this is the list
 * that had drifted between the write side and the read side.
 *
 * It is deliberately PERMISSIVE. A SQL filter cannot know whether the caller
 * actually spoke, whether an arrival is already open, or whether an invoice has
 * since landed; the kernel decides that per row. Fetching a superset and
 * disposing in memory is correct — narrowing it in SQL is how the write and
 * read sides diverged in the first place.
 */
export const RECOVERY_FETCH_OUTCOMES: CallOutcome[] = CALL_OUTCOMES.filter((outcome) =>
  disposeCall({
    outcome,
    speakerAttribution: "transcript",
    hasCustomerSpeech: true,
    durationSeconds: 60,
    ageMinutes: 5,
    hasCapturedSpecifics: true,
    repeatWithinWindow: true,
  }).lane === "recovery",
);

/* ───────────────────────────── episodes ─────────────────────────────── */

/** Default window in which repeat contact is the SAME episode, not a new lead. */
export const EPISODE_WINDOW_MINUTES = 24 * 60;

/**
 * Collapse a caller's related contacts into ONE episode.
 *
 * The queue counted CALLS. A customer whose transfer failed and who then called
 * back twice generated three rows and a "Repeat Caller (+3)" badge — the badge
 * INFLATED the very backlog it was describing, and the +3 fired on any number
 * seen twice in ninety days, so brakes in June and tires in September scored as
 * urgency. One customer, one need, one row; repetition raises priority instead
 * of adding rows.
 *
 * Intent family — not the raw outcome — is the key, so a caller who is first
 * logged `lost_opportunity` and then `callback_needed` for the same tire
 * request stays one episode.
 */
export function episodeKey(
  phoneLast10: string,
  intentFamily: string,
  callTime: Date,
  windowMinutes: number = EPISODE_WINDOW_MINUTES,
): string {
  const bucket = Math.floor(callTime.getTime() / (windowMinutes * 60_000));
  return `${phoneLast10}:${intentFamily}:${bucket}`;
}

/** Coarse families used for episode identity. Deliberately few. */
export function intentFamily(intents: readonly string[]): string {
  const has = (...names: string[]) => names.some((n) => intents.includes(n));
  if (has("used_tire", "new_tire", "tire_size_request", "flat_tire", "tire_leak")) return "tire";
  if (has("brakes", "suspension", "exhaust", "alignment")) return "chassis";
  if (has("battery", "alternator", "starter")) return "electrical";
  if (has("diagnostics", "check_engine", "emissions_echeck")) return "diagnostic";
  if (has("oil_change")) return "maintenance";
  if (has("ac_heat")) return "climate";
  if (has("pricing_question")) return "quote";
  return "general";
}
