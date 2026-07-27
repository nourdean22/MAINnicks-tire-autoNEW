/**
 * SMS Reply Planner + Playbooks (ROS-058 arc, 2026-07-25).
 *
 * The separation this module enforces: the PLANNER decides WHAT may be said —
 * which approved facts, which single question, which claims are forbidden —
 * and NickGPT's job narrows to phrasing it naturally. The drafter no longer
 * reasons from one big persona prompt about prices, inventory, timing or
 * policy; it receives a constrained plan built from the Intent Router V2
 * decision plus the customer's actual state.
 *
 * Three exports matter:
 * - buildReplyPlan(decision, ctx, body)  — pure; merges playbooks multi-intent
 * - renderPlanPrompt(plan)               — the compact block the drafter gets
 * - planViolations(plan, draft)          — post-draft enforcement: a draft that
 *   promises what its plan forbids (stock, holds, completion times, callbacks,
 *   reserved appointments, drive-safe assurances, complaint outcomes) is
 *   forced to operator review. These are the report's "unsupported promise"
 *   invariants, made executable.
 */
import { BUSINESS } from "@shared/business";
import type { SmsIntent, SmsIntentDecision } from "./smsIntentRouter";

export interface PlannerContext {
  customerFirstName: string | null;
  customerVehicle: string | null;
  activeBooking: { service: string; stage: string } | null;
  activeEstimate: { serviceDescription: string | null; externalId: string } | null;
  lastVapiSummary: string | null;
}

export type SmsReplyGoal =
  | "answer"
  | "collect_information"
  | "acknowledge_and_handoff"
  | "safety_triage"
  /**
   * The customer already said yes. The job is logistics + a clean stop — not
   * another benefit, question, or pitch. Selling past this point reads as not
   * listening, and it is the most expensive kind of not-listening because the
   * sale was already won.
   */
  | "confirm_commitment";

export interface ProhibitedClaim {
  label: string;
  re: RegExp;
}

export interface SmsReplyPlan {
  intent: SmsIntent;
  secondary: SmsIntent[];
  goal: SmsReplyGoal;
  /** Approved fact strings the reply may use — nothing outside them. */
  knownFacts: string[];
  /** What we know about THIS customer (never invented, only forwarded). */
  customerFacts: string[];
  missingInformation: string[];
  /** At most ONE high-value question. */
  requiredQuestion: string | null;
  nextStep: string | null;
  prohibited: ProhibitedClaim[];
  maxChars: number;
  /**
   * The customer has committed (said they're coming / dropping it off). A
   * MODIFIER rather than an intent, because commitment applies to whatever they
   * are asking about: "brakes are grinding, heading over now" still owes the
   * brake answer — it just owes it without the pitch or the qualifying question.
   *
   * When true the planner drops the optional question and adds the pitch
   * prohibitions. Any remaining detail can be collected at the counter; they are
   * already on their way to a first-come-first-served shop.
   */
  stopSelling: boolean;
}

const TIRE_SIZE_RE = /\b\d{3}\s*\/\s*\d{2}\s*(?:R|\/)\s*\d{2}\b/i;

/**
 * The customer already named the brake symptom, so asking again would be the
 * repeat-question failure. Detected rather than tracked in state because these
 * words are unambiguous and arrive in the same message often enough to matter.
 */
const BRAKE_SYMPTOM_RE = /\b(squeak\w*|squeal\w*|grind\w*|shak\w*|vibrat\w*|pulsat\w*|soft pedal|spongy)\b/i;

/** Solid vs flashing — the detail that separates "bring it by" from urgent. */
const CEL_STATE_RE = /\b(solid|steady|flash\w*|blink\w*)\b/i;

/**
 * The customer already said WHERE the car is, so asking again is the
 * repeat-question failure.
 *
 * Added after a self-audit of real customer speech: "I need a tow. It's on a
 * hundred twenty fifty Kinsman." would have been answered with "Where's the car
 * right now?" — the exact defect that had just been caught on the check-engine
 * discriminator. Porting a question between channels without porting its guard
 * is apparently easy to do twice.
 *
 * SCOPE, stated honestly: this reads SMS, where customers type digits — so
 * `\d{2,5}\s+\w+` covers "12050 Kinsman". It does NOT cover a bare street name
 * ("on Kinsman") or a spoken-number address, and it is not meant to: adding
 * `on \w+` without a road suffix would fire on "on sale" and "on Monday".
 *
 * The residual failure is therefore asking once for a location the customer
 * already gave in an unusual form. That is the milder of the two errors — the
 * operator still sees the thread — but it IS the repeat-question class this
 * repo keeps rediscovering, so widen this list when a real example appears
 * rather than guessing at phrasings now.
 */
const LOCATION_GIVEN_RE =
  /\b(at (home|work|my (house|place|job)|the (house|shop|office|hotel|store|mall))|in (my|the) (driveway|garage|lot|parking|yard|street)|parking lot|road ?side|side of the (road|highway|freeway)|on (the )?(highway|freeway|interstate|shoulder|i[- ]?\d+|route|rt|us[- ]?\d+)|\d{2,5}\s+\w+|on \w+ (st|street|ave|avenue|rd|road|blvd|dr|drive|way|ln|lane|pkwy|circle|ct|court))\b/i;

/**
 * The customer raised financing themselves. Broader than the router's financing
 * rule because this only needs to decide whether ANSWERING is allowed, not what
 * the reply is about — a false positive here costs nothing.
 */
const FINANCING_ASK_RE = /\b(financ\w*|payment plans?|make payments|pay(ing)? (it )?off|snap|acima|koalafi|no credit|bad credit|credit check|layaway)\b/i;

// ─── Shared prohibited-claim library (affirmative-claim shaped so honest
//     "we'll check what's in stock" copy never trips them) ──────────────
const CLAIM_STOCK: ProhibitedClaim = {
  label: "inventory_claim",
  re: /\b(we (have|got) (it|them|that size|your size|one)|yes,? (we have|it'?s) in stock|is in stock right now)\b/i,
};
const CLAIM_HOLD: ProhibitedClaim = {
  label: "hold_promise",
  re: /\b(we('?ll| will) (hold|save|set aside)|holding (it|one|the tire) for you)\b/i,
};
const CLAIM_COMPLETION: ProhibitedClaim = {
  label: "completion_time_promise",
  re: /\b(ready by|done by|finished by|be done (in|within) \d|within \d+ (minutes|hours)|takes? (about )?\d+ (minutes|hours) and (it'?s|you'?re) done)\b/i,
};
const CLAIM_CALLBACK: ProhibitedClaim = {
  label: "callback_promise",
  re: /\b(we('?ll| will) call you|expect a call|someone (will|is going to) call)\b/i,
};
const CLAIM_APPOINTMENT: ProhibitedClaim = {
  label: "reserved_appointment_claim",
  re: /\b(appointment (is )?(confirmed|booked|reserved)|reserved (a|your) (bay|slot|spot)|your slot is)\b/i,
};
const CLAIM_SAFE_TO_DRIVE: ProhibitedClaim = {
  label: "drive_safe_assurance",
  re: /\b(safe to (drive|keep driving)|fine to drive|you can keep driving)\b/i,
};
/**
 * Inviting a customer to drive/walk in when the car cannot move.
 *
 * Shaped to catch the INVITATION, not the address or the FCFS fact — a no-start
 * customer still needs to know where the shop is and that no appointment is
 * required once the car gets there. What they must never be told is to bring it
 * in themselves.
 */
const CLAIM_COME_IN_UNDRIVABLE: ProhibitedClaim = {
  label: "come_in_when_undrivable",
  // "walk in" was MISSING from the first version of this list — while the plan
  // itself hands the drafter FCFS_FACT ("walk-ins welcome"). The guard omitted
  // the one phrase the model was most likely to echo, because the phrase came
  // from the approved fact sitting in its own context. Caught in review (P1).
  //
  // `walk\s+in` is the VERB and must fire; `walk-ins`/`walk ins` is the noun in
  // FCFS_FACT and must not. The whitespace-then-word-boundary shape separates
  // them: neither the hyphen in "walk-ins" nor the trailing "s" in "walk ins"
  // can satisfy `\s+in\b`.
  re: /\b(pull up|come (on )?(in|by|down|over)|walk (on )?in\b|swing by|stop by|bring (it|the car|your car) (in|by|down|over)|drive (it )?(in|over|down|here|by))\b/i,
};

const CLAIM_REMOTE_DIAGNOSIS: ProhibitedClaim = {
  label: "remote_diagnosis",
  re: /\b(it'?s (definitely|just|only|probably just) (the|your) \w+|that means your \w+ (is|has) (bad|shot|dead|failed))\b/i,
};
const CLAIM_COMPLAINT_OUTCOME: ProhibitedClaim = {
  label: "complaint_outcome_promise",
  re: /\b(we('?ll| will) (refund|redo|replace it free|fix (it|that) (for )?free|take care of everything)|full refund)\b/i,
};

/**
 * Pitching to a customer who already committed. These fire ONLY when
 * `stopSelling` is set, because each pattern is perfectly legitimate earlier in
 * a conversation — "we offer financing" is a good answer to "do you finance?"
 * and a bad answer to "I'm on my way."
 *
 * Shaped to catch the pitch, not the logistics: the address, the hours and the
 * FCFS fact must all still pass, since those are exactly what a committed
 * customer needs.
 */
const CLAIM_PITCH_REVIEWS: ProhibitedClaim = {
  label: "pitch_after_commitment:social_proof",
  re: /\b(\d[\d,]*\+? ?(google )?reviews?|\d(\.\d)? ?stars?|highest.rated|top.rated|best (shop|prices) in)\b/i,
};
const CLAIM_PITCH_SERVICE_LIST: ProhibitedClaim = {
  label: "pitch_after_commitment:service_list",
  re: /\b(tires?,\s*brakes?|brakes?,\s*(tires?|alignments?)|we (also )?(do|offer|handle)\b[^.!?]*\b(and more|everything|full service))\b/i,
};
const CLAIM_PITCH_FINANCING: ProhibitedClaim = {
  label: "pitch_after_commitment:unprompted_financing",
  re: /\b(we (also )?(offer|have) financing|financing (is )?available|payment plans? available|no credit (check )?needed)\b/i,
};
const CLAIM_PITCH_BENEFITS: ProhibitedClaim = {
  label: "pitch_after_commitment:benefit_restatement",
  re: /\b(free (check|quote|inspection)[^.!?]*\b(and|plus)\b|great choice|you'?ll love|best decision|happy to help you save)\b/i,
};

/**
 * Applied on top of the playbook's own list whenever the customer has committed.
 * Kept separate from GLOBAL_PROHIBITED so the pre-commitment conversation keeps
 * its full, honest sales vocabulary.
 */
const STOP_SELLING_PROHIBITED: ProhibitedClaim[] = [
  CLAIM_PITCH_REVIEWS,
  CLAIM_PITCH_SERVICE_LIST,
  CLAIM_PITCH_FINANCING,
  CLAIM_PITCH_BENEFITS,
];

/**
 * Prohibitions that apply to EVERY planned reply (FCFS honesty + safety).
 *
 * EXPORTED because "every PLANNED reply" was narrower than it sounded. The
 * orchestrator has two outbound paths: a deterministic catalog template
 * (`matchedCatalogEvent`) which auto-sends, and the planner. Only the second
 * calls `buildReplyPlan`, so these prohibitions could never fire on a catalog
 * template — an entire class of outbound text was structurally unreachable by
 * the guard meant to cover everything.
 *
 * Templates are static, so the fix is a static check: a test runs every catalog
 * variant through this list at build time. Zero runtime cost, and a bad template
 * fails CI instead of reaching a customer.
 */
export const GLOBAL_PROHIBITED: ProhibitedClaim[] = [CLAIM_APPOINTMENT, CLAIM_SAFE_TO_DRIVE];

const FCFS_FACT = "The shop is first come, first served — walk-ins welcome, no appointment needed, 7 days a week.";
const SHOP_FACT = `${BUSINESS.address.full} · ${BUSINESS.phone.display}.`;

interface SmsPlaybook {
  goal: SmsReplyGoal;
  knownFacts: (ctx: PlannerContext, body: string) => string[];
  missingInformation: (ctx: PlannerContext, body: string) => string[];
  requiredQuestion: (ctx: PlannerContext, body: string) => string | null;
  nextStep: string | null;
  prohibited: ProhibitedClaim[];
  maxChars: number;
}

const PLAYBOOKS: Partial<Record<SmsIntent, SmsPlaybook>> = {
  tire_inventory: {
    goal: "collect_information",
    knownFacts: (_ctx, body) => {
      const size = body.match(TIRE_SIZE_RE)?.[0] ?? null;
      const facts = [
        `Used tires start ${BUSINESS.usedTires.priceDisplay} (${BUSINESS.usedTires.fineprint}); ${BUSINESS.usedTires.typicalBand}.`,
        "There is NO live inventory feed — stock is confirmed by a physical rack check at the shop.",
      ];
      if (size) facts.push(`The customer already provided the tire size: ${size}.`);
      return facts;
    },
    missingInformation: (_ctx, body) => (TIRE_SIZE_RE.test(body) ? [] : ["tire size from the sidewall"]),
    requiredQuestion: (_ctx, body) =>
      TIRE_SIZE_RE.test(body)
        ? null
        : "Ask for the tire size printed on the sidewall (like 225/50R17) — a clear photo works too.",
    nextStep: "The crew checks the rack for that size when the customer comes in or once the size is known.",
    prohibited: [CLAIM_STOCK, CLAIM_HOLD],
    maxChars: 300,
  },

  job_status: {
    goal: "answer",
    knownFacts: (ctx) =>
      ctx.activeBooking
        ? [`The customer's job is currently marked: "${ctx.activeBooking.stage}" for "${ctx.activeBooking.service}". That stage is the ONLY verified status.`]
        : ["No verified job status is available — do not guess; say the shop will check and follow up."],
    missingInformation: (ctx) => (ctx.activeBooking ? [] : ["verified job status from the shop floor"]),
    requiredQuestion: () => null,
    nextStep: "The shop updates the customer when the next status is recorded.",
    prohibited: [CLAIM_COMPLETION, CLAIM_CALLBACK],
    maxChars: 300,
  },

  estimate_question: {
    goal: "answer",
    knownFacts: (ctx) =>
      ctx.activeEstimate
        ? [`The customer has a written estimate #${ctx.activeEstimate.externalId} for: ${ctx.activeEstimate.serviceDescription ?? "service"}. Explain only — never change, approve, or re-price it from a text.`]
        : [],
    missingInformation: () => [],
    requiredQuestion: () => "Ask which part of the estimate they want explained.",
    nextStep: null,
    prohibited: [CLAIM_COMPLETION],
    maxChars: 320,
  },

  dashboard_light: {
    goal: "answer",
    knownFacts: () => [
      "A dashboard light can mean several different things — only an in-person check can say which.",
      "The shop does a free quick check first and gives the price in writing before any work.",
    ],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "Bring the car by for the free check.",
    prohibited: [CLAIM_REMOTE_DIAGNOSIS],
    maxChars: 300,
  },

  complaint_or_comeback: {
    goal: "acknowledge_and_handoff",
    knownFacts: () => [
      "Acknowledge plainly, do not argue, do not admit fault, do not promise outcomes.",
      "The conversation is being routed to the shop for a person to review.",
    ],
    missingInformation: () => [],
    requiredQuestion: (_ctx, body) =>
      /\bstill\b/i.test(body) ? "Ask what changed and when it started — one question only." : null,
    nextStep: "A person at the shop reviews this conversation and the job.",
    prohibited: [CLAIM_COMPLAINT_OUTCOME, CLAIM_CALLBACK, CLAIM_COMPLETION],
    maxChars: 280,
  },

  safety_urgent: {
    goal: "safety_triage",
    knownFacts: () => [
      "If the vehicle is overheating, smoking, or unsafe: stop driving, let it cool, arrange a tow.",
      SHOP_FACT,
    ],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "Arrange a tow; the shop will be told it is coming.",
    prohibited: [CLAIM_COMPLETION, CLAIM_CALLBACK],
    maxChars: 300,
  },

  financing: {
    goal: "answer",
    knownFacts: () => [
      "Financing is available through Acima, Snap and Koalafi — no credit check, $10 down, subject to the provider's approval and terms.",
      "The shop can help the customer apply and explain options before they agree.",
    ],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "Come by and the shop helps with the application.",
    prohibited: [],
    maxChars: 300,
  },

  cancellation_policy_question: {
    goal: "answer",
    knownFacts: () => [
      "There is no appointment system to cancel against — the shop is first come, first served, so nothing is reserved and nothing is charged for not showing up.",
      "If they had told us they were coming, a quick text either way is appreciated but never required.",
    ],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: null,
    prohibited: [],
    maxChars: 280,
  },

  human_requested: {
    goal: "acknowledge_and_handoff",
    knownFacts: () => [
      "Confirm a person at the shop will see this conversation.",
      `During business hours they can also call ${BUSINESS.phone.display}.`,
    ],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "The conversation is routed to the shop for a person.",
    prohibited: [CLAIM_CALLBACK],
    maxChars: 240,
  },

  // Deterministic-tier intents still get playbooks: a MULTI-intent message
  // ("225/50R17 and can I come today?") arrives at the drafter carrying them
  // as secondary, and their approved facts must travel with the plan.
  hours_location: {
    goal: "answer",
    knownFacts: () => [`Open Mon-Sat 8-6, Sun 9-4. ${SHOP_FACT}`, FCFS_FACT],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: null,
    prohibited: [],
    maxChars: 300,
  },
  // The sale is already won. Confirm, give the address, stop.
  // Deliberately: no question, no curiosity, no benefit — and a tight character
  // budget, because brevity here is the signal that we actually heard them.
  arrival_committed: {
    goal: "confirm_commitment",
    knownFacts: () => [FCFS_FACT, SHOP_FACT],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "Acknowledge that they're on the way and note it — nothing further is needed.",
    prohibited: [CLAIM_COMPLETION, CLAIM_HOLD, CLAIM_STOCK],
    maxChars: 200,
  },
  same_day_visit: {
    goal: "answer",
    knownFacts: () => [FCFS_FACT, "Earlier is better; a drop-off helps the shop work it in faster."],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "Come by whenever ready — first come, first served.",
    prohibited: [CLAIM_COMPLETION],
    maxChars: 300,
  },
  drop_off: {
    goal: "answer",
    knownFacts: () => ["Drop-off is fine: bring the keys inside and tell the desk what the car is doing. The shop inspects and gets approval before any paid work."],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: null,
    prohibited: [CLAIM_COMPLETION],
    maxChars: 300,
  },
  price_oil: {
    goal: "answer",
    knownFacts: () => [`Oil change: ${BUSINESS.oilChange.conventionalPrice} conventional / ${BUSINESS.oilChange.syntheticPrice} full synthetic. Walk in any day.`],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: null,
    prohibited: [],
    maxChars: 280,
  },
  price_tires: {
    goal: "answer",
    knownFacts: () => [`Used tires start ${BUSINESS.usedTires.priceDisplay} (${BUSINESS.usedTires.fineprint}); ${BUSINESS.usedTires.typicalBand}.`],
    missingInformation: (_ctx, body) => (TIRE_SIZE_RE.test(body) ? [] : ["tire size"]),
    requiredQuestion: (_ctx, body) => (TIRE_SIZE_RE.test(body) ? null : "Ask for the tire size so the crew can check options."),
    nextStep: null,
    prohibited: [CLAIM_STOCK, CLAIM_HOLD],
    maxChars: 300,
  },
  price_brakes: {
    goal: "answer",
    knownFacts: () => [
      "Brake pricing depends on what is worn — free check first, price in writing before any work. Never quote a brake dollar amount.",
      // The distinction is what makes "it depends" land as expertise instead of a
      // dodge: it names two real paths the customer can tell apart by ear, and
      // their answer genuinely changes what gets inspected first.
      "Squeaking is often still just the pads; grinding can mean the rotor is involved. The symptom changes what gets checked first.",
    ],
    missingInformation: (_ctx, body) =>
      BRAKE_SYMPTOM_RE.test(body) ? [] : ["which brake symptom they hear (squeak / grind / shake)"],
    // Suppressed once they have already told us the symptom — re-asking is the
    // repeat-question failure, and the symptom words are unambiguous enough to
    // detect directly.
    requiredQuestion: (_ctx, body) =>
      BRAKE_SYMPTOM_RE.test(body) ? null : "Is it squeaking, grinding or shaking?",
    nextStep: "Bring it in for the free check.",
    prohibited: [CLAIM_COMPLETION],
    maxChars: 300,
  },
  price_alignment: {
    goal: "answer",
    knownFacts: () => ["Alignment starts with an inspection of steering, suspension and tire wear — price in writing before any work. Never quote an alignment dollar amount."],
    missingInformation: () => [],
    requiredQuestion: () => null,
    nextStep: "Bring it in for the inspection.",
    prohibited: [],
    maxChars: 300,
  },
  diagnostic: {
    goal: "answer",
    knownFacts: () => [
      "Diagnostics start with a free check — the shop scans it, looks it over, and gives the price in writing before doing anything.",
      // Process proof rather than hype, and it pre-empts the "just clear the
      // code" request without calling the customer wrong.
      "A code points to where to test; the test is what shows whether a part actually failed. Clearing a code does not fix the cause.",
    ],
    missingInformation: (_ctx, body) =>
      CEL_STATE_RE.test(body) ? [] : ["whether the check-engine light is solid or flashing"],
    // Solid vs flashing is the one detail that changes urgency, and a flashing
    // light routes to safety copy rather than a shop-visit pitch.
    requiredQuestion: (_ctx, body) =>
      CEL_STATE_RE.test(body) ? null : "Is the light solid or flashing?",
    nextStep: "Bring the car (and any failed E-Check paperwork) by.",
    prohibited: [CLAIM_REMOTE_DIAGNOSIS],
    maxChars: 300,
  },

  /**
   * The SMS counterpart to voice's BROKEN-DOWN / TOWED flow.
   *
   * Voice has always routed "won't start" to a tow — it is the first trigger in
   * that flow. SMS fell through to `general`, which offers FCFS_FACT
   * ("walk-ins welcome") and asks "when to come in?" — an answer the customer
   * cannot act on, because the car will not move.
   *
   * The single highest-value question here is WHERE THE CAR IS, exactly as it is
   * on the phone: it decides tow vs jump, and whether the shop is even the right
   * next call. Price is not the question; getting the car here is.
   */
  no_start: {
    goal: "collect_information",
    knownFacts: () => [
      "A car that will not start has to get to the shop by tow or jump — the shop cannot come to it.",
      "Once it arrives the shop looks at it and gives the price in writing before any work.",
      FCFS_FACT,
    ],
    missingInformation: (_ctx, body) =>
      LOCATION_GIVEN_RE.test(body) ? [] : ["where the vehicle is right now"],
    // Conditional, exactly like the CEL and brake discriminators. A stranded
    // customer who just gave an address must not be asked for it again.
    requiredQuestion: (_ctx, body) =>
      LOCATION_GIVEN_RE.test(body) ? null : "Where's the car right now — at home, at work, or on the roadside?",
    nextStep: "Get it to the shop; it gets looked at once it lands.",
    // The walk-in invitation is the specific failure this playbook exists to
    // prevent, so it is prohibited rather than merely omitted.
    prohibited: [CLAIM_COME_IN_UNDRIVABLE, CLAIM_REMOTE_DIAGNOSIS, CLAIM_CALLBACK],
    maxChars: 300,
  },

  general: {
    goal: "collect_information",
    knownFacts: () => [FCFS_FACT],
    missingInformation: () => ["what the customer actually needs"],
    requiredQuestion: () => "Ask ONE clarifying question: are they asking about price, whether we do the service, or when to come in?",
    nextStep: null,
    prohibited: [],
    maxChars: 280,
  },
};

function customerFactsFor(ctx: PlannerContext): string[] {
  const facts: string[] = [];
  if (ctx.customerFirstName) facts.push(`Customer first name: ${ctx.customerFirstName}.`);
  if (ctx.customerVehicle) facts.push(`Customer vehicle: ${ctx.customerVehicle}.`);
  if (ctx.activeBooking) facts.push(`Active visit: "${ctx.activeBooking.service}" currently "${ctx.activeBooking.stage}".`);
  if (ctx.activeEstimate) facts.push(`Open written estimate #${ctx.activeEstimate.externalId}: ${ctx.activeEstimate.serviceDescription ?? "service"}.`);
  if (ctx.lastVapiSummary) facts.push(`Last phone call gist: ${ctx.lastVapiSummary}`);
  return facts;
}

/**
 * Build the constrained plan for a routed message. Multi-intent merges the
 * playbooks: facts and prohibitions UNION, the single question comes from the
 * primary (or the first secondary that has one), the tightest length wins.
 */
export function buildReplyPlan(decision: SmsIntentDecision, ctx: PlannerContext, body: string): SmsReplyPlan {
  const intents = [decision.primary, ...decision.secondary];
  const books = intents.map((i) => PLAYBOOKS[i]).filter((b): b is SmsPlaybook => Boolean(b));
  const primaryBook = PLAYBOOKS[decision.primary] ?? PLAYBOOKS.general!;

  const knownFacts = [...new Set(books.flatMap((b) => b.knownFacts(ctx, body)))];
  const missingInformation = [...new Set(books.flatMap((b) => b.missingInformation(ctx, body)))];
  const requiredQuestion =
    books.map((b) => b.requiredQuestion(ctx, body)).find((q): q is string => Boolean(q)) ?? null;
  // Commitment is a MODIFIER, so it counts from `secondary` too: "brakes are
  // grinding, on my way" must still answer the brakes — just without the pitch.
  const stopSelling = intents.includes("arrival_committed");

  // Stop-selling suppresses the UNPROMPTED pitch, never an answer the customer
  // asked for. "I'm on my way — do you take payments?" is a direct question, and
  // refusing to answer it would be a worse failure than the pitch we are
  // preventing. Same logic as scoping the prohibitions to commitment at all.
  const askedAboutFinancing = intents.includes("financing") || FINANCING_ASK_RE.test(body);
  const stopSellingClaims = STOP_SELLING_PROHIBITED.filter(
    (c) => !(askedAboutFinancing && c.label === CLAIM_PITCH_FINANCING.label),
  );

  const prohibitedMap = new Map<string, ProhibitedClaim>();
  for (const c of [
    ...GLOBAL_PROHIBITED,
    ...books.flatMap((b) => b.prohibited),
    ...(stopSelling ? stopSellingClaims : []),
  ]) {
    prohibitedMap.set(c.label, c);
  }
  const maxChars = Math.min(...books.map((b) => b.maxChars), 320);

  return {
    intent: decision.primary,
    secondary: decision.secondary,
    goal: primaryBook.goal,
    knownFacts,
    customerFacts: customerFactsFor(ctx),
    missingInformation,
    // A committed customer is walking into a first-come-first-served shop, so any
    // remaining detail is cheaper to collect at the counter than to trade another
    // text for. Suppressing the question here is what makes "Got it — noted" the
    // whole reply instead of "Got it! What size do you need?"
    requiredQuestion: stopSelling ? null : requiredQuestion,
    nextStep: primaryBook.nextStep,
    prohibited: [...prohibitedMap.values()],
    maxChars,
    stopSelling,
  };
}

/** The compact block appended to the drafter's system prompt. */
export function renderPlanPrompt(plan: SmsReplyPlan): string {
  const lines = [
    `GOAL: ${plan.goal.replaceAll("_", " ")}.`,
    // A POSITIVE contract, stated once. The equivalent negative ("never mention
    // reviews, never list services, never...") both lengthens the prompt and
    // keeps the banned phrasing live in context; the regex validators below are
    // what actually enforce it.
    plan.stopSelling
      ? "THE CUSTOMER ALREADY COMMITTED. Confirm what they said, give only the logistics they still need, and stop. No questions, no benefits, no extras."
      : null,
    plan.knownFacts.length ? `USE ONLY THESE FACTS: ${plan.knownFacts.join(" ")}` : null,
    plan.customerFacts.length ? `CUSTOMER: ${plan.customerFacts.join(" ")}` : null,
    plan.requiredQuestion ? `ASK EXACTLY ONE QUESTION: ${plan.requiredQuestion}` : "Do not ask a question unless essential.",
    plan.nextStep ? `NEXT STEP TO OFFER: ${plan.nextStep}` : null,
    plan.prohibited.length ? `NEVER: ${plan.prohibited.map((p) => p.label.replaceAll("_", " ")).join("; ")}.` : null,
    `Keep it under ${plan.maxChars} characters. Address every part of the customer's message.`,
  ].filter(Boolean);
  return `\n\n[REPLY PLAN — follow exactly. ${lines.join(" ")}]`;
}

/** Post-draft enforcement: which of the plan's prohibitions the draft violates. */
export function planViolations(plan: SmsReplyPlan, draft: string): string[] {
  return plan.prohibited.filter((p) => p.re.test(draft)).map((p) => p.label);
}
