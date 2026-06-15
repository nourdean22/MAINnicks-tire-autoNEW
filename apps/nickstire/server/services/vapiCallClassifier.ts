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
  | "used_tire"
  | "new_tire"
  | "flat_tire"
  | "tire_leak"
  | "tire_size_request"
  | "brakes"
  | "diagnostics"
  | "check_engine"
  | "battery"
  | "alternator"
  | "starter"
  | "oil_change"
  | "alignment"
  | "suspension"
  | "emissions_echeck"
  | "ac_heat"
  | "exhaust"
  | "general_repair"
  | "pricing_question"
  | "hours_location"
  | "financing";

// Service Intent Classifier Patterns
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
  convertedToLead?: number;
  leadId?: number | null;
  callbackId?: number | null;
  bookingId?: number | null;
  evalScore?: number | null;
  evalOutcome?: string | null;
  successEvaluation?: string | null;
  sentiment?: string | null;
  reachedTool?: boolean;
}

export interface ClassificationResult {
  outcome: VapiOutcomeCategory;
  intents: VapiIntent[];
  score: number | null;
  reasoning: string;
}

/**
 * Detect all service intents in a call.
 */
export function detectIntents(text: string): VapiIntent[] {
  const matched: VapiIntent[] = [];
  for (const [intent, regex] of Object.entries(INTENT_PATTERNS)) {
    if (regex.test(text)) {
      matched.push(intent as VapiIntent);
    }
  }
  return matched;
}

/**
 * Core call classifier and quality scorer.
 */
export function classifyCall(input: ClassificationInput): ClassificationResult {
  const text = `${input.transcript || ""} ${input.aiSummary || ""}`.trim();
  const intents = detectIntents(text);

  // 1. Detect Abandoned
  const isAbandoned =
    input.durationSeconds <= 5 ||
    (!text && input.endedReason !== "assistant-forwarded-call");

  // 2. Detect Tech Failure
  const isTechFailure =
    /silence-timed-out|assistant-error|websocket|error-/i.test(input.endedReason || "") ||
    /error|unable to hear|websocket closed/i.test(text.toLowerCase()) && input.durationSeconds < 20;

  // 3. Detect Spam / Wrong Number
  const isSpamOrWrongNumber =
    /wrong number|spam|robocall|telemarket|solicitation|marketer/i.test(text.toLowerCase()) ||
    ((input.transcript || "").toLowerCase().trim() === "hello" && input.durationSeconds < 15);

  // Determine outcome taxonomy
  let outcome: VapiOutcomeCategory = "unknown";
  let reasoningParts: string[] = [];

  // Check state writes
  const isHardConversion =
    input.convertedToLead === 1 ||
    input.leadId != null ||
    input.callbackId != null ||
    input.bookingId != null ||
    input.reachedTool === true ||
    /booked|callback_scheduled/i.test(input.evalOutcome || "");

  if (isTechFailure) {
    outcome = "tech_failure";
    reasoningParts.push("Technical Failure: call ended due to silence-timeout, assistant error, or audio websocket issues");
  } else if (isSpamOrWrongNumber) {
    outcome = "spam_or_wrong_number";
    reasoningParts.push("Spam/Wrong Number: transcript indicates robocall, wrong number, or spam");
  } else if (isAbandoned) {
    outcome = "abandoned_before_connect";
    reasoningParts.push("Abandoned: call ended before audio connect or <= 5s duration");
  } else if (isHardConversion) {
    outcome = "hard_conversion";
    reasoningParts.push("Hard Conversion: write tool call or DB link confirmed");
  } else if (/forward/i.test(input.endedReason || "")) {
    outcome = "human_handoff";
    reasoningParts.push("Human Handoff: call forwarded to shop line");
  } else if (/\b(swing by|pull up|drop.?off|FCFS|first-come|first.?serve|euclid|head over|come today)\b/i.test(text)) {
    outcome = "walk_in_directed";
    reasoningParts.push("Walk-In Directed: customer instructed to visit or drop off on a first-come, first-served basis");
  } else if (/\b(call.?me.?back|call.?back|contact.?me|reach.?me)\b/i.test(text)) {
    outcome = "callback_needed";
    reasoningParts.push("Callback Needed: customer requested callback or left contact info");
  } else if (intents.includes("used_tire") || intents.includes("new_tire") || intents.includes("tire_size_request")) {
    outcome = "tire_availability_intent";
    reasoningParts.push("Tire Availability Intent: customer asked about tires or sizes without immediate booking/visit");
  } else if (
    intents.includes("brakes") ||
    intents.includes("diagnostics") ||
    intents.includes("oil_change") ||
    intents.includes("alignment") ||
    intents.includes("battery") ||
    intents.includes("alternator") ||
    intents.includes("starter") ||
    intents.includes("pricing_question") ||
    intents.includes("ac_heat") ||
    intents.includes("exhaust") ||
    intents.includes("suspension") ||
    intents.includes("check_engine") ||
    intents.includes("emissions_echeck")
  ) {
    outcome = "quote_or_inspection_intent";
    reasoningParts.push("Quote or Inspection Intent: customer asked about repairs, checks, or pricing without immediate booking/visit");
  } else if (/\b(hours|address|directions|close|open|directions)\b/i.test(text)) {
    outcome = "resolved_info";
    reasoningParts.push("Resolved Info: basic operational details provided and resolved");
  } else if (intents.length > 0 || /\b(fix|repair|car|auto)\b/i.test(text)) {
    outcome = "lost_opportunity";
    reasoningParts.push("Lost Opportunity: customer had intent but call ended without conversions, walk-in steps, or callback");
  } else {
    outcome = "unknown";
    reasoningParts.push("Unknown outcome: fell through all filters");
  }

  // Scoring Logic
  let score: number | null = null;
  if (outcome !== "abandoned_before_connect" && outcome !== "spam_or_wrong_number" && outcome !== "tech_failure") {
    // Valid Customer Conversation
    let baseScore = 40;
    if (outcome === "hard_conversion") baseScore = 95;
    else if (outcome === "walk_in_directed") baseScore = 85;
    else if (outcome === "human_handoff") baseScore = 80;
    else if (outcome === "resolved_info") baseScore = 75;
    else if (outcome === "callback_needed") baseScore = 70;
    else if (outcome === "tire_availability_intent" || outcome === "quote_or_inspection_intent") baseScore = 60;

    let modifiers = 0;
    if (input.sentiment === "positive") {
      modifiers += 5;
      reasoningParts.push("+5 sentiment=positive");
    } else if (input.sentiment === "negative") {
      modifiers -= 10;
      reasoningParts.push("-10 sentiment=negative");
    }

    if (input.durationSeconds >= 30 && input.durationSeconds <= 180) {
      modifiers += 5;
      reasoningParts.push("+5 productive duration");
    } else if (input.durationSeconds > 300) {
      modifiers -= 5;
      reasoningParts.push("-5 long duration");
    }

    score = Math.max(0, Math.min(100, baseScore + modifiers));
    reasoningParts.unshift(`Scored ${score}/100 based on outcome=${outcome}.`);
  } else {
    reasoningParts.unshift("Quality Score Excluded (Non-customer call, hangup, or technical failure).");
  }

  return {
    outcome,
    intents,
    score,
    reasoning: reasoningParts.join(" · "),
  };
}
