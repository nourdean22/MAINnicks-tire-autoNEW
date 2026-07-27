/**
 * SMS Intent Router V2 (ROS-058 follow-up, 2026-07-25).
 *
 * Replaces the orchestrator's `bodyLower.includes("tire")` keyword chain — a
 * router whose documented misroutes were the kind that damage trust:
 *
 *   "What time will my car be done?"        → hours template   (job status!)
 *   "My oil light came on"                  → oil-change price (triage!)
 *   "Brakes still grind after the repair"   → brake price      (comeback!)
 *   "Can you hold the tire until the tow?"  → tire price       (coordination!)
 *   "What's your cancellation policy?"      → could CANCEL the visit
 *
 * Design contract:
 * - PURE and deterministic: string + context in, typed decision out. No DB, no
 *   LLM, no clock. Fully table-testable.
 * - SPECIFIC-FIRST: safety > complaint/comeback > active-job status > dashboard
 *   lights > inventory/coordination > policy questions > plain price/basics.
 *   A keyword hit is a SIGNAL; the highest-priority matching rule decides.
 * - MULTI-INTENT: all matches are collected. A deterministic template may only
 *   answer a message with exactly ONE intent — templates cannot answer two
 *   questions, so multi-intent routes to the drafter with full context.
 * - STATE-AWARE: the same words route differently when the customer has an
 *   active booking/estimate ("my car" means THEIR car in the shop).
 * - RISK-TIERED: the orchestrator obeys `risk` — human_only forces operator
 *   review no matter what the downstream classifier thinks.
 */
// detectArrivalIntent is a PURE, negation-guarded string test (#998) and
// expectedArrivals has no import-time DB work — only logger + db-affected — so
// reusing it here preserves this module's no-DB contract. Reused rather than
// re-implemented because a second commitment regex would inevitably drift from
// the one that decides whether an expected_arrival row gets written.
import { detectArrivalIntent } from "./expectedArrivals";
// The website's do-not-drive authority. Pure + synchronous (its own docblock:
// "runs before the AI call so a model outage can never suppress a safety
// warning"), so importing it keeps this router PURE as its contract requires.
import { detectRedFlags } from "../diagnose-safety";

export type SmsIntent =
  | "safety_urgent"
  | "complaint_or_comeback"
  | "job_status"
  | "estimate_question"
  | "dashboard_light"
  | "no_start"
  | "arrival_committed"
  | "tire_inventory"
  | "cancellation_policy_question"
  | "hours_location"
  | "price_oil"
  | "price_tires"
  | "price_brakes"
  | "price_alignment"
  | "diagnostic"
  | "symptom_triage"
  | "same_day_visit"
  | "drop_off"
  | "financing"
  | "human_requested"
  | "general";

export type SmsRouteRisk =
  | "deterministic" // approved template may auto-answer
  | "human_assisted" // NickGPT drafts; normal gates decide auto vs review
  | "human_only"; // NickGPT may draft, but operator review is FORCED

export interface SmsRouterContext {
  hasActiveBooking: boolean;
  hasActiveEstimate: boolean;
  hasActiveLead: boolean;
}

export interface SmsIntentDecision {
  primary: SmsIntent;
  secondary: SmsIntent[];
  risk: SmsRouteRisk;
  /** Catalog event key when a deterministic template is allowed to answer. */
  catalogEvent: string | null;
  /** Which rules fired — recorded in the decision trace for later audit. */
  signals: string[];
}

/** Tire size like 225/50R17 or 225/50/17 — the customer just handed us the answer. */
const TIRE_SIZE_RE = /\b\d{3}\s*\/\s*\d{2}\s*(?:R|\/)\s*\d{2}\b/i;

interface Rule {
  intent: SmsIntent;
  /** Lower number = higher priority when choosing the PRIMARY intent. */
  priority: number;
  risk: SmsRouteRisk;
  catalogEvent: string | null;
  test: (body: string, ctx: SmsRouterContext) => boolean;
}

const RULES: Rule[] = [
  // ─── Tier 0: safety — a wrong template here is dangerous, not just wrong ──
  {
    intent: "safety_urgent",
    priority: 0,
    risk: "human_only",
    catalogEvent: null,
    // UNION of two sources, deliberately — coverage can only increase.
    //
    // The local pattern below catches situational emergencies the website's
    // symptom rules do not model ("stranded", "broke down", "accident").
    // `detectRedFlags` is the website's do-not-drive authority and catches the
    // MECHANICAL hazards this pattern missed: `overheat` followed by \b cannot
    // match "overheated" or "overheats", `steam`+\b cannot match "steaming",
    // and "coolant", "radiator", "running hot" and "temp gauge pegged" appear
    // nowhere in it. Same \b-after-truncated-stem trap that has now bitten this
    // repo four separate times.
    //
    // Neither source is authoritative alone. Either one firing is enough for
    // tier 0, because the cost of a missed safety route is not symmetrical with
    // the cost of an unnecessary human handoff.
    test: (b) =>
      // 2026-07-27 · bare `smoke|smoking` sent "white smoke from the tailpipe"
      // and "it smokes a little on a cold start" to human_only — ordinary
      // symptoms, not emergencies, burning the operator's attention. Exhaust
      // smoke now has to say WHERE, and diagnose-safety's fire-smoke rule (which
      // this unions with below) still catches "smoke pouring from the hood",
      // "my car is smoking" and every other real form. Narrowing here removes
      // noise without removing a single genuine hazard.
      /\b(overheat|overheating|steam|on fire|stranded|broke down|breaking down|accident|crash|blew out|blowout|brakes? (went|failed|aren'?t working|not working)|can'?t stop|unsafe to drive)\b/i.test(b)
      || /\bsmok(e|ing)\b(?![^.!?]{0,25}\b(tailpipe|exhaust|muffler|cold\s+start|start\s?up)\b)/i.test(b)
      || detectRedFlags(b).length > 0,
  },

  // ─── Tier 1: complaint / comeback — never answer with a price menu ──
  {
    intent: "complaint_or_comeback",
    priority: 1,
    risk: "human_only",
    catalogEvent: null,
    test: (b) =>
      /\b(still (grind|squeak|shak|pull|leak|overheat|making|doing|broken|not))/i.test(b) ||
      /\b(after (you|the) (fix|repair|service|work))/i.test(b) ||
      /\b(came back|come back) (after|since)\b/i.test(b) ||
      /\b(not (happy|satisfied)|unacceptable|worse than before|you (broke|damaged|messed))\b/i.test(b) ||
      /\b(refund|lawsuit|lawyer|attorney|sue|suing|bbb|better business)\b/i.test(b),
  },

  // ─── Tier 2: active-job status — "my car" means THEIR car in the shop ──
  {
    intent: "job_status",
    priority: 2,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b, ctx) =>
      /\b(what time|when|how (much )?longer|how long until)\b.*\b(my (car|truck|van|vehicle)|it)('?s|s)? (be )?(done|ready|finished)\b/i.test(b) ||
      /\b(is (my|the) (car|truck|van|vehicle) (done|ready|finished))\b/i.test(b) ||
      /\b(status|update) (on|for|about) (my|the)\b/i.test(b) ||
      (ctx.hasActiveBooking && /\bhow('?s| is) (my|the) (car|truck|van|vehicle)\b/i.test(b)),
  },

  // ─── Tier 2b: estimate questions (state-aware) ──
  {
    intent: "estimate_question",
    priority: 2,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b, ctx) => ctx.hasActiveEstimate && /\b(estimate|quote)\b/i.test(b) && /\?|why|what|how|explain/i.test(b),
  },

  // ─── Tier 3: dashboard lights — triage, never a price quote ──
  {
    intent: "dashboard_light",
    priority: 3,
    risk: "deterministic",
    catalogEvent: "price_question_diagnostic", // the free-check triage copy fits
    test: (b) =>
      /\b(oil|tire.?pressure|tpms|battery|abs|airbag|traction|coolant|temp(erature)?)\s*(warning\s*)?light\b/i.test(b) ||
      /\blight('?s)? (came|come|turned|is|keeps? coming) (on|back)\b/i.test(b),
  },

  // ─── Tier 3a: the car cannot be driven here ────────────────────────────
  // VOICE routes "won't start" straight to its BROKEN-DOWN / TOWED flow — it is
  // the first trigger in that list. SMS had no equivalent, so these messages
  // fell to `general`, whose only approved fact is FCFS_FACT: "walk-ins welcome,
  // no appointment needed", and whose required question asks "when to come in?".
  //
  // Telling someone whose car will not start to walk in is not merely unhelpful;
  // they physically cannot comply, and it reads as not having listened. Same
  // words, two channels, opposite answers.
  //
  // human_assisted rather than human_only: this is a logistics problem, not a
  // hazard, and the playbook already forbids the walk-in language. Forcing
  // operator review on every no-start would add load without adding truth.
  {
    intent: "no_start",
    priority: 3,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b) =>
      // EXPANDED negations matter as much as contracted ones — "my car does not
      // start" and "it did not start" are ordinary typed English, and the first
      // version recognised only `doesn't`/`didn't`. Those customers fell through
      // to `general` and got the walk-in plan this rule exists to prevent.
      // Caught in review (P2); the voice-transcript self-audit could not have
      // found it, because people SAY "won't start" and TYPE "does not start".
      // The VERB is inflected too, not just the auxiliary: "is not starting"
      // needs `start(ing)`, and `start\b` cannot reach it. That is the same
      // truncated-stem trap as `bulge` vs "bulging" — hit here while writing a
      // comment about that very trap, which is the strongest argument yet for
      // testing the inflected form by reflex rather than by intention.
      /\b(w(on'?t|ill not|ont)|does(\s?n'?t| not)|did(n'?t| not)|is(\s?n'?t| not)|can'?t|cannot)\s+(start(s|ing|ed)?|turn(s|ing)? over|crank(s|ing)?|fir(e|es|ing) up|com(e|es|ing) on)\b/i.test(b) ||
      /\b(no\s?start|won'?t\s?start)\b/i.test(b) ||
      // 2026-07-27 · STALLED / DIED WHILE DRIVING was uncovered on all four
      // surfaces. It is not a no-start — the car DID start — but the action is
      // identical (it needs towing in), which is exactly what this playbook
      // delivers. Deliberately NOT a do-not-drive red flag: the car is already
      // not driving, and applySafetyFloor would force "have it towed" wording
      // onto a customer who may just have a stalling idle.
      /\b(stall(s|ed|ing)?|cut(s|ting)?\s+out|shut(s|ting)?\s+(off|down)|sputter\w*)\b/i.test(b) ||
      /\b(die[sd]|dying|died|quit|quits|cut\s+off)\b[^.!?]{0,30}\b(driv\w*|road|highway|freeway|street|going|moving|traffic)\b/i.test(b) ||
      /\b(driv\w*|highway|freeway|road)\b[^.!?]{0,30}\b(die[sd]|dying|died|stalled|shut\s+off|quit)\b/i.test(b) ||
      // The CONTRACTION is the common form — "it's dead", not "it is dead".
      // Requiring `\s+is\s+` missed it entirely; the same literal-form trap as
      // `bulge` vs "bulging". Caught by a self-audit against real speech, where
      // a caller said "it's dead on the side of the road". Note the sibling
      // pattern on the next line already got this right for "battery's dead".
      /\b(car|truck|van|vehicle|it)('?s|\s+is)\s+dead\b/i.test(b) ||
      /\b(dead battery|battery('?s| is) dead|clicks? (but )?(won'?t|does\s?n'?t) start|just clicks)\b/i.test(b) ||
      /\b(needs?|need) a (jump|tow)\b/i.test(b),
  },

  // ─── Tier 3b: the customer already said yes ────────────────────────────
  // Declared AFTER dashboard_light so substance wins the priority-3 tie: "my oil
  // light came on, heading over" should answer the LIGHT and carry commitment as
  // a secondary intent. A bare "on my way" has nothing else to match, so it lands
  // here on its own.
  //
  // Above tire_inventory/hours/price on purpose — the failure this prevents is
  // answering "I'm on my way" with a price menu or a qualifying question. Note
  // that the real behavior change rides `stopSelling` on the PLAN, not this
  // intent: commitment is a modifier that applies whatever the customer is
  // asking about, which is why it is also allowed to sit in `secondary`.
  //
  // Detection is delegated to detectArrivalIntent (#998) rather than duplicated:
  // it is already negation-guarded and already excludes "can i come" — that is a
  // QUESTION needing an answer, not a commitment needing logistics.
  {
    intent: "arrival_committed",
    priority: 3,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b) => detectArrivalIntent(b).isArrival,
  },

  // ─── Tier 4: inventory / coordination — no live-stock truth exists ──
  {
    intent: "tire_inventory",
    priority: 4,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b) =>
      TIRE_SIZE_RE.test(b) ||
      /\b(hold|save|reserve|set aside)\b.*\b(tire|it|one)\b/i.test(b) ||
      /\b(do you have|got any|in stock|carry)\b.*\btires?\b/i.test(b) ||
      (/\btires?\b/i.test(b) && /\b(size|stock|available|availability)\b/i.test(b)),
  },

  // ─── Tier 5: policy QUESTIONS — must never trigger the cancel ACTION ──
  {
    intent: "cancellation_policy_question",
    priority: 5,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b) => /\b(cancel(lation)?)\b/i.test(b) && /\b(policy|fee|charge|penalty|what (happens|if))\b/i.test(b),
  },

  // ─── Tier 6: the preserved deterministic basics (word-bounded now) ──
  {
    intent: "hours_location",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "hours_location",
    test: (b) =>
      /\b(hours?|open|close[sd]?|closing|opening)\b/i.test(b) ||
      /\bwhat time (do you|are you|does the shop)\b/i.test(b) ||
      /\b(address|location|where (are|is) (you|the shop)|directions)\b/i.test(b),
  },
  {
    intent: "price_oil",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "price_question_oil",
    test: (b) => /\b(oil change|oil|lube)\b/i.test(b),
  },
  {
    intent: "price_tires",
    priority: 7, // below tire_inventory so size/stock questions win
    risk: "deterministic",
    catalogEvent: "price_question_tires",
    test: (b) => /\btires?\b/i.test(b),
  },
  {
    intent: "price_brakes",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "price_question_brakes",
    test: (b) => /\b(brakes?|rotors?|pads)\b/i.test(b),
  },
  {
    intent: "price_alignment",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "price_question_alignment",
    test: (b) => /\b(alignment|align)\b/i.test(b),
  },
  {
    intent: "diagnostic",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "price_question_diagnostic",
    test: (b) => /\b(diagnostics?|check engine|scan|code[sp]?|e-?check)\b/i.test(b),
  },
  /**
   * Symptoms nobody can price over the phone, and nothing else claims.
   *
   * A coverage audit found these reaching `general`, whose only fact is "FCFS,
   * walk-ins welcome" — so a customer describing a failing wheel bearing was
   * answered with the shop's drop-in policy and nothing about the symptom.
   * Voice names every one of them (vapi.ts URGENCY LIBRARY); SMS named none.
   *
   * PRIORITY 8 — deliberately BELOW every pricing rule (6-7). `price_brakes`
   * already owns squeaking/grinding/pulsating and has a real playbook for them;
   * a symptom rule that outranked it would steal a working path to fix a broken
   * one. This catches only what nothing else claims.
   *
   * Frequencies are from 2,100 production call summaries: exhaust/rattle 16,
   * transmission 10, bearing 7. NOT included: "hum"/"droning", which appear
   * ZERO times — customers here do not use those words, and a pattern for them
   * would be a mechanism that can never fire.
   */
  {
    intent: "symptom_triage",
    priority: 8,
    risk: "human_assisted",
    catalogEvent: null,
    test: (b) =>
      // Coolant LEAK — safety's overheating rule requires boiling/spraying/
      // pouring and never matches the word "leak". A seep is drive-with-care,
      // not do-not-drive, which is why it belongs here and not in RED_FLAG_RULES.
      /\b(coolant|antifreeze)\b[^.!?]{0,20}\b(leak|leaks|leaking|leaked|dripping|low)\b/i.test(b)
      || /\b(leak|leaking|dripping)\b[^.!?]{0,20}\b(coolant|antifreeze)\b/i.test(b)
      // BURNING SMELL, unqualified. Fresh brakes and a new exhaust legitimately
      // smell, so this is triage — not a red flag. "burning smell WITH smoke"
      // is already the do-not-drive form in diagnose-safety.
      || /\b(smell|smells|smelling|smelled)\b[^.!?]{0,20}\bburn(ing|t)?\b/i.test(b)
      || /\bburn(ing|t)\s+(smell|odou?r)\b/i.test(b)
      // Wheel bearing / hub. The inflected forms are spelled out because
      // `bearing\b` alone would also catch "bearing with us".
      || /\b(wheel\s+)?bearings?\b[^.!?]{0,25}\b(noise|noisy|bad|going|out|whine|whining|growl\w*|roar\w*)\b/i.test(b)
      || /\b(bad|failing|worn)\s+(wheel\s+)?bearings?\b/i.test(b)
      // Transmission — slipping, or refusing to change gear.
      || /\btransmission\b[^.!?]{0,25}\b(slip\w*|jerk\w*|hard|rough|shift\w*|gear)\b/i.test(b)
      || /\b(slipping|not\s+shifting|won'?t\s+shift|wont\s+shift|hard\s+to\s+shift)\b/i.test(b)
      // Suspension clunk over bumps.
      || /\b(clunk\w*|knock\w*|thud\w*|bang\w*)\b[^.!?]{0,25}\b(bump|bumps|pothole|potholes|turn|turning|suspension)\b/i.test(b)
      // Exhaust / rattle — the second most common symptom family in the call
      // corpus after brakes.
      || /\b(exhaust|muffler|catalytic|tailpipe)\b/i.test(b)
      || /\brattl\w+\b[^.!?]{0,25}\b(under|underneath|bottom|exhaust)\b/i.test(b),
  },
  {
    intent: "same_day_visit",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "same_day_visit",
    test: (b) => /\b(come (in|by|today)|came today|walk.?in|stop by|swing by|bring it (in|by|today))\b/i.test(b),
  },
  {
    intent: "drop_off",
    priority: 6,
    risk: "deterministic",
    catalogEvent: "drop_off",
    test: (b) => /\bdrop.?off\b/i.test(b) || /\bdrop (it|the car|my car) off\b/i.test(b),
  },
  {
    intent: "financing",
    priority: 6,
    risk: "human_assisted",
    catalogEvent: null,
    // `financ\w*` / `plans?` on purpose. The prior `\b(financ|payment plan|...)\b`
    // could not match "financing", "finance", or "payment plans": a trailing \b
    // needs a word boundary right after "financ"/"plan", which does not exist
    // mid-word. Only the exact singular "payment plan" ever fired, so the most
    // common phrasing of the question — "do you offer financing?" — fell through
    // to `general` and never reached the financing playbook.
    test: (b) => /\b(financ\w*|payment plans?|snap|acima|koalafi|no credit|credit check)\b/i.test(b),
  },
  {
    intent: "human_requested",
    priority: 5,
    risk: "human_only",
    catalogEvent: null,
    test: (b) => /\b(real person|human|speak to (someone|a person)|talk to (someone|a person|the owner)|is this a (bot|robot)|stop texting me a robot)\b/i.test(b),
  },
];

const RISK_ORDER: Record<SmsRouteRisk, number> = {
  human_only: 0,
  human_assisted: 1,
  deterministic: 2,
};

/**
 * Subsumption: a specific intent absorbs the generic price intent that fired
 * off the SAME words — "my oil light came on" matches dashboard_light AND the
 * bare `\boil\b` price rule, but that is one concept, not two questions.
 * Without this, every specific match would read as multi-intent and suppress
 * its own template.
 */
const SUBSUMES: Partial<Record<SmsIntent, SmsIntent[]>> = {
  dashboard_light: ["price_oil", "price_tires", "diagnostic"],
  // "I'm dropping it off today" is ONE concept, not commitment + drop-off +
  // same-day + a request for the address. Without this, a committed customer's
  // message reads as multi-intent and gets a four-part reply.
  arrival_committed: ["same_day_visit", "drop_off", "hours_location"],
  tire_inventory: ["price_tires"],
  job_status: ["hours_location"],
  complaint_or_comeback: ["price_brakes", "price_tires", "price_oil", "price_alignment"],
  cancellation_policy_question: [],
};

/**
 * True when the message asks ABOUT cancellation rather than instructing one.
 * The action parser matches `\bcancel\b` at confidence 80, so without this
 * guard "What's your cancellation policy?" cancels the customer's visit.
 */
export function isCancellationPolicyQuestion(body: string): boolean {
  return RULES.find((r) => r.intent === "cancellation_policy_question")!.test(body, {
    hasActiveBooking: false,
    hasActiveEstimate: false,
    hasActiveLead: false,
  });
}

export function routeInboundSms(body: string, ctx: SmsRouterContext): SmsIntentDecision {
  const matches = RULES.filter((r) => r.test(body, ctx));

  if (matches.length === 0) {
    return { primary: "general", secondary: [], risk: "human_assisted", catalogEvent: null, signals: [] };
  }

  // Primary = highest priority; ties broken by declaration order (specific first).
  const sorted = [...matches].sort((a, b) => a.priority - b.priority);
  const primaryRule = sorted[0]!;
  const subsumed = new Set(SUBSUMES[primaryRule.intent] ?? []);
  const secondary = sorted
    .slice(1)
    .map((r) => r.intent)
    .filter((i) => i !== primaryRule.intent && !subsumed.has(i));

  // Risk = the STRICTEST tier among every matched intent: a message that is
  // half price-question, half complaint is a complaint.
  const risk = sorted.reduce<SmsRouteRisk>(
    (acc, r) => (RISK_ORDER[r.risk] < RISK_ORDER[acc] ? r.risk : acc),
    primaryRule.risk,
  );

  // A template may answer ONLY a single-intent deterministic message. Two
  // questions need a reply that addresses both — that is drafter work.
  const catalogEvent = risk === "deterministic" && secondary.length === 0 ? primaryRule.catalogEvent : null;

  return {
    primary: primaryRule.intent,
    secondary,
    risk,
    catalogEvent,
    signals: sorted.map((r) => r.intent),
  };
}
