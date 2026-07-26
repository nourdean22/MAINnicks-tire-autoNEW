/**
 * Voice demand classifier — what the CALLER actually asked for.
 *
 * WHY A REAL TAXONOMY
 * The only pre-existing labels were `serviceMention` (effectively binary:
 * tire | brake, so it measured its own label set) and `metadata.intents` (a
 * keyword multi-labeler that co-fires — identical label sets repeat exactly).
 * Neither can answer "what do callers want?", which is why the ~60% used-tire
 * figure the VAPI prompt is built around went unverifiable for so long.
 *
 * THE TWO-TIER DESIGN
 * Tier 1 (this module, deterministic): specific-first rules over the caller's
 * OWN first substantive turn. Free, instant, reproducible, and auditable — a
 * regex can be inspected, a model's mood cannot.
 * Tier 2 (a model, wired separately): only the turns Tier 1 marks `unclear`.
 * Roughly half of real first turns resist keyword rules, so Tier 2 is not
 * optional — but sending it only the residue keeps it cheap and keeps the
 * common cases deterministic.
 *
 * `unclear` IS A REAL ANSWER. It must never collapse into a catch-all like
 * `general`: a bucket that absorbs uncertainty is exactly how the binary
 * `serviceMention` came to look informative while measuring nothing.
 *
 * REGEX DISCIPLINE (learned the hard way, four times in one session)
 * Every stem below uses `\w*` or `s?`. A trailing `\b` after a truncated stem
 * cannot match mid-word: `/\btire\b/` misses "tires", `/\bfinanc\b/` misses
 * "financing" — the latter silently disabled the router's financing intent in
 * production for months.
 */

export type VoiceIntent =
  // Tires
  | "used_tire_price" | "used_tire_availability" | "new_tire_quote" | "tire_size_help"
  | "flat_or_puncture" | "tpms" | "tire_service" | "rack_check"
  // Repair
  | "brakes" | "oil_change" | "alignment" | "check_engine" | "echeck"
  | "no_start" | "overheating" | "suspension_noise" | "ac_heat" | "exhaust" | "general_repair"
  // Operations
  | "hours_location" | "walk_in_same_day" | "wait_time" | "drop_off" | "tow_in"
  | "active_job_status" | "parts_eta" | "pickup" | "payment_invoice"
  // Sales
  | "financing" | "price_comparison" | "estimate_question" | "ready_to_visit"
  // Care
  | "human_requested" | "complaint" | "warranty" | "wrong_number"
  // The honest default
  | "unclear";

/** The friction actually blocking the caller's next step. */
export type VoiceFriction =
  | "unknown_tire_size" | "unknown_vehicle" | "price_uncertainty" | "inventory_uncertainty"
  | "wait_uncertainty" | "trust_uncertainty" | "transportation" | "financing"
  | "human_required" | "safety" | "complaint" | "no_active_friction" | "unknown";

export interface VoiceClassification {
  intent: VoiceIntent;
  /** Other intents whose rules also matched, in priority order. */
  secondary: VoiceIntent[];
  friction: VoiceFriction;
  /** 0-1. Deterministic hits are high; `unclear` is always 0. */
  confidence: number;
  /** "deterministic" or "none" — the model tier stamps its own source. */
  source: "deterministic" | "none";
  /** Which rule fired, for auditability. */
  matchedRule: string | null;
}

interface Rule {
  intent: VoiceIntent;
  /** Lower wins. Specific-first, exactly like the SMS router. */
  priority: number;
  friction: VoiceFriction;
  re: RegExp;
  /** High for unambiguous phrasings, lower for rules that can over-match. */
  confidence: number;
}

/**
 * Specific-first. A caller who opens "I need to talk to a manager about my
 * brakes" wants a HUMAN — routing them to the brake flow is the failure this
 * ordering prevents.
 */
const RULES: Rule[] = [
  // ── Tier 0: overrides. These beat any service topic in the same sentence.
  {
    intent: "human_requested", priority: 0, friction: "human_required", confidence: 0.95,
    re: /\b(speak|talk)\w*\s+(to|with)\s+(someone|somebody|a person|a human|a manager|the manager|the owner|a rep\w*)|real person|^\s*manager\b|manager,?\s*please|just transfer|transfer me|connect me|customer service\b/i,
  },
  {
    intent: "complaint", priority: 0, friction: "complaint", confidence: 0.9,
    re: /\bstill\s+(doing|making|grind\w*|squeak\w*|leak\w*|pull\w*)|after (you|the shop|the) (fix|repair|work)|\bcame back\b|not happy|complain\w*|\brefund\w*|you (broke|damaged|messed)/i,
  },
  {
    intent: "warranty", priority: 1, friction: "trust_uncertainty", confidence: 0.85,
    re: /\bwarrant\w*|under warranty|covered\b.{0,20}\bwarrant\w*/i,
  },
  {
    intent: "active_job_status", priority: 1, friction: "wait_uncertainty", confidence: 0.85,
    re: /\b(my|the)\s+(car|truck|van|vehicle)\b.{0,25}\b(ready|done|finish\w*)|is it (ready|done)|how much longer|status (on|of)\b|checking on my/i,
  },

  // ── Tier 2: tires, most specific first.
  {
    intent: "used_tire_availability", priority: 2, friction: "inventory_uncertainty", confidence: 0.85,
    re: /\b(do you have|got|any|in stock|carry)\b.{0,25}\bused\b.{0,15}\b(tire|tyre)s?\b|\bused\b.{0,15}\b(tire|tyre)s?\b.{0,20}\b(in stock|available)\b/i,
  },
  {
    intent: "used_tire_price", priority: 3, friction: "price_uncertainty", confidence: 0.85,
    re: /\bused\b.{0,15}\b(tire|tyre)s?\b|\b(tire|tyre)s?\b.{0,15}\bused\b/i,
  },
  {
    intent: "new_tire_quote", priority: 3, friction: "price_uncertainty", confidence: 0.8,
    re: /\bnew\b.{0,12}\b(tire|tyre)s?\b|\bbrand new\b.{0,12}\b(tire|tyre)s?\b/i,
  },
  {
    intent: "tire_size_help", priority: 3, friction: "unknown_tire_size", confidence: 0.8,
    re: /\b\d{3}\s?[\/-]?\s?\d{2}\s?[rR]?\s?\d{2}\b|sidewall|what size\b|(tire|tyre)s?\s+size/i,
  },
  {
    intent: "flat_or_puncture", priority: 3, friction: "transportation", confidence: 0.85,
    re: /\bflats?\b|\bnails?\b|punctur\w*|\bplug\w*|\bpatch\w*|losing air|low(er)? air|going flat/i,
  },
  {
    intent: "tpms", priority: 3, friction: "unknown_vehicle", confidence: 0.85,
    re: /\btpms\b|(tire|tyre)\s+pressure\s+light|pressure sensor/i,
  },
  {
    intent: "tire_service", priority: 4, friction: "price_uncertainty", confidence: 0.7,
    re: /\brotat\w*|\bbalanc\w*|\bmount\w*|\b(tire|tyre)s?\b|\bwheels?\b|\brims?\b|\btread\w*/i,
  },

  // ── Tier 3: repair.
  {
    intent: "no_start", priority: 4, friction: "transportation", confidence: 0.9,
    re: /won'?t start|not start\w*|no[- ]start|doesn'?t start|jump\w*|dead batter\w*|batter\w*|alternator|starter\b/i,
  },
  {
    intent: "overheating", priority: 4, friction: "safety", confidence: 0.9,
    re: /overheat\w*|running hot|coolant|radiator|temperature gauge/i,
  },
  {
    intent: "brakes", priority: 4, friction: "price_uncertainty", confidence: 0.85,
    re: /\bbrakes?\b|\brotors?\b|\bpads?\b|\bcalipers?\b|squeal\w*|grind\w*(?=.{0,30}\b(stop|brak))/i,
  },
  {
    intent: "check_engine", priority: 4, friction: "price_uncertainty", confidence: 0.85,
    re: /check[- ]engine|engine light|\bcodes?\b|misfire|\bscan\w*|diagnos\w*/i,
  },
  { intent: "echeck", priority: 4, friction: "price_uncertainty", confidence: 0.9, re: /\be[-\s]?check\b|emission\w*/i },
  { intent: "oil_change", priority: 4, friction: "price_uncertainty", confidence: 0.85, re: /oil chang\w*|chang\w*\s+(the\s+|my\s+)?oil\b|\boil\b/i },
  { intent: "alignment", priority: 4, friction: "price_uncertainty", confidence: 0.85, re: /align\w*|pull\w*\s+to\s+the\s+(left|right)/i },
  { intent: "ac_heat", priority: 4, friction: "price_uncertainty", confidence: 0.8, re: /\ba\/?c\b|air condition\w*|blow\w*\s+cold|\bheater?\b/i },
  { intent: "exhaust", priority: 4, friction: "price_uncertainty", confidence: 0.85, re: /exhaust|muffler|catalytic|\bloud\b.{0,15}\bexhaust/i },
  { intent: "suspension_noise", priority: 5, friction: "price_uncertainty", confidence: 0.7, re: /suspension|struts?\b|shocks?\b|clunk\w*|rattl\w*|vibrat\w*|shak\w*|nois\w*/i },

  // ── Tier 4: operations / sales.
  { intent: "tow_in", priority: 4, friction: "transportation", confidence: 0.9, re: /\btow\w*/i },
  { intent: "ready_to_visit", priority: 5, friction: "no_active_friction", confidence: 0.8, re: /on my way|i'?m coming|be there in|heading over|omw\b/i },
  { intent: "drop_off", priority: 5, friction: "transportation", confidence: 0.8, re: /drop\s?(it|the car|my car)?\s?off|leave it (with|there)/i },
  { intent: "wait_time", priority: 5, friction: "wait_uncertainty", confidence: 0.8, re: /how long\b|\bwait\w*\b|how busy|backed up/i },
  { intent: "walk_in_same_day", priority: 5, friction: "wait_uncertainty", confidence: 0.75, re: /appointment|walk[- ]?in|come in (today|now)|\btoday\b|right now\b|squeeze me/i },
  { intent: "financing", priority: 4, friction: "financing", confidence: 0.9, re: /financ\w*|payment plans?|make payments|no credit|bad credit|credit check|snap\b|acima|koalafi/i },
  { intent: "price_comparison", priority: 4, friction: "price_uncertainty", confidence: 0.8, re: /another (shop|place)|cheaper (somewhere|else)|calling around|quoted me|beat that price/i },
  { intent: "estimate_question", priority: 4, friction: "price_uncertainty", confidence: 0.75, re: /\bestimates?\b|\bquotes?\b(?!.{0,10}\btire)/i },
  { intent: "parts_eta", priority: 4, friction: "wait_uncertainty", confidence: 0.8, re: /\bparts?\b.{0,20}\b(in|arriv\w*|come in|order\w*)|waiting on (the )?parts?/i },
  { intent: "pickup", priority: 5, friction: "no_active_friction", confidence: 0.75, re: /pick\s?(it|the car|my car)?\s?up|come get (it|my car)/i },
  { intent: "payment_invoice", priority: 5, friction: "price_uncertainty", confidence: 0.75, re: /\binvoices?\b|\breceipts?\b|\bbill\b|do you take (card|cash)|how (do i|can i) pay/i },
  { intent: "wrong_number", priority: 3, friction: "no_active_friction", confidence: 0.85, re: /wrong number|didn'?t call|not who i/i },
  { intent: "hours_location", priority: 6, friction: "no_active_friction", confidence: 0.8, re: /what time\b|\bhours?\b|(are )?you (open|clos\w*)|\baddress\b|where (are|you)\b|locat\w*|direction\w*/i },
  { intent: "general_repair", priority: 7, friction: "unknown", confidence: 0.5, re: /\bfix\w*|\brepair\w*|\bcheck\b.{0,15}\b(car|truck|van)\b|something wrong|\bissues?\b|\bproblems?\b/i },
];

const UNCLEAR: VoiceClassification = {
  intent: "unclear", secondary: [], friction: "unknown", confidence: 0, source: "none", matchedRule: null,
};

/**
 * Classify the caller's first substantive turn.
 *
 * Returns `unclear` with confidence 0 when nothing matches — deliberately NOT a
 * catch-all bucket. The residue is what the model tier is for, and its size is
 * itself a reported metric rather than something hidden inside a label.
 */
export function classifyVoiceDemand(firstTurn: string | null | undefined): VoiceClassification {
  if (typeof firstTurn !== "string") return UNCLEAR;
  const text = firstTurn.trim();
  if (text.length < 3) return UNCLEAR;

  const hits = RULES.filter((r) => r.re.test(text)).sort((a, b) => a.priority - b.priority);
  if (hits.length === 0) return UNCLEAR;

  const primary = hits[0]!;
  return {
    intent: primary.intent,
    secondary: hits.slice(1).map((r) => r.intent).filter((i) => i !== primary.intent),
    friction: primary.friction,
    // Multiple competing rules means genuine ambiguity, so shade confidence
    // down rather than presenting a coin-flip as certainty.
    confidence: hits.length > 2 ? Math.max(0.5, primary.confidence - 0.15) : primary.confidence,
    source: "deterministic",
    matchedRule: primary.intent,
  };
}

/** Below this, prefer the model tier / human adjudication over the rule's guess. */
export const LOW_CONFIDENCE = 0.7;

/** The taxonomy, for prompt construction and coverage reporting. */
export const VOICE_INTENTS: readonly VoiceIntent[] = [
  ...new Set(RULES.map((r) => r.intent)), "unclear",
] as const;
