/**
 * What every OUTBOUND AI-voice call must say and offer — 47 CFR 64.1200(b)
 * (Q-45, 2026-09-23; text read from law.cornell.edu/cfr/text/47/64.1200).
 *
 * FCC 24-17 (2024-02-08) holds that an AI-generated voice is an "artificial
 * voice", so every call `placeVapiOutboundCall` places is an "artificial or
 * prerecorded voice telephone message" under 64.1200(b):
 *
 *   (b)(1) "At the beginning of the message, state clearly the identity of the
 *          business ... responsible for initiating the call."
 *   (b)(2) "During or after the message, state clearly the telephone number
 *          ... of such business" (not the autodialer's line).
 *   (b)(3) On telemarketing / advertising calls: "an automated, interactive
 *          voice- and/or key press-activated opt-out mechanism ... including
 *          brief explanatory instructions ... within two (2) seconds of
 *          providing the identification information". When used, it "must
 *          automatically record the called person's number to the caller's
 *          do-not-call list and immediately terminate the call". A message left
 *          on voicemail "must also provide a toll free number" that reaches
 *          that mechanism.
 *
 * The shop has no toll-free number, so a SALES lane leaves no voicemail at all
 * (placeVapiOutboundCall clears the message; Vapi then hangs up on detection).
 *
 * This module is pure: the words and the lane classification, nothing that
 * dials. The mechanism is the `recordDoNotCall` tool (services/vapi.ts) and its
 * handler (routes/webhooks/vapi.ts), plus the end-of-call transcript check
 * below for an opt-out the model failed to act on.
 */
import { BUSINESS } from "@shared/business";
import { CUSTOMER_PREFIX } from "./customerTurns";

/** Every code path that places an outbound AI-voice call, by lane. */
export type OutboundLane = "voice_recovery" | "followup_cadence" | "followup_manual" | "confirmation";

/**
 * How each lane is classified — an engineering call pending counsel (§10.3 of
 * the 2026-09-23 estate architecture). "sales" gets the full (b)(3) treatment;
 * the do-not-call tool and the stop-calling instruction in the prompt are on
 * EVERY lane regardless.
 *
 *   voice_recovery    sales — re-pitches a quote the customer did not accept.
 *   followup_cadence  sales — a "trust call" that ends in a referral ask ("send
 *                     'em our way"), which introduces an advertisement.
 *   followup_manual   sales — the same assistant and prompt, dialled from the
 *                     admin button (makeFollowUpCall).
 *   confirmation      informational — asks about a visit the customer booked.
 */
const OUTBOUND_LANE_CLASS: Record<OutboundLane, "sales" | "informational"> = {
  voice_recovery: "sales",
  followup_cadence: "sales",
  followup_manual: "sales",
  confirmation: "informational",
};

export function isSalesLane(lane: OutboundLane): boolean {
  return OUTBOUND_LANE_CLASS[lane] === "sales";
}

/** The Vapi function the assistant calls when the person asks not to be called. */
export const DO_NOT_CALL_TOOL_NAME = "recordDoNotCall";

/** The business name as it should be SPOKEN ("&" is read inconsistently by TTS). */
export const SPOKEN_BUSINESS_NAME = BUSINESS.name.replace(/\s*&\s*/g, " and ");

/** The shop's callback number — the landline, not the Vapi line that dials. */
export const CALLBACK_NUMBER = BUSINESS.phone.display;

/**
 * The first thing the called person hears. Order is the rule's order:
 * identity first (b)(1); on a sales lane the opt-out instruction in the very
 * next sentence (b)(3); then the recording notice and the callback number
 * (b)(2); then the lane's own words.
 */
export function buildOutboundOpener(params: { lane: OutboundLane; customerName?: string | null; body: string }): string {
  const first = (params.customerName ?? "").trim().split(/\s+/)[0] ?? "";
  const parts = [`Hi${first ? ` ${first}` : ""}, this is ${SPOKEN_BUSINESS_NAME} calling.`];
  if (isSalesLane(params.lane)) {
    parts.push(`If you'd rather we not call, just say "stop calling" at any time and we'll take you off our list.`);
  }
  parts.push(`This call may be recorded, and you can reach the shop at ${CALLBACK_NUMBER}.`);
  const body = params.body.trim();
  if (body) parts.push(body);
  return parts.join(" ");
}

/**
 * Appended to EVERY outbound system prompt (services/vapi.ts followUpModelBlock),
 * so no lane prompt can omit it. Stated as overriding the lane's own flow
 * because several lanes say "never push back" / "end gracefully" in ways a
 * model could read as licence to talk past an opt-out.
 */
export const OUTBOUND_COMPLIANCE_PROMPT = [
  `# DO NOT CALL — overrides everything above`,
  `If the person says anything like "stop calling", "don't call me", "take me off your list", "remove my number", "do not call" or "don't contact me", call ${DO_NOT_CALL_TOOL_NAME} IMMEDIATELY. Do not ask why, do not argue, do not finish the conversation first. The tool says goodbye and ends the call.`,
  ``,
  `# VOICEMAIL`,
  `If you reach voicemail, an answering machine or an automated greeting, call endOnVoicemail right away. Never improvise a message.`,
  ``,
  `# CALLBACK NUMBER`,
  `The shop's number is ${CALLBACK_NUMBER}. Give it whenever they ask how to reach us.`,
].join("\n");

/**
 * Plain-English do-not-call requests, matched against what the CUSTOMER said
 * (never the assistant — the opener itself says "stop calling"), on INBOUND
 * and OUTBOUND calls alike: 47 CFR 64.1200(a)(10) lets a called party revoke
 * consent "by using any reasonable method to clearly express a desire not to
 * receive further calls or text messages", and (d)(3) requires the request to
 * be recorded "at the time the request is made" — neither cares who dialled.
 *
 * Deliberately phrase-shaped rather than keyword-shaped: "stop" alone is how
 * people interrupt ("stop, stop — who is this?"), and a bare keyword would
 * suppress numbers that never asked. The model's recordDoNotCall tool is the
 * primary mechanism; this is the safety net behind it.
 *
 * DIRECTION OF ERROR. Where a phrase is ambiguous it resolves to "voice": a
 * wrong voice suppression costs one call, a missed one is a TCPA violation.
 * It resolves to "all" only when the words name texts/contact generally (or
 * the pre-existing broad forms: unsubscribe, opt out, remove my number).
 * The table in outboundCallCompliance.matcher.test.ts is the contract.
 *
 * Pipeline: normalise → blank the spans that LOOK like a request but are not
 * one (negations, complaints, questions, a request aimed at something that is
 * not our contact list) → every remaining arm votes; "all" beats "voice".
 */
export type SpokenOptOutScope = "voice" | "all";

/** "call"-only targets: a request aimed at these suppresses calls, not texts. */
const CALL_ONLY_TARGET =
  /^\s+(?:off\s+of|off|from|of|on|to)\s+(?:(?:the|your|y'all'?s|this|these|those|that|all|any|of|my)\s+)*(?:(?:call(?:ing)?|phone|robo\s*-?\s*call|do\s+not\s+call|do-not-call|dnc|no\s+call)\s+(?:lists?|registry)|(?:(?:phone|robo|sales|marketing|automated|reminder)\s*-?\s*)?(?:calls|calling|robocalls))\b/;

/** What a targeted request ("opt out of X", "take me off X") may name for it to be about US contacting them. */
const CONTACT_TARGET =
  /^(?:(?:the|your|y'all'?s|this|these|those|that|all|any|of|my|our)\s+)*(?:(?:call(?:ing)?|phone|contact|mailing|text(?:ing)?|sms|message|marketing|sales|promo(?:tional)?|reminder|appointment|confirmation|follow-?up|robo\s*-?\s*call|automated|do\s+not\s+call|do-not-call|dnc|no\s+call)\s+)*(?:lists?|calls?|calling|texts?|messages?|marketing|communications?|contacts?|reminders?|system|database|records|registry|everything|all|it|this|that|them|here)\b/;

/** Courtesy words after "take me off" — "take me off please" is still a request. */
const FILLER = /^(?:please|pls|now|right\s+now|already|immediately|asap|then|too|today|ok(?:ay)?|thanks?|thank\s+you|and|man|bro|sir|ma'?am|for\s+good|permanently|completely|entirely)\b/;

/** A request verb that names its target. A non-contact target blanks the verb. */
const TARGETED_REQUEST =
  /\b(?:opt\s*(?:me\s+)?out\s+of|unsubscribe(?:\s+me)?\s+(?:from|to)|(?:remove|delete|take)\s+(?:me|my\s+(?:phone\s+|cell\s+)?number|this\s+number)\s+(?:off\s+of|off|from))\s+/g;

// Do not turn a customer's explicit negation into the opposite instruction.
// The positive phrase matcher intentionally sees substrings such as
// "stop calling", so "don't stop calling me" would otherwise suppress them.
const NEGATED_SPOKEN_OPT_OUT =
  /\b(?:do\s+not|don'?t|never)\s+(?:want\s+(?:(?:you|us)\s+)?to\s+)?(?:stop\s+(?:calling|texting|contacting|messaging|bothering)|unsubscribe(?:\s+me)?|opt\s+(?:me\s+)?out|take\s+(?:me|my\s+(?:phone\s+)?number)\s+off|remove\s+(?:me|my\s+(?:phone\s+)?number)|delete\s+my\s+(?:phone\s+)?number)\b/g;

/** Words that contain a request shape but are not a request to us. */
const NOT_A_REQUEST: RegExp[] = [
  // A complaint that we DON'T call: "you guys never call me back", "if you don't call me back".
  /\b(?:you|y'all|they|he|she|it|nobody|no\s+one|someone|somebody|u)\s+(?:guys\s+|all\s+)?(?:never|don'?t|do\s+not|didn'?t|did\s+not|won'?t|wouldn'?t|haven'?t|hasn'?t|doesn'?t)\s+(?:ever\s+|even\s+)?(?:call|calling|called|text|texting|texted|contact|contacted)\b/g,
  // A form of address: "don't call me sir".
  /\b(?:don'?t|do\s+not)\s+call\s+me\s+(?:sir|ma'?am|mister|mr|mrs|ms|miss|boss|buddy|bud|hon|honey|dear|dude|by\s+my|that)\b/g,
  // The customer describing their own habit: "I don't call ahead".
  /\b(?:i|we)\s+(?:do\s+not|don'?t|never)\s+call\b/g,
  // A question about what already happened: "did you lose my number?"
  /\b(?:did|didn'?t|why\s+did|how\s+did|why'?d|how'?d)\s+(?:you|y'all|they|u)\s+(?:guys\s+)?(?:lose|delete|remove)\s+my\s+(?:phone\s+)?number\b/g,
  // The customer promising to stop calling US: "sorry, I'll stop calling you guys".
  /\b(?:i'?ll|i\s+will|i'?m\s+gonna|i\s+am\s+going\s+to|let\s+me|i\s+should|i'?d\s+better)\s+stop\s+(?:calling|texting|bothering|contacting|messaging)\b/g,
];

type Arm = { re: RegExp; scope: SpokenOptOutScope | "target" };

/** "target" = "all" unless the words right after name calls only (then "voice"). */
const ARMS: Arm[] = [
  { re: /\b(?:stop|quit|cease)\s+(?:calling|ringing|phoning|call\s+me)\b/g, scope: "voice" },
  { re: /\b(?:stop|quit|cease)\s+(?:contacting|texting|messaging)\b/g, scope: "all" },
  { re: /\b(?:stop|quit|cease)\s+(?:bothering|harassing)\s+(?:me|us)\b/g, scope: "voice" },
  { re: /\b(?:do\s*n[o']?t|don'?t|never|no\s+more)\s+(?:ever\s+)?(?:call|calling|ring|phone)\s+(?:me|us|this\s+number|here|again|anymore|any\s+more|back)\b/g, scope: "voice" },
  { re: /\b(?:do\s*n[o']?t|don'?t|never|no\s+more)\s+(?:ever\s+)?(?:contact|contacting|text|texting|message|messaging)\s+(?:me|us|this\s+number|here|again|anymore|any\s+more|back)\b/g, scope: "all" },
  // "stop calling and texting me", "don't call or text me".
  { re: /\b(?:stop|quit|cease|don'?t|do\s+not|never|no\s+more)\s+(?:call|calling)\s+(?:(?:me|us)\s+)?(?:and|or|&|n)\s+(?:text|texting|message|messaging|contact|contacting)\b(?!\s+(?:me\s+)?instead)/g, scope: "all" },
  { re: /\bdo\s+not\s+call\b|\bdo-not-call\b|\bdnc\s+list\b/g, scope: "voice" },
  { re: /\b(?:take|put|remove)\s+(?:me|my\s+(?:phone\s+)?number|this\s+number)\s+(?:off|from|on)\s+(?:of\s+)?(?:your|the)\s+(?:call(?:ing)?\s+|do\s+not\s+call\s+)list\b/g, scope: "voice" },
  { re: /\b(?:take|put|remove)\s+(?:me|my\s+(?:phone\s+)?number|this\s+number)\s+(?:off|from)\s+(?:of\s+)?(?:your|the)\s+(?:(?:contact|mailing|text|message|sms)\s+)?list\b/g, scope: "all" },
  { re: /\btake\s+(?:me|my\s+(?:phone\s+|cell\s+)?number|this\s+number)\s+off\b/g, scope: "voice" },
  { re: /\b(?:remove|delete|lose)\s+(?:me|my\s+(?:phone\s+|cell\s+)?number|this\s+number)\b/g, scope: "target" },
  { re: /\bunsubscribe(?:\s+me)?\b/g, scope: "target" },
  { re: /\bopt\s*(?:me\s+)?out\b/g, scope: "target" },
  { re: /\bno\s+more\s+(?:phone\s+|robo\s*-?\s*|sales\s+|automated\s+)?(?:calls|calling|robocalls)\b/g, scope: "voice" },
  { re: /\bno\s+more\s+(?:texts|text\s+messages|messages)\b/g, scope: "all" },
  { re: /\b(?:stop|quit|enough|end)\s+(?:it\s+)?(?:with\s+)?(?:the|these|those|all\s+(?:of\s+)?(?:the|these|those)|your|y'all'?s?)\s+(?:phone\s+|robo\s*-?\s*|sales\s+|automated\s+)?(?:calls|calling|robocalls)\b/g, scope: "voice" },
  { re: /\b(?:stop|quit|enough|end)\s+(?:it\s+)?(?:with\s+)?(?:the|these|those|all\s+(?:of\s+)?(?:the|these|those)|your|y'all'?s?)\s+(?:texts|text\s+messages|messages)\b/g, scope: "all" },
  { re: /\b(?:do\s+not|don'?t|never)\s+(?:want|need)\s+(?:any\s+(?:more\s+)?|no\s+(?:more\s+)?|more\s+|these\s+|your\s+|the\s+)?(?:phone\s+|robo\s*-?\s*|sales\s+|automated\s+)?(?:calls|robocalls)\b/g, scope: "voice" },
  { re: /\b(?:do\s+not|don'?t|never)\s+(?:want|need)\s+(?:any\s+(?:more\s+)?|no\s+(?:more\s+)?|more\s+|these\s+|your\s+|the\s+)?(?:texts|text\s+messages|messages)\b/g, scope: "all" },
  { re: /\b(?:do\s+not|don'?t)\s+want\s+(?:you|y'all|you\s+guys|anyone|anybody|nobody)\s+(?:to\s+)?(?:call|calling|ringing|phoning)\b/g, scope: "voice" },
  { re: /\b(?:do\s+not|don'?t)\s+want\s+(?:you|y'all|you\s+guys|anyone|anybody|nobody)\s+(?:to\s+)?(?:text|texting|message|messaging|contact|contacting)\b/g, scope: "all" },
  { re: /\b(?:do\s+not|don'?t)\s+want\s+to\s+be\s+called\b/g, scope: "voice" },
  { re: /\b(?:do\s+not|don'?t)\s+want\s+to\s+be\s+(?:contacted|texted)\b/g, scope: "all" },
  { re: /\bleave\s+me\s+alone\b/g, scope: "voice" },
  // Spanish: "no me llame(n)", "no me vuelvan a llamar", "deja de llamarme".
  { re: /\bno\s+me\s+(?:vuelvan?\s+a\s+)?llam(?:e|es|en|ar)\b|\bdej(?:a|e|en)\s+de\s+llamar(?:me)?\b/g, scope: "voice" },
];

const normalizeSpokenOptOut = (utterance: string) =>
  utterance.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");

/** Blank a targeted request whose target is not our contact list ("remove me from the waitlist"). */
function blankNonContactTargets(t: string): string {
  return t.replace(TARGETED_REQUEST, (m, offset: number) => {
    const rest = t.slice(offset + m.length);
    return FILLER.test(rest) || CONTACT_TARGET.test(rest) ? m : " ".repeat(m.length);
  });
}

export function spokenOptOutScope(utterance: string): SpokenOptOutScope | null {
  let t = normalizeSpokenOptOut(utterance);
  // Negation is clause-local, not utterance-wide. Remove only phrases such as
  // "don't stop calling" and still inspect the rest of a mixed instruction
  // ("..., but stop texting me") for an actionable opt-out.
  t = t.replace(NEGATED_SPOKEN_OPT_OUT, " ");
  for (const re of NOT_A_REQUEST) t = t.replace(re, " ");
  t = blankNonContactTargets(t);

  let scope: SpokenOptOutScope | null = null;
  for (const { re, scope: armScope } of ARMS) {
    for (const m of t.matchAll(re)) {
      const s = armScope === "target" ? (CALL_ONLY_TARGET.test(t.slice(m.index! + m[0].length)) ? "voice" : "all") : armScope;
      if (s === "all") return "all";
      scope = "voice";
    }
  }
  return scope;
}

export function isSpokenOptOut(utterance: string): boolean {
  return spokenOptOutScope(utterance) !== null;
}

/**
 * EVERY customer line from an end-of-call report — uncapped, unlike
 * customerTurns.ts (which keeps 12 for analytics; an opt-out in turn 13 must
 * still count). Same role and prefix rules as that module: role-tagged
 * `artifact.messages` first, the flat transcript's caller lines as fallback,
 * and anything not explicitly the caller excluded. [] means "nothing to check".
 */
export function customerUtterances(event: {
  artifact?: { messages?: unknown; transcript?: unknown };
  transcript?: unknown;
}): string[] {
  const msgs = event.artifact?.messages;
  if (Array.isArray(msgs) && msgs.length > 0) {
    const out: string[] = [];
    for (const m of msgs) {
      const role = String((m as { role?: unknown })?.role ?? "").toLowerCase();
      if (role !== "user" && role !== "customer" && role !== "human") continue;
      const raw = (m as { message?: unknown })?.message ?? (m as { content?: unknown })?.content ?? (m as { text?: unknown })?.text;
      if (typeof raw === "string" && raw.trim()) out.push(raw);
    }
    return out;
  }
  const flat = event.artifact?.transcript ?? event.transcript ?? "";
  if (typeof flat !== "string") return [];
  return flat
    .split(/\r?\n/)
    .filter((l) => CUSTOMER_PREFIX.test(l))
    .map((l) => l.replace(CUSTOMER_PREFIX, ""))
    .filter((l) => l.trim());
}
