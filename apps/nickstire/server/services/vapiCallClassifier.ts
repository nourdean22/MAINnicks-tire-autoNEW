import { scoreVapiQuality } from "./vapiMeasurement";

import {
  extractCustomerTurns,
  extractCustomerTurnsFromMessages,
  type CustomerTurns,
} from "./customerTurns";

export type VapiOutcomeCategory =
  | "hard_conversion"
  | "walk_in_directed"
  | "human_handoff"
  | "callback_needed"
  | "tire_availability_intent"
  | "quote_or_inspection_intent"
  | "resolved_info"
  | "lost_opportunity"
  | "spam_or_wrong_number"
  | "abandoned_before_connect"
  | "tech_failure"
  | "unknown";

export type VapiIntent =
  | "used_tire" | "new_tire" | "flat_tire" | "tire_leak"
  | "tire_size_request" | "brakes" | "diagnostics" | "check_engine"
  | "battery" | "alternator" | "starter" | "oil_change" | "alignment"
  | "suspension" | "emissions_echeck" | "ac_heat" | "exhaust"
  | "general_repair" | "pricing_question" | "hours_location" | "financing";

const INTENT_PATTERNS: Record<VapiIntent, RegExp> = {
  used_tire: /\b(used|second.?hand|pre.?owned)\b.*\b(tire|tires|rubber)\b|\b(tire|tires|rubber)\b.*\b(used|second.?hand|pre.?owned)\b/i,
  new_tire: /\b(new|brand.?new|fresh)\b.*\b(tire|tires|rubber)\b|\b(tire|tires|rubber)\b.*\b(new|brand.?new|fresh)\b/i,
  flat_tire: /\b(flat|puncture|nails?|screws?|flat.?tire)\b/i,
  tire_leak: /\b(leak|leaking|slow.?leak|losing.?air|loses.?air|defilat)\b/i,
  tire_size_request: /\b(size|r15|r16|r17|r18|r19|r20|width|aspect|ratio|rims?)\b|\b\d{3}\s*[\/\s]\s*\d{2}\s*r\s*\d{2}\b/i,
  brakes: /\b(brake|brakes|braking|pads?|rotors?|calipers?|squeak|grind|grinding|squeaking)\b/i,
  diagnostics: /\b(diagnos|check|scan|troubleshoot|noise|shake|shaking|vibrat|vibration|smell|clunk|symptom)\b/i,
  check_engine: /\b(check.?engine|engine.?light|obd|mil.?light)\b/i,
  battery: /\b(battery|dead.?battery|replace.?battery|test.?battery|jump|jumpstart)\b/i,
  alternator: /\b(alternator|not.?charging|battery.?light)\b/i,
  starter: /\b(starter|clicking|wont.?start|no.?start|crank|cranking)\b/i,
  oil_change: /\b(oil|lube|filter)\b.*\b(change|service)\b|\b(change|service)\b.*\b(oil|lube|filter)\b/i,
  alignment: /\b(aligns?|alignments?|pulling|pulls)\b/i,
  suspension: /\b(suspension|shocks?|struts?|ball.?joint|tie.?rod|control.?arm)\b/i,
  emissions_echeck: /\b(emission|emissions|echeck|e-check|fail|failed.?emissions)\b/i,
  ac_heat: /\b(ac|a.?c|freon|recharge|cold.?air|heater|heating|defrost|blower|air.?conditioning)\b/i,
  exhaust: /\b(exhaust|muffler|catalytic|converter|exhaust.?pipe|tailpipe)\b/i,
  general_repair: /\b(repair|fix|mechanic|service|shop)\b/i,
  pricing_question: /\b(prices?|pricing|costs?|charges?|quotes?|estimate|much.?is|how.?much)\b/i,
  hours_location: /\b(hours|close|open|location|address|directions|where|euclid|street|map|open.?tomorrow|what.?time)\b/i,
  financing: /\b(financ|snap|acima|easy.?pay|payment.?plan)\b/i,
};

export interface ClassificationInput {
  durationSeconds: number;
  endedReason: string | null;
  aiSummary: string | null;
  transcript: string | null;
  /** Legacy compatibility field. It is not proof that a lead exists. */
  convertedToLead?: number;
  leadId?: number | null;
  callbackId?: number | null;
  bookingId?: number | null;
  evalScore?: number | null;
  evalOutcome?: string | null;
  successEvaluation?: string | null;
  sentiment?: string | null;
  reachedTool?: boolean;
  /**
   * VAPI `artifact.messages` — role-tagged and therefore AUTHORITATIVE for
   * speaker attribution. Preferred over `transcript` whenever present: no
   * transcript-formatting change can misattribute a speaker in this shape.
   */
  messages?: unknown;
}

/**
 * Where the caller words came from. Exposed so coverage is MEASURABLE rather
 * than assumed: "unavailable" means we could not tell who spoke, which is not
 * the same as "the caller said nothing" and must never be scored as demand.
 */
export type SpeakerAttribution = "messages" | "transcript" | "unavailable";

export interface ClassificationResult {
  outcome: VapiOutcomeCategory;
  intents: VapiIntent[];
  /** Provenance of the customer speech this outcome was derived from. */
  speakerAttribution: SpeakerAttribution;
  score: number | null;
  reasoning: string;
  qualityVersion: string;
  qualityEvidence: string[];
}

export function detectIntents(text: string): VapiIntent[] {
  const matched: VapiIntent[] = [];
  for (const [intent, regex] of Object.entries(INTENT_PATTERNS)) {
    if (regex.test(text)) matched.push(intent as VapiIntent);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Per-call signal extraction — feeds the Missed Revenue Queue with the WHY.
// Deterministic regex (same cheap, testable style as detectIntents; no per-call
// AI cost) so every evaluated call is enriched with the objection that stalled
// it, any competitor named, and how price-sensitive the caller sounded. The
// operator working the queue sees the reason, not just "lost_opportunity".
// ---------------------------------------------------------------------------

export type CallObjection = "price" | "timing" | "trust" | "availability" | "competitor";
export type PriceSensitivity = "low" | "medium" | "high";

export interface CallSignals {
  objections: CallObjection[];
  competitorMentions: string[];
  priceSensitivity: PriceSensitivity;
}

const OBJECTION_PATTERNS: Record<CallObjection, RegExp> = {
  price: /\b(too (much|expensive|pricey|high)|can'?t afford|cheaper|expensive|out of (my )?budget|that'?s a lot|rip.?off|why so much|more than i)\b/i,
  timing: /\b(not (right )?now|maybe (later|next)|call (you )?back|think about it|another time|next (week|month|pay|time)|when i get paid|not today|get back to you)\b/i,
  trust: /\b(not sure|reviews?|reputation|scam|is it legit|second opinion|is that (right|necessary)|do i really need|why do i need)\b/i,
  availability: /\b(no (appointment|opening|slot)|fully booked|too long (a|of a) wait|how long('?s| is) the wait|no time|can'?t wait)\b/i,
  competitor: /\b(discount tire|monro|conrad'?s|mavis|belle tire|firestone|goodyear|ntb|pep boys|tire discounters|another (shop|place)|somewhere else|other (guys|shop|place))\b/i,
};

const COMPETITORS: { name: string; pat: RegExp }[] = [
  { name: "Discount Tire", pat: /\bdiscount tire\b/i },
  { name: "Monro", pat: /\bmonro\b/i },
  { name: "Conrad's", pat: /\bconrad'?s\b/i },
  { name: "Mavis", pat: /\bmavis\b/i },
  { name: "Belle Tire", pat: /\bbelle tire\b/i },
  { name: "Firestone", pat: /\bfirestone\b/i },
  { name: "Goodyear", pat: /\bgoodyear\b/i },
  { name: "NTB", pat: /\bntb\b/i },
  { name: "Pep Boys", pat: /\bpep boys\b/i },
  { name: "Tire Discounters", pat: /\btire discounters\b/i },
];

const PRICE_STRONG =
  /\b(too (much|expensive|pricey|high)|can'?t afford|cheaper|best price|lowest price|any (deals?|discounts?|coupons?)|out of (my )?budget|price match|beat (that|their) price)\b/i;
const PRICE_MENTION = /\b(prices?|pricing|costs?|how much|quote|estimate|charge|what.?do you charge)\b/i;

export function extractCallSignals(input: {
  transcript: string | null;
  summary?: string | null;
}): CallSignals {
  const text = `${input.transcript || ""} ${input.summary || ""}`.trim();
  if (!text) return { objections: [], competitorMentions: [], priceSensitivity: "low" };

  const objections: CallObjection[] = [];
  for (const [obj, re] of Object.entries(OBJECTION_PATTERNS)) {
    if (re.test(text)) objections.push(obj as CallObjection);
  }

  const competitorMentions = COMPETITORS.filter((c) => c.pat.test(text)).map((c) => c.name);

  const priceSensitivity: PriceSensitivity = PRICE_STRONG.test(text)
    ? "high"
    : PRICE_MENTION.test(text)
      ? "medium"
      : "low";

  return { objections, competitorMentions, priceSensitivity };
}

/**
 * Resolve the caller OWN words, preferring role-tagged messages.
 *
 * `unparsed` is load-bearing: it means we could not tell who said what, which
 * is NOT the same as "the caller said nothing". That difference decides whether
 * a call may enter the recovery queue at all.
 */
function resolveCustomerSpeech(input: ClassificationInput): CustomerTurns {
  if (input.messages !== undefined && input.messages !== null) {
    const fromMessages = extractCustomerTurnsFromMessages(input.messages);
    if (!fromMessages.unparsed) return fromMessages;
  }
  return extractCustomerTurns(input.transcript);
}

/**
 * THE SPEAKER-ATTRIBUTION RULE (2026-09-18).
 *
 * Demand may only ever be inferred from what the CUSTOMER said. Assistant
 * speech may only ever REMOVE a call from the queue, never add one.
 *
 * WHY THIS EXISTS — measured, not theorised. This function classified on
 * `transcript + aiSummary`, which contains Nick own turns. Nick greeting
 * necessarily names the shop or the address, and both were load-bearing:
 *
 *   "17625 Euclid Ave"   -> `euclid` matches inferredWalkIn -> walk_in_directed
 *   "Nick Tire & Auto"   -> `auto`   matches the fallback   -> lost_opportunity
 *
 * Both are Missed Revenue Queue candidates, so a call where the caller never
 * spoke produced a queue row — and so did a caller who only asked what time the
 * shop closes. The queue was measuring its own greeting: it could not emit "no
 * demand" for the exact case it existed to detect. `customerTurns.ts`
 * diagnosed this same contamination on 2026-07-26 ("aiSummary is written BY a
 * tire-first assistant, so keyword-counting it measures the assistant
 * vocabulary"), built the cure, documented `firstSubstantive` as "the field
 * demand classification should read" — then wired it only into the webhook
 * recorder, never into this decider. BUILT-UNWIRED; this closes it.
 *
 * Pinned by `vapiCallClassifierSpeakerAttribution.test.ts`, which mutates the
 * greeting and asserts the outcome does NOT move.
 */
export function classifyCall(input: ClassificationInput): ClassificationResult {
  const speech = resolveCustomerSpeech(input);
  /** The caller own words. The ONLY admissible evidence of demand. */
  const customerText = speech.turns.join(" ").trim();
  /**
   * Assistant-visible text. EXCLUSION-ONLY: may route a call OUT of the queue
   * (spam, technical failure) but must never route one in. Every read below
   * sits on a branch whose sole effect is to exclude.
   */
  const assistantVisibleText = `${input.transcript || ""} ${input.aiSummary || ""}`.trim();

  const intents = detectIntents(customerText);
  const lower = assistantVisibleText.toLowerCase();

  const isTechFailure =
    /silence-timed-out|assistant-error|websocket|error-/i.test(input.endedReason || "") ||
    ((/error|unable to hear|websocket closed/i.test(lower)) && input.durationSeconds < 20);
  const isSpamOrWrongNumber =
    /wrong number|spam|robocall|telemarket|solicitation|marketer/i.test(lower) ||
    ((input.transcript || "").toLowerCase().trim() === "hello" && input.durationSeconds < 15) ||
    ((input.transcript || "").trim().length < 3 && input.durationSeconds <= 2 && input.endedReason !== "assistant-forwarded-call");
  /**
   * Abandoned = the caller never got a substantive word in. `firstSubstantive`
   * already discards filler ("hello?", "yeah"), the most common opener while
   * the assistant is still connecting.
   *
   * Guarded by `!speech.unparsed`: when attribution failed we do not know
   * whether the caller spoke, so we must not assert that they did not.
   */
  const noCustomerSpeech = speech.firstSubstantive === null && !speech.unparsed;
  const isAbandoned =
    input.durationSeconds <= 5 ||
    (noCustomerSpeech && input.endedReason !== "assistant-forwarded-call");

  // Only persisted operational records prove capture. `convertedToLead` and
  // reachedTool remain accepted inputs for compatibility/diagnostics but do not
  // turn a tool interaction into a verified conversion.
  const verifiedCapture = input.leadId != null || input.callbackId != null || input.bookingId != null;
  /**
   * CUSTOMER text only. `euclid` stays in the pattern because a caller saying
   * "I can come to Euclid" is genuine walk-in intent — but Nick SAYING the shop
   * address no longer counts, which is what manufactured the queue.
   */
  const inferredWalkIn = /\b(swing by|pull up|drop.?off|FCFS|first-come|first.?serve|euclid|head over|come today|on my way|be right there)\b/i.test(customerText);
  const callbackIntent = /\b(call.?me.?back|call.?back|contact.?me|reach.?me)\b/i.test(customerText);

  let outcome: VapiOutcomeCategory = "unknown";
  const reasons: string[] = [];

  if (isTechFailure) {
    outcome = "tech_failure";
    reasons.push("technical_failure_signal");
  } else if (isSpamOrWrongNumber) {
    outcome = "spam_or_wrong_number";
    reasons.push("spam_or_misdial_signal");
  } else if (isAbandoned) {
    outcome = "abandoned_before_connect";
    reasons.push("ended_before_useful_connection");
  } else if (verifiedCapture) {
    outcome = "hard_conversion";
    reasons.push("persisted_operational_record");
  } else if (/forward/i.test(input.endedReason || "")) {
    outcome = "human_handoff";
    reasons.push("transfer_attempted");
  } else if (speech.unparsed && !customerText) {
    /**
     * Not one turn could be attributed. Demand is UNPROVEN, not absent.
     * `unknown` is deliberately NOT a queue candidate: a call we cannot read
     * must not manufacture an obligation — and must not be booked as "no
     * demand" either. `speakerAttribution:"unavailable"` makes the rate visible
     * so this can never become a silent hole in the denominator.
     */
    reasons.push("speaker_attribution_unavailable");
  } else if (inferredWalkIn) {
    outcome = "walk_in_directed";
    reasons.push("walk_in_language_detected");
  } else if (callbackIntent) {
    outcome = "callback_needed";
    reasons.push("callback_language_detected");
  } else if (intents.includes("used_tire") || intents.includes("new_tire") || intents.includes("tire_size_request")) {
    outcome = "tire_availability_intent";
    reasons.push("tire_intent_detected");
  } else if (intents.some((intent) => !["hours_location", "financing", "general_repair"].includes(intent))) {
    outcome = "quote_or_inspection_intent";
    reasons.push("service_or_quote_intent_detected");
  } else if (intents.includes("hours_location") || /\b(hours|address|directions|close|open)\b/i.test(customerText)) {
    outcome = "resolved_info";
    reasons.push("operational_information_request");
  } else if (intents.length > 0 || /\b(fix|repair|car|auto)\b/i.test(customerText)) {
    outcome = "lost_opportunity";
    reasons.push("customer_intent_without_next_step");
  } else {
    reasons.push("insufficient_outcome_evidence");
  }

  const customerConversation = !isSpamOrWrongNumber && !isAbandoned;
  const usefulNextStep = verifiedCapture || input.reachedTool === true || inferredWalkIn || callbackIntent ||
    outcome === "human_handoff" || outcome === "resolved_info";
  const quality = scoreVapiQuality({
    isCustomerConversation: customerConversation,
    technicalFailure: isTechFailure,
    greeted: input.durationSeconds > 0,
    intentIdentified: intents.length > 0 || outcome === "resolved_info",
    usefulNextStep,
    escalationAppropriate: outcome === "human_handoff" || input.callbackId != null,
    successEvaluation: input.successEvaluation,
    sentiment: input.sentiment,
    durationSeconds: input.durationSeconds,
  });

  const speakerAttribution: SpeakerAttribution = speech.unparsed
    ? "unavailable"
    : input.messages !== undefined && input.messages !== null
        && !extractCustomerTurnsFromMessages(input.messages).unparsed
      ? "messages"
      : "transcript";

  return {
    outcome,
    intents,
    speakerAttribution,
    score: quality.score,
    reasoning: [
      `outcome=${outcome}`,
      `speaker=${speakerAttribution}`,
      `evidence=${reasons.join(",")}`,
      `quality=${quality.score ?? "unavailable"}`,
      `quality_version=${quality.version}`,
    ].join(" · "),
    qualityVersion: quality.version,
    qualityEvidence: quality.evidence,
  };
}