/**
 * Detect prohibited CLAIMS in what the voice assistant actually said.
 *
 * WHY THIS EXISTS
 * SMS drafts are gated before send by `planViolations` (smsReplyPlanner): a
 * draft that promises stock, holds, completion times or callbacks its plan
 * forbids is forced to operator review. Voice had no equivalent — not a weaker
 * one, none. A grep of `vapi.ts`, `routes/webhooks/vapi.ts` and `routers/vapi.ts`
 * for any output guard returns only a cache invalidator.
 *
 * So on the highest-value channel, the ONLY thing standing between a caller and
 * an unsourced brake quote was ~12.5k chars of prohibition prose in
 * `ASSISTANT_SYSTEM_PROMPT` — 64% of the prompt, paid on every turn, enforcing
 * nothing mechanically. A model swap, a temperature change or prompt drift and
 * nothing in the system notices.
 *
 * WHAT THIS IS, AND IS NOT
 * NOT a live gate. Vapi streams model output straight to TTS; there is no
 * pre-speech hook to block on, and claiming otherwise would repeat the mistake
 * the 2026-07-26 prompt baseline caught — designing around a delivery mechanism
 * the platform does not offer. This is post-call DETECTION on the transcript the
 * webhook already holds. It buys three things the shop does not have today:
 *   1. drift detection — you find out the assistant started quoting repairs;
 *   2. the acceptance instrument for compressing that 64% prohibition surface
 *      (you cannot show "behaviour preserved" without measuring violations);
 *   3. an operator signal on the channel that carries the most revenue.
 *
 * SCOPE: truth claims only. The prompt's kill-list also bans TONE (re-greeting,
 * "I don't know", dead-air tells). Those are real, but they are style judgments
 * and a regex that guesses at them would generate noise that buries the claims
 * that cost money. Tone belongs to call evaluation, not to a claim guard.
 *
 * PRIVACY: turns are never logged or returned to callers of this module — only
 * violation LABELS and counts leave. Raw speech stays in the database column it
 * arrived in, matching the `customerTurns` posture.
 */
import type { ProhibitedClaim } from "./smsReplyPlanner";
import { ASSISTANT_PREFIX, CUSTOMER_PREFIX } from "./customerTurns";

/** Cap parsed turns — a violation appears in the sentence, not in call length. */
const MAX_TURNS = 60;

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Parse a VAPI transcript into ASSISTANT-only turns.
 *
 * Deliberately the mirror of `extractCustomerTurns`, including its fail-safe:
 * a transcript with no recognised speaker prefixes yields NOTHING. There the
 * risk was labelling assistant speech as customer demand; here it is labelling
 * CALLER speech as an assistant claim — a caller asking "so brakes are like
 * three hundred bucks?" must never be recorded as the assistant quoting one.
 * When attribution is impossible, reporting no violation is the only honest
 * answer, and `unparsed` says so out loud rather than passing as a clean call.
 *
 * Pure and total: any input yields a result, never a throw.
 */
export function extractAssistantTurns(transcript: unknown): { turns: string[]; unparsed: boolean } {
  if (typeof transcript !== "string" || !transcript.trim()) return { turns: [], unparsed: false };

  const collected: string[] = [];
  let current: string[] | null = null;
  let sawPrefix = false;

  const flush = () => {
    if (current && current.length) {
      const text = clean(current.join(" "));
      if (text) collected.push(text);
    }
    current = null;
  };

  for (const raw of transcript.split(/\r?\n/)) {
    if (ASSISTANT_PREFIX.test(raw)) {
      sawPrefix = true;
      flush();
      current = [raw.replace(ASSISTANT_PREFIX, "")];
    } else if (CUSTOMER_PREFIX.test(raw)) {
      sawPrefix = true;
      flush(); // caller speech is dropped entirely
    } else if (current) {
      current.push(raw); // continuation of the assistant's turn
    }
  }
  flush();

  if (!sawPrefix) return { turns: [], unparsed: true };
  return { turns: collected.slice(0, MAX_TURNS), unparsed: false };
}

/**
 * Extract assistant turns from VAPI's role-tagged `artifact.messages`.
 *
 * Strictly better than prefix parsing when present, for the same reason
 * `extractCustomerTurnsFromMessages` prefers it: no formatting change can
 * misattribute a speaker. `role: "bot"` is VAPI's assistant label; "assistant"
 * is accepted as a forward-compatible alias. Anything not explicitly the
 * assistant is dropped — the default must EXCLUDE, so an unrecognised role can
 * never be scored as an assistant claim.
 */
export function extractAssistantTurnsFromMessages(messages: unknown): { turns: string[]; unparsed: boolean } {
  if (!Array.isArray(messages) || messages.length === 0) return { turns: [], unparsed: true };

  const collected: string[] = [];
  for (const m of messages) {
    const role = String((m as { role?: unknown })?.role ?? "").toLowerCase();
    if (role !== "bot" && role !== "assistant" && role !== "ai") continue;
    const raw = (m as { message?: unknown })?.message
      ?? (m as { content?: unknown })?.content
      ?? (m as { text?: unknown })?.text;
    if (typeof raw !== "string") continue;
    const text = clean(raw);
    if (text) collected.push(text);
  }
  return { turns: collected.slice(0, MAX_TURNS), unparsed: false };
}

/**
 * THE THREE APPROVED PRICE ANCHORS, spoken and written.
 *
 * `ASSISTANT_SYSTEM_PROMPT` Critical Rule #1 permits exactly three prices and
 * forbids every other money figure — "no range, no upper bound, no 'around $X'".
 * These are stripped from the text BEFORE money detection runs, so the approved
 * anchors cannot trip the detector and every surviving figure is by definition
 * unapproved.
 *
 * Speech-to-text emits words, not digits: the assistant says "sixty dollars",
 * never "$60". Digit forms are matched too because provider normalisation
 * varies, but the WORD forms are the ones that fire in practice.
 */
const APPROVED_ANCHORS: RegExp[] = [
  // Used tires start at sixty dollars installed.
  /\b(?:sixty|60|\$60)\s*(?:dollars?|bucks)?\b/gi,
  // Conventional / synthetic-blend oil change: forty-nine dollars.
  /\b(?:forty[\s-]?nine|49|\$49)\s*(?:dollars?|bucks)?\b/gi,
  // Full synthetic: eighty dollars.
  /\b(?:eighty|80|\$80)\s*(?:dollars?|bucks)?\b/gi,
  // The coupon CODE is not a price; strip it so its digits never read as money.
  /\bOIL\s?2999\b/gi,
];

/** Number words that can begin a spoken money figure. */
const NUM_WORD =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|couple|few)";

/**
 * A spoken or written quantity. Longer alternatives lead so "a couple" is not
 * consumed as the bare article "a", leaving "couple" to fail the unit match.
 */
const QUANTITY =
  `(?:\\d+|a\\s+couple(?:\\s+of)?|a\\s+few|half\\s+an|${NUM_WORD}(?:[\\s-]+${NUM_WORD})*|an?)`;

/** Hedges that routinely precede an estimate the assistant is not allowed to give. */
const HEDGE = String.raw`(?:\b(?:about|around|roughly|maybe|like|approximately|under|within|probably)\b\s*)`;

const TIME_UNIT = String.raw`(?:minutes?|mins?|hours?|hrs?)`;

/**
 * Any money figure at all. Applied only AFTER the approved anchors are removed,
 * so a match here is an unapproved price by construction.
 */
const MONEY_RE = new RegExp(
  [
    String.raw`\$\s?\d[\d,]*(?:\.\d{2})?`,
    String.raw`\b\d[\d,]*\s*(?:dollars?|bucks)\b`,
    String.raw`\b${NUM_WORD}(?:[\s-]+${NUM_WORD})*\s+(?:dollars?|bucks)\b`,
  ].join("|"),
  "i",
);

/**
 * The claim classes. Each mirrors a line the prompt spends characters
 * prohibiting, kept to what a regex can decide HONESTLY — no tone, no intent
 * reading. Labels match the SMS vocabulary (`ProhibitedClaim`) so voice and SMS
 * violations aggregate into one operator view instead of two dialects.
 */
export const PROHIBITED_VOICE_CLAIMS: ProhibitedClaim[] = [
  {
    // Critical Rule #4 — "you don't see the rack, never claim a live check."
    label: "live_stock_claim",
    re: /\b(?:i\s+(?:just\s+)?(?:checked|looked|verified|confirmed)\b(?:[^.!?]{0,40}\b(?:stock|rack|inventory|back|shelf|system)\b)|(?:i\s+)?guarantee\s+(?:we|they)\s+(?:have|got)|we\s+(?:definitely|for sure|absolutely)\s+have\s+(?:that|it|those)\b|it'?s\s+(?:right\s+)?(?:here|in\s+stock)\s+(?:right\s+)?now\b)/i,
  },
  {
    // Critical Rule #3 (b)(c)(d) — no live capacity feed exists.
    label: "capacity_or_completion_promise",
    re: /\b(?:(?:we(?:'| a)?re|it'?s|shop is)\s+(?:not\s+)?(?:busy|slammed|packed|quiet|slow|empty|wide open)\b|we\s+(?:have|got)\s+(?:room|space|an?\s+(?:open\s+)?(?:bay|lift|spot))\b|(?:you'?ll|we'?ll)\s+(?:be\s+)?(?:seen|get\s+you\s+in)\s+(?:right\s+away|immediately|first)\b|(?:it'?ll|we'?ll)\s+(?:be\s+)?(?:done|finished|ready)\s+(?:today|this\s+afternoon|by\s+\w+)\b)/i,
  },
  {
    // "YOUR TOOLS" — must NEVER estimate a wait, in minutes or adjectives.
    //
    // A duration alone is not a violation ("open till six"); a duration TIED to
    // waiting is. Both orders occur in real calls — "about a thirty minute wait"
    // and "the wait is about two hours" — so both are matched. Word-numbers are
    // mandatory here for the same reason they are in MONEY_RE: this reads
    // speech-to-text, where "thirty" never arrives as "30".
    label: "wait_time_estimate",
    re: new RegExp(
      [
        // duration → wait-word
        String.raw`${HEDGE}?\s*${QUANTITY}\s*[-\s]?\s*${TIME_UNIT}\b[^.!?]{0,30}?\b(?:wait|waiting|takes?|turnaround|be\s+out|in\s+and\s+out)\b`,
        // wait-word → duration
        String.raw`\b(?:wait|waiting|turnaround)\b[^.!?]{0,20}?\b${QUANTITY}\s*[-\s]?\s*${TIME_UNIT}\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    // Critical Rule #2 — never promise a specific person or tech.
    label: "named_person_promise",
    re: /\b(?:nick|the\s+(?:owner|manager|tech|mechanic))\s+(?:will|'ll|is\s+going\s+to|can)\s+(?:look|check|take\s+care|handle|fix|see|do)\b/i,
  },
  {
    // checkTireStock — "never promise a callback"; escalate is the CLOSED path.
    label: "unbacked_callback_promise",
    re: /\b(?:i'?ll|we'?ll|someone\s+will|(?:i|we)\s+(?:am|are)\s+going\s+to)\s+(?:call|ring|get\s+back\s+to|reach\s+out\s+to)\s+(?:you|ya)\b(?!\s*(?:if|when\s+we\s+open|first\s+thing))/i,
  },
];

export interface VoiceClaimResult {
  /** Violation labels, deduped and stable-ordered. */
  violations: string[];
  /** Assistant turns scanned. Zero with `unparsed` false = assistant-silent call. */
  turnsScanned: number;
  /** True when speaker attribution was impossible — NOT a clean call. */
  unparsed: boolean;
}

/**
 * Score assistant turns against the prohibited-claim list.
 *
 * Mirrors `planViolations(plan, draft)`: filter the prohibited list against the
 * text, return labels. The difference is only that voice scores AFTER the fact,
 * because there is nothing to block.
 */
export function voiceClaimViolations(turns: string[]): string[] {
  const found = new Set<string>();
  for (const turn of turns) {
    // Approved anchors are removed first, so any surviving money figure is
    // unapproved by construction rather than by a second, drifting allowlist.
    let stripped = turn;
    for (const anchor of APPROVED_ANCHORS) stripped = stripped.replace(anchor, " ");
    if (MONEY_RE.test(stripped)) found.add("unapproved_price_quote");

    for (const claim of PROHIBITED_VOICE_CLAIMS) {
      if (claim.re.test(turn)) found.add(claim.label);
    }
  }
  // Stable order so stored records and alert text are diffable across runs.
  const order = ["unapproved_price_quote", ...PROHIBITED_VOICE_CLAIMS.map((c) => c.label)];
  return order.filter((l) => found.has(l));
}

/**
 * v1 (2026-07-27): first mechanical enforcement of voice claim rules. Versioned
 * from the start so a later rule change stays comparable in the data instead of
 * silently redefining what a stored violation meant.
 */
export const VOICE_CLAIM_GUARD_VERSION = 1;

export interface VoiceClaimRecord {
  v: number;
  violations: string[];
  turnsScanned: number;
  unparsed: boolean;
}

/**
 * Build the record persisted onto `vapi_call_logs.metadata.voiceClaims`.
 *
 * Rides the existing JSON column: no migration, so no hand-applied DDL to
 * forget — the ROS-059 failure mode, where a table the code assumed existed had
 * never been created in production and a fallback ran silently for four days.
 *
 * Returns null when there is nothing meaningful to record, so an empty key never
 * later reads as "this call was clean" when it was actually never scanned.
 */
export function buildVoiceClaimRecord(args: {
  transcript?: unknown;
  messages?: unknown;
}): VoiceClaimRecord | null {
  const parsed = Array.isArray(args.messages) && args.messages.length
    ? extractAssistantTurnsFromMessages(args.messages)
    : extractAssistantTurns(args.transcript);

  if (!parsed.turns.length && !parsed.unparsed) return null;

  return {
    v: VOICE_CLAIM_GUARD_VERSION,
    violations: parsed.unparsed ? [] : voiceClaimViolations(parsed.turns),
    turnsScanned: parsed.turns.length,
    unparsed: parsed.unparsed,
  };
}
