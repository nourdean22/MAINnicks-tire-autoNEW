/**
 * SMS FACT COMPILER — build the follow-up text from FACTS, never from wishes.
 *
 * WHAT IT REPLACES. `getSmsDraft()` in `client/src/pages/admin/
 * VoiceReceptionistSection.tsx` — eight hardcoded paragraphs selected by intent
 * flag, interpolating nothing. Audited 2026-09-18, it had four defects:
 *
 *   1. ZERO personalisation. The caller's vehicle, tire size, quantity and
 *      urgency were all extracted and then thrown away. A caller who spent two
 *      minutes spelling out "215/60R17, two of them, used, for a 2023 HR-V" got
 *      a paragraph that named none of it.
 *   2. HARDCODED HOURS. The diagnostics branch said "before 6 PM today". The
 *      shop closes at 4 PM on Sundays (`BUSINESS.hours.structured`), so that
 *      sentence was false one day in seven — the same class of defect this repo
 *      has already fixed twice elsewhere.
 *   3. UNVERIFIED BUSINESS CLAIMS. "We stock all major brands", "flat repairs
 *      are done while you wait", "free battery and alternator test". These are
 *      inventory, capacity and pricing promises, typed into a React component
 *      where the server-side voice claim guard cannot see them.
 *   4. NO OPT-OUT. Not one of the eight carried opt-out language.
 *
 * THE RULE. This compiler may state only three kinds of thing:
 *   · OBSERVED — what the caller actually said, passed in as facts;
 *   · CANONICAL — address, phone and TODAY'S REAL HOURS, from `BUSINESS`;
 *   · ASKS — a question, or an invitation to come in.
 * It may never assert stock, price, wait time, or that a repair will fix a
 * symptom. Those require a human or a tool, and `refusedClaims` records what it
 * deliberately declined to say so the operator can see the restraint.
 *
 * Pure and browser-safe, so the admin preview renders the EXACT string the
 * server will send. A preview that differs from the send is not a preview.
 */
import { BUSINESS } from "./business";
import { businessState } from "./shopState";

/** Observed facts. Every field is optional because extraction is imperfect. */
export interface ObservedCallFacts {
  customerName?: string | null;
  /** e.g. "215/60R17" — as the caller said it. */
  tireSize?: string | null;
  /** e.g. "2023 Honda HR-V". */
  vehicle?: string | null;
  quantity?: number | null;
  condition?: "new" | "used" | null;
  /** The caller's own words for the problem, e.g. "grinding when I brake". */
  symptom?: string | null;
  urgency?: "today" | "this_week" | "flexible" | null;
  /** VERIFIED failure — never inferred from `assistant-forwarded-call`. */
  transferFailed?: boolean;
  callbackRequested?: boolean;
  /** Caller's vehicle is already at the shop. */
  existingVehicleAtShop?: boolean;
}

export type SmsBlocker =
  | "opted_out"
  | "quiet_hours"
  | "no_consent_basis"
  | "safety_lane_requires_human"
  | "nothing_to_say";

export interface CompiledSms {
  /** The message. Empty string when `blockers` is non-empty. */
  body: string;
  /** Which observed facts were actually used — the audit trail for the text. */
  usedFacts: string[];
  /**
   * Claims this compiler deliberately did NOT make, though a template might
   * have. Rendered in the admin "why this text" drawer.
   */
  refusedClaims: string[];
  blockers: SmsBlocker[];
  /** GSM-7 segment estimate, so a 4-segment message never ships unnoticed. */
  segments: number;
}

export interface CompileOptions {
  now: Date;
  /** Caller has opted out. Hard block — checked again at the send chokepoint. */
  optedOut?: boolean;
  /** Outside the shop's sending window. Queue rather than send. */
  outsideSendingWindow?: boolean;
  /** First message in this thread — opt-out language is required. */
  isFirstInThread?: boolean;
  /** A safety signal was raised. A human handles it; no automation. */
  safetyFlag?: boolean;
}

/** CTIA Messaging Principles §5.1.3 — standardised STOP wording. */
const OPT_OUT = "Reply STOP to opt out.";

/**
 * Claims that are permanently off-limits to an automated draft. Recorded on
 * every compile so the restraint is visible rather than implicit.
 */
const REFUSED = {
  stock: "did not claim the tire is in stock — rack state is not digitally authoritative",
  price: "did not quote a price — no verified quote existed for this call",
  wait: "did not promise a wait time or same-day completion",
  diagnosis: "did not diagnose the symptom over the phone",
} as const;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Today's REAL closing time, or null when shut. Never a hardcoded "6 PM". */
export function todayHoursPhrase(now: Date): string | null {
  const st = businessState(now, BUSINESS.timezone, BUSINESS.hours.structured);
  if (st.state === "open" && st.nextChange) return `We're open today — ${st.nextChange}`;
  if (st.nextChange) return `We open ${st.nextChange}`;
  return null;
}

/** Describe what the caller asked for, in their terms. */
function describeRequest(f: ObservedCallFacts): { text: string; used: string[] } {
  const used: string[] = [];
  const bits: string[] = [];

  if (f.quantity && f.quantity > 0) {
    bits.push(String(f.quantity));
    used.push("quantity");
  }
  if (f.condition) {
    bits.push(f.condition);
    used.push("condition");
  }
  if (f.tireSize) {
    bits.push(f.tireSize);
    used.push("tireSize");
  }

  let text = bits.join(" ");
  if (f.tireSize) text = text ? `${text} tires` : "tires";
  if (f.vehicle) {
    text = text ? `${text} for your ${f.vehicle}` : `your ${f.vehicle}`;
    used.push("vehicle");
  }
  return { text: text.trim(), used };
}

const GSM_SEGMENT = 160;
const GSM_MULTI = 153;
const segmentsFor = (body: string) =>
  body.length === 0 ? 0 : body.length <= GSM_SEGMENT ? 1 : Math.ceil(body.length / GSM_MULTI);

/**
 * Compile the follow-up message for one call.
 *
 * Returns blockers rather than throwing — the caller decides whether to queue,
 * escalate or drop, and a blocked compile still reports which facts it had.
 */
export function compileRecoverySms(
  facts: ObservedCallFacts,
  opts: CompileOptions,
): CompiledSms {
  const blockers: SmsBlocker[] = [];
  if (opts.optedOut) blockers.push("opted_out");
  if (opts.safetyFlag) blockers.push("safety_lane_requires_human");
  if (opts.outsideSendingWindow) blockers.push("quiet_hours");

  const refusedClaims: string[] = [REFUSED.stock, REFUSED.price];
  const usedFacts: string[] = [];
  const shop = BUSINESS.name;
  const addr = BUSINESS.address.street;

  const greeting = facts.customerName
    ? `${titleCase(facts.customerName)} — ${shop} here.`
    : `${shop} here.`;
  if (facts.customerName) usedFacts.push("customerName");

  const lines: string[] = [];

  if (facts.existingVehicleAtShop) {
    // Operations lane. Never a sales pitch about a car already in the bay.
    lines.push(
      `${greeting} We have your question about the vehicle that's with us. Someone needs to physically check it before we give you an answer, and we'll follow up here.`,
    );
    refusedClaims.push(REFUSED.wait);
  } else if (facts.transferFailed) {
    const { text, used } = describeRequest(facts);
    usedFacts.push(...used, "transferFailed");
    lines.push(
      text
        ? `${greeting} That transfer didn't connect — sorry. You were asking about ${text}. Reply here and we'll pick it up without making you call again.`
        : `${greeting} That transfer didn't connect — sorry. Reply here and we'll pick it up without making you call again.`,
    );
  } else if (facts.tireSize) {
    const { text, used } = describeRequest(facts);
    usedFacts.push(...used);
    lines.push(
      `${greeting} You asked about ${text}. Used stock moves quickly, so we'd rather check the rack than promise anything over the phone. Want us to check for you?`,
    );
  } else if (facts.condition === "used" || facts.condition === "new") {
    // Tire intent WITHOUT a size. The single highest-leverage ask in the shop:
    // switch channels rather than make the caller repeat digits into a mic.
    usedFacts.push("condition");
    lines.push(
      `${greeting} I couldn't get the tire size clearly on the call. Text us a photo of the numbers on your tire's sidewall and we'll take it from there.`,
    );
  } else if (facts.symptom) {
    usedFacts.push("symptom");
    if (facts.vehicle) usedFacts.push("vehicle");
    const v = facts.vehicle ? ` on your ${facts.vehicle}` : "";
    lines.push(
      `${greeting} You called about ${facts.symptom}${v}. We won't guess at a repair over the phone — we'd want to look at it before anything gets approved. Reply here and we'll sort out the next step.`,
    );
    refusedClaims.push(REFUSED.diagnosis, REFUSED.wait);
  } else if (facts.callbackRequested) {
    usedFacts.push("callbackRequested");
    lines.push(`${greeting} You asked us to call you back — we've got it on the list. Reply here if texting is easier.`);
  } else {
    lines.push(`${greeting} Following up on your call. Reply here and tell us what you need.`);
  }

  // Canonical facts only: today's REAL hours, and the address.
  const hours = todayHoursPhrase(opts.now);
  if (hours) {
    lines.push(`${hours}, at ${addr}.`);
    usedFacts.push("todayHours", "address");
  } else {
    lines.push(`We're at ${addr}.`);
    usedFacts.push("address");
  }

  if (opts.isFirstInThread !== false) lines.push(OPT_OUT);

  const body = blockers.length ? "" : lines.join(" ");
  if (!blockers.length && !body) blockers.push("nothing_to_say");

  return {
    body,
    usedFacts: [...new Set(usedFacts)],
    refusedClaims: [...new Set(refusedClaims)],
    blockers,
    segments: segmentsFor(body),
  };
}

/**
 * Phrases an automated draft may never contain. Asserted by the test suite
 * against every compiled message, because the failure mode is a promise the
 * shop cannot keep — and the old templates contained four of these verbatim.
 */
export const FORBIDDEN_SMS_PHRASES: readonly RegExp[] = [
  /\bin stock\b/i,
  /\ball major brands\b/i,
  /\bwhile you wait\b/i,
  /\bfree\b/i,
  /\bbefore \d+\s*(am|pm)\b/i,
  /\$\d/,
  /\bguarantee/i,
  /\bwe can fix\b/i,
];
