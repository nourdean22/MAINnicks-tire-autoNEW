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
 * A conditional connector immediately before the match position.
 *
 * Used as a negative lookbehind so a verdict INSIDE a condition is not scored as
 * a verdict. "If it's safe to drive, bring it by" and "let me know if you can
 * make it here" are correct assistant speech that happen to contain the literal
 * words of a claim; declaring the condition is what makes them honest.
 *
 * JavaScript is unusual in allowing a variable-length lookbehind, so one
 * alternation covers every connector instead of a stack of fixed-width ones.
 * Declared once because a guard that protects only the branches its author
 * happened to think of is the defect this constant exists to prevent.
 */
const NOT_CONDITIONAL = String.raw`(?<!\b(?:if|whether|unless|when|once|assuming)\s)`;

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
    // A callback promise is BACKED only when escalate() wrote the callback
    // queue + Promise Ledger row. On a call whose messages show escalate ran,
    // voiceClaimViolations skips this label (v2). The phrase exemption below
    // is the transcript-only fallback for the scripted after-hours line, old
    // ("first thing when we open") and new ("call you back when we're open").
    label: "unbacked_callback_promise",
    re: /\b(?:i'?ll|we'?ll|someone\s+will|(?:i|we)\s+(?:am|are)\s+going\s+to)\s+(?:call|ring|get\s+back\s+to|reach\s+out\s+to)\s+(?:you|ya)\b(?!\s*(?:back\s+)?(?:if|when\s+we(?:'re|\s+are)?\s+open|first\s+thing))/i,
  },

  /* ── TIRE SAFETY · added 2026-09-18, sourced to primary documents ──
   *
   * These differ in kind from the claims above. The others cost money when
   * wrong; these can put an unsafe tire back on a car, so the boundary is not
   * "what can we prove" but "what can anyone determine over a phone".
   *
   * DELIBERATELY UNDER-MATCHING. This module's own header records why: a
   * detector that guesses buries the claims that cost money. Every pattern
   * below matches an UNHEDGED VERDICT only. "It's usually repairable if it's in
   * the tread, but we can't confirm until we get it off the wheel" is correct
   * assistant behaviour and must stay clean, so the hedged forms are allowed
   * through on purpose and some real violations will be missed. Under-matching
   * is the safe direction for a detector that cannot block speech.
   */
  {
    /*
     * A REPAIRABILITY VERDICT OVER THE PHONE.
     *
     * USTMA, Puncture Repair Procedures for Passenger and Light Truck Tires:
     * "Repairs must be performed by removing the tire from the rim/wheel
     * assembly to perform a complete inspection to assess all damage that may
     * be present." The injury limit is 1/4 inch and shoulder/sidewall damage is
     * not repairable at all — none of which is visible from a description.
     *
     * Nick may state the CRITERIA. He may not apply them to a tire nobody has
     * seen.
     */
    label: "phone_repairability_verdict",
    re: /\b(?:yeah|yes|sure)?,?\s*(?:we|i)\s+can\s+(?:definitely\s+|for\s+sure\s+)?(?:patch|plug)\s+(?:that|it|those)\b|\bwe'?ll\s+just\s+(?:patch|plug)\s+(?:that|it)\b|\bthat'?s\s+(?:definitely\s+|totally\s+)?(?:repairable|patchable|fixable)\b/i,
  },
  {
    /*
     * AN OUTSIDE-IN OR ON-THE-WHEEL REPAIR.
     *
     * USTMA is unambiguous: "NEVER perform an outside-in tire repair or
     * on-the-wheel repair", and "A repair using a plug only or a patch only is
     * NOT ACCEPTABLE." Offering one on the phone promises a procedure the shop
     * should not perform.
     */
    label: "improper_tire_repair_offer",
    re: /\b(?:patch|plug|repair|fix)\s+(?:it|that|the\s+tire)\s+(?:right\s+)?(?:while\s+it'?s\s+)?(?:still\s+)?on\s+the\s+(?:car|wheel|rim|vehicle)\b/i,
  },
  {
    /*
     * A SAFETY VERDICT FROM TIRE AGE.
     *
     * NHTSA sets NO replacement interval. Its exact wording is "SOME VEHICLE
     * AND TIRE MANUFACTURERS RECOMMEND replacing tires that are six to ten
     * years old" — an attribution, not a rule. Goodyear says six; Bridgestone
     * and Michelin say ten; USTMA says calendar age alone cannot predict
     * serviceable life. No federal rule expires a tire, and Ohio has no
     * age-based tire law.
     *
     * Declaring a customer's tires expired, illegal or unsafe on age is both
     * unsupported and a sales pressure this shop does not need.
     */
    /*
     * Subject widened 2026-09-18 after a test miss: the verdict is just as
     * unsupported without the noun. "Those are too old, they're unsafe" carries
     * exactly the same claim as "your tires are unsafe", and a caller hears no
     * difference. The compliant phrasings stay clean because they attribute
     * ("some manufacturers recommend") rather than declare, and because
     * "that are six to ten years old" is not "too old".
     */
    label: "tire_age_safety_verdict",
    re: /\b(?:your\s+tires?|those|they|these)\s+(?:are|is|'re)\s+(?:expired|too\s+old|unsafe|illegal|no\s+longer\s+(?:safe|legal))\b|\bnhtsa\s+(?:says|recommends|requires|mandates)\b/i,
  },
  {
    /*
     * AN ABSOLUTE AWD CLAIM.
     *
     * The only primary document carrying a drivetrain-damage warning is Subaru
     * Service Bulletin 03-75-15, whose stated applicability is the 2015MY WRX
     * STI and whose subject is the DCCD warning light. It is not a general law
     * of all-wheel drive. The per-brand tread-tolerance tables in wide
     * circulation ("Toyota allows 2/32in") are unsourced retailer marketing.
     *
     * Correct behaviour is conditional: AWD vehicles CAN have matching
     * requirements, and we would check what this vehicle calls for.
     */
    label: "awd_absolute_claim",
    re: /\b(?:will|would|'ll)\s+(?:destroy|ruin|wreck|blow|burn\s+up)\s+(?:your\s+)?(?:differential|drivetrain|transfer\s+case|transmission)\b|\byou\s+(?:have\s+to|must|need\s+to)\s+replace\s+all\s+four\b(?!\s*(?:if|when|unless|on\s+some))/i,
  },

  /* ── REPAIR INTAKE · added 2026-09-18 ──
   *
   * The tire claims above cover the product the shop is named for. This pair
   * covers the OTHER half of the phone traffic: a caller describing a symptom
   * on a car nobody has seen.
   *
   * No primary document is needed for the boundary, because the boundary is
   * epistemic rather than regulatory: a noise the assistant has not heard, on a
   * vehicle it has not inspected, cannot be attributed to a part. Naming one is
   * a guess wearing the shop's authority — and the caller then either declines
   * a repair they need or arrives expecting one they do not.
   *
   * Same under-matching discipline as the tire block. Every pattern fires on an
   * UNHEDGED VERDICT only: "it's your wheel bearing" is a claim, while "that
   * could be a bearing, a heat shield, or the brakes — we'd have to drive it"
   * is exactly the answer wanted and must stay clean. Hedged forms are allowed
   * through on purpose.
   */
  {
    /*
     * NAMING THE FAILED PART FROM A DESCRIPTION.
     *
     * The part list is deliberately the common intake vocabulary rather than an
     * exhaustive catalogue — an unmatched part is a missed violation, which is
     * the safe direction, while a list padded with ambiguous words ("belt",
     * "line", "pump") would fire on ordinary speech.
     *
     * Note what is NOT allowed between the subject and the part: no adverb slot
     * exists, so "it's probably the alternator" and "it's usually the pads"
     * never match. That is the hedge allowance, implemented by omission rather
     * than by a second list that could drift out of step.
     */
    label: "phone_diagnosis_verdict",
    re: /\b(?:that|it|this)'?s\s+(?:your\s+|the\s+|an?\s+)*(?:bad\s+|worn\s+|shot\s+|failing\s+|blown\s+|seized\s+)?(?:wheel\s+bearing|brake\s+(?:pads?|rotors?|calipers?)|rotors?|calipers?|alternator|starter|cv\s+(?:joint|axle)|tie\s+rod|ball\s+joint|serpentine\s+belt|water\s+pump|fuel\s+pump|catalytic\s+converter|head\s+gasket|control\s+arm|wheel\s+hub)\b|\byou\s+need\s+(?:an?\s+|new\s+)*(?:wheel\s+bearing|brake\s+(?:pads?|rotors?|calipers?)|rotors?|calipers?|alternator|starter|cv\s+(?:joint|axle)|tie\s+rod|ball\s+joint|serpentine\s+belt|water\s+pump|fuel\s+pump|catalytic\s+converter|head\s+gasket|control\s+arm|wheel\s+hub)\b|\byour\s+(?:wheel\s+bearing|brake\s+(?:pads?|rotors?|calipers?)|rotors?|calipers?|alternator|starter|cv\s+(?:joint|axle)|tie\s+rod|ball\s+joint|serpentine\s+belt|water\s+pump|fuel\s+pump|catalytic\s+converter|head\s+gasket|control\s+arm|wheel\s+hub)s?\s+(?:is|are|'s|'re)\s+(?:bad|shot|gone|toast|blown|seized|worn\s+out|failing)\b/i,
  },
  {
    /*
     * TELLING A CALLER WHETHER THE CAR IS SAFE TO DRIVE.
     *
     * The most consequential sentence on the whole line, in both directions. A
     * green light nobody is qualified to give can put a caller on I-90 on a
     * failing hub; a red light nobody is qualified to give sells a tow the car
     * did not need.
     *
     * The correct answer is conditional and returns the judgement to the person
     * who can actually feel the car: if it feels unsafe, do not drive it.
     *
     * THE CONDITIONAL LOOKBEHIND IS LOAD-BEARING, ON EVERY BRANCH. Without it
     * this pattern fires on the compliant phrasings themselves — "we can't tell
     * you WHETHER it's safe to drive" and "IF it's safe to drive, bring it by"
     * both contain the literal verdict. A guard that flags the correct script is
     * a guard staff route around, which is the failure this module's header
     * warns about.
     *
     * CAUGHT IN SELF-REVIEW, 2026-09-18, and the miss is the lesson: the first
     * version guarded the two branches whose false positives I had thought of
     * and left the third bare, so "let me know IF YOU CAN MAKE IT HERE before
     * six" — ordinary scheduling speech, four words of it — scored as a safety
     * verdict. Every CLEAN test I had written exercised the two guarded
     * branches. A guard is only as good as its least-tested alternative, so the
     * lookbehind is now hoisted into one constant that each branch must use.
     */
    label: "drivability_safety_verdict",
    re: new RegExp(
      [
        // an assertive green light
        `${NOT_CONDITIONAL}\\b(?:you'?re|you\\s+are|you'?ll\\s+be|it'?s)\\s+(?:totally\\s+|perfectly\\s+|definitely\\s+|completely\\s+|absolutely\\s+)?(?:fine|safe|okay|ok)\\s+to\\s+drive\\b`,
        // the same permission phrased as ability
        `${NOT_CONDITIONAL}\\byou\\s+can\\s+(?:definitely\\s+|for\\s+sure\\s+|safely\\s+)?(?:make\\s+it\\s+(?:here|in|over)|drive\\s+(?:it|that|on\\s+it))\\b`,
        // an assertive red light — unsupported in the other direction
        `${NOT_CONDITIONAL}\\bit'?s\\s+(?:not|never)\\s+safe\\s+to\\s+drive\\b`,
      ].join("|"),
      "i",
    ),
  },
];

/**
 * BOT-TELLS — banned phrasings, kept deliberately separate from claims.
 *
 * The original version of this module refused to score tone, on the grounds that
 * a regex guessing at "sounds robotic" would generate noise that buries the
 * claims that cost money. That reasoning still holds, and nothing here scores
 * tone.
 *
 * What changed is evidence. An audit of 539 assistant turns across 100 real
 * inbound calls measured which kill-list bans actually hold:
 *
 *   9 of 13 bans      0 violations
 *   dead_air_tell     9 calls / 100   <- banned unconditionally, happening anyway
 *   stacked_filler   18 calls / 100   <- cause found + fixed (#1108)
 *
 * A ban that is violated 9% of the time is, by definition, not enforced by the
 * prose that bans it. These are EXACT phrases the prompt quotes and forbids, so
 * matching them is a string check, not a judgement — which is why they can live
 * here without the noise problem.
 *
 * DELIBERATELY EXCLUDED, and why:
 *  - re-greeting: `## WRONG NUMBER` INSTRUCTS the assistant to name the shop
 *    ("You reached Nick's Tire & Auto on Euclid — calling about tires...").
 *    Scoring it would flag correct behaviour. The prompt contradiction is the
 *    defect there, not the speech.
 *  - "Are you still there?": the ban is CONDITIONAL ("only after 6+ seconds of
 *    real silence with no tool running"). A transcript cannot show the pause, so
 *    a detector cannot honestly judge it. Unverifiable is not the same as clean.
 */
export const BOT_TELLS: ProhibitedClaim[] = [
  {
    // "this bot-tell killed 12+ calls — end on a concrete confirm or let the
    // caller lead". Banned with no exception anywhere in the prompt.
    label: "dead_air_tell",
    re: /\banything else (?:you need help with|i can (?:help you with|do for you))\b/i,
  },
  {
    // "never chain two waits ... One short line, then act."
    label: "stacked_filler",
    re: /\b(?:hold on|one moment|just a (?:sec|second|moment)|give me a (?:sec|second|moment))\b[^.!?]{0,40}?\b(?:hold on|one moment|just a (?:sec|second|moment))\b/i,
  },
  {
    label: "self_identifies_as_ai",
    re: /\b(?:i'?m|i am)\s+(?:just\s+)?(?:an?\s+)?(?:ai|bot|artificial intelligence|automated (?:system|assistant))\b/i,
  },
  {
    // "never the literal words 'I don't know'"
    label: "says_dont_know",
    re: /\bi (?:don'?t|do not) know\b/i,
  },
];

/** Score assistant turns against the bot-tell list. Same shape as claims. */
export function botTellViolations(turns: string[]): string[] {
  const found = new Set<string>();
  for (const turn of turns) {
    for (const t of BOT_TELLS) if (t.re.test(turn)) found.add(t.label);
  }
  return BOT_TELLS.map((t) => t.label).filter((l) => found.has(l));
}

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
export function voiceClaimViolations(turns: string[], ctx: { escalated?: boolean } = {}): string[] {
  const found = new Set<string>();
  for (const turn of turns) {
    // Approved anchors are removed first, so any surviving money figure is
    // unapproved by construction rather than by a second, drifting allowlist.
    let stripped = turn;
    for (const anchor of APPROVED_ANCHORS) stripped = stripped.replace(anchor, " ");
    if (MONEY_RE.test(stripped)) found.add("unapproved_price_quote");

    for (const claim of PROHIBITED_VOICE_CLAIMS) {
      // escalate ran on this call: its callback is in the queue and the ledger.
      if (claim.label === "unbacked_callback_promise" && ctx.escalated) continue;
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
 *
 * v2 (2026-09-23): `unbacked_callback_promise` is not raised on a call whose
 * messages show escalate() ran, and the after-hours exemption also accepts
 * "call you back when we're open". The prompt now routes EVERY callback it
 * lets the assistant promise through escalate — including CALLBACK CAPTURE
 * while open, after a transfer that did not connect — so v1 would flag those
 * backed promises. Compare v1 and v2 counts of this label with that in mind.
 */
export const VOICE_CLAIM_GUARD_VERSION = 2;

/**
 * Did escalate() run on this call? Vapi's artifact messages carry the model's
 * tool calls as `toolCalls: [{ function: { name } }]` — the same shape
 * server/routers/vapi.ts `callDetails` reads.
 */
function escalateRan(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    const calls = (m as { toolCalls?: unknown })?.toolCalls;
    return Array.isArray(calls) && calls.some((c) => (c as { function?: { name?: unknown } })?.function?.name === "escalate");
  });
}

export interface VoiceClaimRecord {
  v: number;
  violations: string[];
  turnsScanned: number;
  unparsed: boolean;
  /**
   * Bot-tells, stored SEPARATELY from `violations` on purpose. A banned phrasing
   * and an unsourced price are not the same severity, and merging them into one
   * count would produce exactly the deceptive blended KPI the directive forbids.
   */
  botTells?: string[];
  /**
   * v2 · the model CALLED escalate() on this call, so a callback it promised is
   * treated as backed. (A call that then failed server-side is logged by the
   * tool itself; this field records the call, not its row.) Present only when
   * role-tagged messages were read: a flat transcript cannot show tool calls,
   * and "unknown" must not be stored as false.
   */
  escalated?: boolean;
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
  const fromMessages = Array.isArray(args.messages) && args.messages.length > 0;
  const parsed = fromMessages
    ? extractAssistantTurnsFromMessages(args.messages)
    : extractAssistantTurns(args.transcript);

  if (!parsed.turns.length && !parsed.unparsed) return null;

  const escalated = fromMessages ? escalateRan(args.messages) : undefined;
  return {
    v: VOICE_CLAIM_GUARD_VERSION,
    violations: parsed.unparsed ? [] : voiceClaimViolations(parsed.turns, { escalated }),
    turnsScanned: parsed.turns.length,
    unparsed: parsed.unparsed,
    botTells: parsed.unparsed ? [] : botTellViolations(parsed.turns),
    ...(escalated === undefined ? {} : { escalated }),
  };
}
