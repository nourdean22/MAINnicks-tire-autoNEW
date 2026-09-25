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
 * (never the assistant — the opener itself says "stop calling").
 *
 * Deliberately phrase-shaped rather than keyword-shaped: "stop" alone is how
 * people interrupt ("stop, stop — who is this?"), and a bare keyword would
 * suppress numbers that never asked. Missing a phrasing costs a call the model
 * should have caught with the tool; the model is the primary mechanism and
 * this is the safety net behind it.
 */
const SPOKEN_OPT_OUT_PATTERNS: RegExp[] = [
  /\bstop\s+(?:calling|call(?:ing)?\s+me|contacting|texting|bothering)\b/,
  /\b(?:do\s*n[o']?t|don'?t|never|quit|no\s+more)\s+(?:call|calling|contact|contacting|text|texting)\s+(?:me|us|this\s+number|here|again)\b/,
  /\bdo\s+not\s+call\b/,
  /\b(?:take|put|remove)\s+(?:me|my\s+(?:phone\s+)?number|this\s+number)\s+(?:off|from|on)\s+(?:of\s+)?(?:your|the)\s+(?:call(?:ing)?\s+|contact\s+|mailing\s+|do\s+not\s+call\s+)?list\b/,
  /\bremove\s+(?:me|my\s+(?:phone\s+)?number|this\s+number)\b/,
  /\bunsubscribe\b/,
  /\bopt\s*(?:me\s+)?out\b/,
];

export function isSpokenOptOut(utterance: string): boolean {
  const t = utterance.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  return SPOKEN_OPT_OUT_PATTERNS.some((re) => re.test(t));
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
