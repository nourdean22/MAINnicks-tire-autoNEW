/**
 * customerCorpus — the pure half of `scripts/diagnostics/customer-corpus-census.mts`.
 *
 * WHY THIS EXISTS. The 2026-09-23 research mission asked what Nick's customers
 * actually want and what it costs them to get it, from three months of calls
 * and texts. Every existing reader answers a narrower question on one channel:
 * the recovery queue counts CALLS for a sales lane, `tire-size-recall` measures
 * one extractor, `vapi-90d-report` counts tool writes. None sees a customer who
 * called, was told "come in", texted twice and never arrived as ONE episode, and
 * none counts what the customer had to repeat. This module is that reading,
 * kept pure so each rule is pinned by a test before it touches production text.
 *
 * TWO DEFECTS IN THE LIVE KERNEL THIS MEASURES RATHER THAN SILENTLY FIXES.
 *   1. `detectIntents` (server/services/vapiCallClassifier.ts) has no pattern for
 *      a bare tire request: "I need two tires for my Honda" yields NO intent,
 *      so `intentFamily` files it under "general" and `classifyCall` can end it
 *      at `unknown`. The unwired `classifyVoiceDemand` reads it as tire_service;
 *      the census prints how many production calls the live kernel leaves
 *      intent-less (recomputed on the census's own customer text, so both
 *      classifiers read identical words) while the demand classifier finds a
 *      tire need — the number that decides whether the eval cron switches.
 *   2. `episodeKey` (shared/callTaxonomy.ts) buckets by fixed UTC days, so the
 *      boundary falls at 8 PM Eastern (7 PM in winter): two calls ten minutes
 *      apart across it are two episodes, and a Tuesday-6pm/Wednesday-9am pair
 *      can be one or two depending on the clock, not the customer. `sessionize`
 *      uses a GAP instead: a contact within `gapMinutes` of the customer's last
 *      contact continues the episode. The census reports both counts side by side.
 *
 * PRIVACY. Transcripts and texts carry names, numbers, plates and addresses.
 * `maskPII` runs before any rule matches (and before the demand classifier,
 * which needs "225/65R17" intact). Text that is PRINTED — excerpts and the
 * `--export` file — additionally goes through `maskForOutput`, which hashes
 * every digit left, and call turns go through `maskTurns`, which knows that
 * the answer to "what's your name?" is a bare name no pattern can recognise.
 * Mask before you match, match before you print (the rule `tire-size-recall.mjs`
 * paid for). Phones become a salted hash.
 *
 * TIME. Calls are placed at their START (the archive's `started_at`, else the
 * log row's insert time minus the duration: `vapi_call_logs` is written by the
 * end-of-call webhook). Days are Eastern BUSINESS days (`getBusinessDateKey`),
 * never UTC days.
 */
import { createHash } from "node:crypto";
import { BUSINESS } from "../../shared/business";
import { isOptOutBody } from "../../shared/smsOptOutKeywords";
import { getBusinessDateKey } from "../../server/lib/timezoneAssert";
import { isTransferAttempt, isTransferFailure } from "../../server/lib/warmTransferConnect";
import {
  classifyVoiceDemand,
  type VoiceClassification,
  type VoiceFriction,
  type VoiceIntent,
} from "../../server/services/voiceDemandClassifier";

/* ─────────────────────────────── identity ─────────────────────────────── */

/** Last ten digits, or "" when the input carries fewer than ten. */
export function phoneKey(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/** A per-run salted hash: stable inside one report, unlinkable across runs. */
export function customerToken(phone10: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${phone10}`).digest("hex").slice(0, 10);
}

/* ──────────────────────────────── masking ─────────────────────────────── */

/**
 * iOS types ’ for ' (smart punctuation). Every pattern here and in the demand
 * classifier spells the apostrophe ASCII (`didn'?t`, `i'?m coming`), so an
 * iPhone text silently matched nothing. Normalised once, before any rule.
 */
const plain = (text: string) => String(text ?? "").replace(/[‘’]/g, "'");

const DIGIT_WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
/** Digit words and digit groups separated by spaces, commas, dots or dashes. */
const NUMBER_RUN = new RegExp(String.raw`\b(?:${DIGIT_WORD}|\d+)(?:[\s,.-]+(?:${DIGIT_WORD}|\d+))*\b`, "gi");
/**
 * A spaced tire size inside a run ("225 65 17") — realistic widths, aspect
 * ratios and rims only, so a local number grouped 3-2-2 ("555 01 23") is not
 * exempt. An "R" never joins a run, so "225 65 R 17" never reaches the count.
 */
const TIRE_SIZE_IN_RUN = /\b(?:1[2-9]\d|2\d\d|3[0-5]\d)[\s,.-]+[2-9][05][\s,.-]+(?:1[2-9]|2[0-6])\b/g;
const DIGIT_WORD_ONLY = new RegExp(`^(?:${DIGIT_WORD})$`, "i");

/**
 * A run of digit words and digit groups carrying seven or more digits is a
 * number someone read out — "two one six 555 0123", "2 1 6 5 5 5 0 1 2 3",
 * "555-0123" — however it was grouped. A tire size inside the run is set aside
 * first: "225 65 17" is seven digits and exactly what the classifier needs.
 */
function maskNumberRun(run: string): string {
  const count = (s: string) => s.split(/[\s,.-]+/).filter(Boolean)
    .reduce((n, tok) => n + (/^\d+$/.test(tok) ? tok.length : 1), 0);
  if (count(run.replace(TIRE_SIZE_IN_RUN, " ")) < 7) return run;
  const toks = run.split(/[\s,.-]+/).filter(Boolean);
  if (toks.every((t) => DIGIT_WORD_ONLY.test(t))) return "[SPOKEN-NUMBER]";
  // A local number without its area code ("555-0123"), or one read digit by digit.
  if ((toks.length === 2 && /^\d{3}$/.test(toks[0]!) && /^\d{4}$/.test(toks[1]!)) || toks.every((t) => /^\d$/.test(t))) return "[PHONE]";
  return "[NUMBER]";
}

const STREET_SUFFIX = "street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|parkway|pkwy|place|pl|terrace|ter|circle|cir|highway|hwy";
/** A house number, an optional direction, one to three name words (an ordinal counts), a suffix. */
const ADDRESS = new RegExp(
  String.raw`\b\d{2,6}\s+(?:(?:north|south|east|west|[nsew])\.?\s+)?(?:(?:\d{1,4}(?:st|nd|rd|th)|[a-z][a-z'-]*)\s+){1,3}(?:${STREET_SUFFIX})\b\.?`,
  "gi",
);

/** A capitalised word that is a name's shape: "Jordan", "O'Brien", "Mary-Kate" — never "I" or "OK". */
const CAP = String.raw`[A-Z][A-Za-z'-]*[a-z]`;
/** After "call me" these words are the rest of the request, not a name. */
const CALL_ME_NOT_A_NAME = new Set([
  "back", "at", "on", "when", "whenever", "if", "to", "about", "after", "before", "tomorrow", "today", "tonight",
  "later", "please", "now", "asap", "anytime", "again", "soon", "first", "and", "or", "so", "with", "in", "the",
  "a", "as", "right", "instead", "directly", "up", "sometime", "once", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "this", "that", "around", "between", "any",
]);
/**
 * STRONG introductions ("my name is", "name's", "call me"): the next word is the
 * name whatever its case — texts are typed lowercase — plus a capitalised word
 * after it (the surname). Fillers between are skipped ("my name is uh Jordan").
 */
const STRONG_INTRO = new RegExp(
  String.raw`\b([Mm]y [Nn]ame(?: is|'s)|[Nn]ame's|[Cc]all me)([\s,:]+)((?:(?:[Uu]h|[Uu]m|[Ee]r|[Aa]h)[\s,.]+)*)([A-Za-z][A-Za-z'-]*)((?:\s+${CAP}\b)?)`,
  "g",
);
/**
 * WEAK introductions ("this is", "it's", "I'm", "I am"): only a CAPITALISED next
 * word is a name. "it's fine", "I'm good", "this is about my brakes" survive.
 */
const WEAK_INTRO = new RegExp(String.raw`\b([Tt]his is|[Ii]t's|[Ii]'m|[Ii] am)(\s+)${CAP}\b(?:\s+${CAP}\b)?`, "g");
/**
 * The assistant addresses the caller by name ("Thanks, John." / "Got it, Maria,").
 * The address form is case-blind; the NAME is case-sensitive. The old rule put
 * /i on the whole regex, so "[A-Z][a-z]+" matched any word and "okay, brakes."
 * lost its need to "[NAME]" before the classifier saw it. Accepted over-masking:
 * "Okay, Honda." → "Okay, [NAME]." — a capitalised make or weekday after an
 * address form reads exactly like a name, and nothing downstream needs it
 * (the vehicle is extracted from the raw text).
 */
const ADDRESSED = new RegExp(
  String.raw`\b([Tt]hanks|[Tt]hank you|[Gg]ot it|[Oo]kay|[Oo]k|[Aa]lright|[Pp]erfect|[Gg]reat|[Hh]i|[Hh]ey|[Ss]ure|[Ss]orry|[Nn]o problem|[Yy]eah|[Yy]es|[Yy]ep)(,?\s+)${CAP}(?=\s*[.,!?])`,
  "g",
);

function maskIntroductions(text: string): string {
  return text
    .replace(STRONG_INTRO, (m, intro: string, sep: string, _fill: string, word: string) =>
      /^call me$/i.test(intro) && CALL_ME_NOT_A_NAME.has(word.toLowerCase()) ? m : `${intro}${sep}[NAME]`)
    .replace(WEAK_INTRO, "$1$2[NAME]");
}

/**
 * Replace every identifier shape a call or text carries. Order matters: emails
 * and full phones first, so a formatted number cannot survive as fragments;
 * addresses before number runs, so a house number stays with its street.
 * Classification reads this output, so it must NOT destroy a tire size
 * ("225/65R17", "225 65 17", "225/65/17") — digits that survive here are hashed
 * only on output surfaces (`maskForOutput`). Plates need no rule for that reason.
 */
export function maskPII(text: string): string {
  const masked = plain(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]")
    // spoken: "jordan dot example at gmail dot com". The last label must be a mail
    // TLD: "there at 5.30" is a time, and "at home.Is it ready" (no space) a question.
    .replace(/\b[a-z0-9+-]+(?:(?:\s+dot\s+|[._])[a-z0-9+-]+)*\s+at\s+[a-z0-9-]+(?:(?:\s+dot\s+|\.)[a-z0-9-]+)*(?:\s+dot\s+|\.)(?:com|net|org|edu|gov|us|co|io|me|info|biz)\b/gi, "[EMAIL]")
    .replace(/\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g, "[PHONE]")
    // 17 VIN characters (no I, O, Q), any case, at least one digit AND one letter
    .replace(/\b(?=[A-HJ-NPR-Z0-9]{0,16}\d)(?=[A-HJ-NPR-Z0-9]{0,16}[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/gi, "[VIN]")
    .replace(ADDRESS, "[ADDRESS]")
    .replace(NUMBER_RUN, maskNumberRun)
    // a name spelled out: "M-A-R-I-A", "M A R I A"
    .replace(/\b[A-Za-z](?:-[A-Za-z]){2,}\b|\b[A-Z](?: [A-Z]){3,}\b/g, "[SPELLED]");
  return maskIntroductions(masked).replace(ADDRESSED, "$1$2[NAME]");
}

/**
 * For surfaces a person READS (excerpts, `--export`): maskPII, then every digit
 * left becomes '#'. Plates ("JKL 4821"), card tails and house numbers no rule
 * recognised stop there. Never used for classification — the demand classifier
 * needs "225/65R17"; the tire size and vehicle are exported as structured fields.
 */
export function maskForOutput(text: string): string {
  return maskPII(text).replace(/\d/g, "#");
}

/** A short masked window around the first match — never the whole line, never a digit. */
export function excerptAround(text: string, re: RegExp, words = 7): string | null {
  const masked = maskPII(text);
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(masked);
  if (!m) return null;
  // Cut on whitespace boundaries of the MASKED text, so punctuation stays where
  // the speaker put it and no identifier can be re-joined from fragments.
  let start = m.index;
  for (let n = 0; n <= words && start > 0; n++) start = masked.lastIndexOf(" ", start - 2) + 1;
  let end = m.index + m[0].length;
  for (let n = 0; n < words && end < masked.length; n++) {
    const next = masked.indexOf(" ", end + 1);
    end = next < 0 ? masked.length : next;
  }
  return masked.slice(start, end).trim().slice(0, 160).replace(/\d/g, "#");
}

/* ──────────────────────────────── turns ──────────────────────────────── */

export interface Turn {
  role: "customer" | "assistant";
  text: string;
}

const CUSTOMER_PREFIX = /^\s*(user|customer|human|caller)\s*:\s*/i;
const ASSISTANT_PREFIX = /^\s*(ai|assistant|bot|agent|system)\s*:\s*/i;

/**
 * Role-tagged turns, uncapped (the census needs late turns: repetition and
 * frustration happen there). Prefers Vapi's structured `messages` array, which
 * is role-tagged at source; falls back to the prefixed flat transcript. A
 * transcript with no prefixes yields [] — the caller's words cannot be told
 * from the assistant's, and guessing is the contamination customerTurns.ts
 * exists to remove.
 */
export function parseTurns(transcript: unknown, messages: unknown): Turn[] {
  if (Array.isArray(messages) && messages.length > 0) {
    const out: Turn[] = [];
    for (const m of messages as Array<Record<string, unknown>>) {
      const role = String(m?.role ?? "").toLowerCase();
      const raw = m?.message ?? m?.content ?? m?.text;
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (role === "user" || role === "customer" || role === "human") out.push({ role: "customer", text: raw.trim() });
      else if (role === "assistant" || role === "bot" || role === "ai") out.push({ role: "assistant", text: raw.trim() });
    }
    if (out.length) return out;
  }
  if (typeof transcript !== "string" || !transcript.trim()) return [];
  const out: Turn[] = [];
  let current: Turn | null = null;
  for (const line of transcript.split(/\r?\n/)) {
    if (CUSTOMER_PREFIX.test(line)) {
      if (current) out.push(current);
      current = { role: "customer", text: line.replace(CUSTOMER_PREFIX, "").trim() };
    } else if (ASSISTANT_PREFIX.test(line)) {
      if (current) out.push(current);
      current = { role: "assistant", text: line.replace(ASSISTANT_PREFIX, "").trim() };
    } else if (current && line.trim()) {
      current.text += ` ${line.trim()}`;
    }
  }
  if (current) out.push(current);
  return out.filter((t) => t.text.length > 0);
}

/** "I", "I'm", "I'll", "I've", "I'd" are the caller, not a name. */
const SELF = new Set(["I", "I'm", "I'll", "I've", "I'd"]);

/**
 * `maskPII` over ordered turns, plus the one rule only ORDER can supply: the
 * customer's answer to a name ask ("Can I get your name?" → "Jordan Example.")
 * is a bare name no pattern recognises. Every customer turn after an assistant
 * turn matching `ASK_PATTERNS.ask_name`, until the assistant speaks again (an
 * answer can be split over turns), is replaced whole when it is four words or
 * fewer, else loses every capitalised word except the I-forms. The ask is read
 * WITHOUT the question-mark rule `countAsks` applies: masking errs wide.
 * Output surfaces only — classification reads `maskPII` of the raw turns.
 */
export function maskTurns(turns: readonly Turn[]): Turn[] {
  let afterNameAsk = false;
  return turns.map((t) => {
    if (t.role === "assistant") {
      afterNameAsk = ASK_PATTERNS.ask_name.test(plain(t.text));
      return { role: t.role, text: maskPII(t.text) };
    }
    const masked = maskPII(t.text);
    if (!afterNameAsk) return { role: t.role, text: masked };
    if (t.text.trim().split(/\s+/).length <= 4) return { role: t.role, text: "[NAME]" };
    return { role: t.role, text: masked.replace(/\[[A-Z-]+\]|\b[A-Z][A-Za-z'-]*/g, (w) => (w.startsWith("[") || SELF.has(w) ? w : "[NAME]")) };
  });
}

/* ──────────────────────────────── needs ──────────────────────────────── */

/**
 * What the customer came for — read with the EXISTING demand taxonomy
 * (server/services/voiceDemandClassifier.ts), never a third one. That module
 * was built from the real July residue and pinned by its own tests, but no
 * production path imports it (the eval cron still uses `detectIntents`); this
 * census is its first reader over live data, which is the evidence the wiring
 * decision needs.
 *
 * It classifies ONE turn by design (the caller's own framing). An episode has
 * many, and a caller who opens "can I talk to someone" states the need later,
 * so: every customer turn IN TIME ORDER (the caller passes calls and texts
 * interleaved as they happened); the first intent that is neither `unclear`
 * nor `human_requested` is the need; an opening human request is kept as its
 * own fact instead of hiding the need behind it.
 */
const TIRE_INTENTS = new Set<VoiceIntent>([
  "used_tire_price", "used_tire_availability", "new_tire_quote", "tire_size_help",
  "flat_or_puncture", "tpms", "tire_service", "rack_check",
]);
export const isTireIntent = (i: VoiceIntent) => TIRE_INTENTS.has(i);

/**
 * The demand classifier over ONE customer turn — the single path every need in
 * the census takes. MASK FIRST: the classifier's size rule reads "(216)
 * 555-0102" and "555-0102" as tire sizes (tire_size_help, 0.8), so a caller
 * reciting a callback number would be filed as tire demand. Then BLANK the mask
 * tokens: its hours rule keys on the word "address", so "I live on [ADDRESS]"
 * was filed as an hours question. Pinned in customerCorpus.test.ts; whoever
 * wires the classifier into the eval cron must do both (or fix the rules).
 */
export function classifyTurn(turn: string): VoiceClassification {
  return classifyVoiceDemand(maskPII(turn).replace(/\[[A-Z-]+\]/g, " "));
}

export interface EpisodeNeed {
  need: VoiceIntent;
  friction: VoiceFriction;
  /** The first substantive classification was a request for a person. */
  openedWithHuman: boolean;
  /** Every distinct non-unclear intent seen, in order of first appearance. */
  all: VoiceIntent[];
}

export function episodeNeed(customerTurns: readonly string[]): EpisodeNeed {
  let need: VoiceIntent = "unclear";
  let friction: VoiceFriction = "unknown";
  let openedWithHuman = false;
  let first = true;
  const all: VoiceIntent[] = [];
  for (const t of customerTurns) {
    const c = classifyTurn(t);
    if (c.intent === "unclear") continue;
    if (first) { openedWithHuman = c.intent === "human_requested"; first = false; }
    if (!all.includes(c.intent)) all.push(c.intent);
    if (need === "unclear" && c.intent !== "human_requested") { need = c.intent; friction = c.friction; }
  }
  if (need === "unclear" && openedWithHuman) { need = "human_requested"; friction = "human_required"; }
  return { need, friction, openedWithHuman, all };
}

/* ─────────────────────────── friction signals ────────────────────────── */

/**
 * Customer-side evidence of effort. Each is a PRIMITIVE the census counts on
 * its own; none is combined into a score here (item: raw metrics until a
 * composite is shown to add information).
 */
export const FRICTION_PATTERNS = {
  repeated_self: /\b(i (already )?(said|told you)|like i said|as i said|i just (said|told)|again,? (it'?s|i need))\b/i,
  not_understood: /\b(that'?s not what i said|no,? i said|you'?re not (understanding|listening|getting)|what\?|huh\?|can you repeat|say that again|i can'?t (hear|understand) you)\b/i,
  wants_human: /\b(talk|speak) (to|with) (a |an )?(real |actual |live )?(person|human|someone|somebody|representative|mechanic|guy)\b|\b(real person|live person|human being|operator)\b/i,
  // A REQUEST frame, not the word: "I'm the second owner" and "my manager said" are not asks.
  wants_manager_owner: /\b(talk|speak|get|put me through|transfer me|connect me) (to|with) (the|a|your) (manager|owner|boss|supervisor)\b|\bis the (manager|owner) (there|in|available)\b|\bwhere('?s| is) the (manager|owner)\b|\bnick himself\b/i,
  ai_distrust: /\b(are you (a )?(robot|real|ai|machine|computer|bot)|is this (a )?(robot|recording|ai|machine|bot))\b/i,
  prior_contact: /\b(i (called|texted|came in) (earlier|yesterday|before|this morning|last week|twice|already)|called (you )?(two|three|a few|several) times|second time (i'?m )?calling)\b/i,
  broken_promise: /\b(no ?one (called|got back|texted)|nobody (called|got back|texted)|never (called|got back|heard back)|(was|were) supposed to (call|text)|still waiting|been waiting)\b|\b(didn'?t|did not|never) (call|text|get back)( me)?( back)?\b/i,
  frustration: /\b(ridiculous|frustrat\w*|annoy\w*|waste of (my )?time|this is crazy|forget it|never mind|nevermind|unbelievable)\b/i,
} as const;
export type Friction = keyof typeof FRICTION_PATTERNS;

/** Units → per-kind count of units in which any piece matches. */
function countMatches<K extends string>(units: ReadonlyArray<readonly string[]>, patterns: Record<K, RegExp>): Record<K, number> {
  const out = Object.fromEntries(Object.keys(patterns).map((k) => [k, 0])) as Record<K, number>;
  for (const pieces of units) {
    for (const [k, re] of Object.entries(patterns) as Array<[K, RegExp]>) {
      if (pieces.some((p) => re.test(p))) out[k] += 1;
    }
  }
  return out;
}

export function frictionOf(customerTurns: readonly string[]): Record<Friction, number> {
  return countMatches(customerTurns.map((t) => [plain(t)]), FRICTION_PATTERNS);
}

/* ─────────────────────── what the assistant asks / promises ─────────────────────── */

const ASK_PATTERNS = {
  ask_tire_size: /\b(tire size|size of (your|the) tires?|numbers? on the (side|sidewall)|what size)\b/i,
  ask_vehicle: /\b(year,? make,? (and )?model|what (kind of )?(car|vehicle|truck)|make and model)\b/i,
  ask_name: /\b(your (first |last |full )?name|name (for|on) the|who am i speaking)\b/i,
  ask_phone: /\b(phone number|number to (reach|call|text)|best number|callback number)\b/i,
  ask_quantity: /\b(how many tires|one tire or|a pair or|all four)\b/i,
} as const;
export type Ask = keyof typeof ASK_PATTERNS;

/**
 * Per ask kind, how many assistant turns ASKED it. Only sentences ending in "?"
 * count: the assistant's text is LLM-written, so its punctuation is reliable,
 * and "so that's a 225/65R17 tire size" is a read-back, not an ask.
 */
export function countAsks(assistantTurns: readonly string[]): Record<Ask, number> {
  return countMatches(assistantTurns.map((t) => plain(t).match(/[^.!?]*\?/g) ?? []), ASK_PATTERNS);
}

/**
 * Assistant turns that commit the shop to a future action. These are the
 * obligations the Promise Ledger was built for; the census measures how many
 * are made and whether a HUMAN is visibly seen following up.
 */
const PROMISE_PATTERNS = {
  callback: new RegExp([
    String.raw`\b(someone|somebody|a team member|we|they|the team|nick|he|a technician|the shop)\b.{0,40}\b(will|'ll|is going to|are going to|gonna)\b.{0,20}\b(call|reach out|get back|contact)`,
    String.raw`\b(i'll|i will|we'll|we will)\s+(have|get|make sure)\b.{0,40}\b(call|calls|reach out|reaches out|get back|gets back|contact)`,
    String.raw`\b(will|'ll)\s+get back to you\b`,
    String.raw`\bgive you a (call|ring)\b`,
    String.raw`\bso (they|someone|somebody|the team|nick|he) can (call|reach out|get back|contact)\b`,
  ].join("|"), "i"),
  text_followup: /\b(will|'ll|going to)\b.{0,20}\b(text|send (you )?(a )?(text|message|link))\b/i,
  // A FUTURE check that REPORTS BACK. "Let me check what we have" is the call working, not a promise.
  rack_check: /\b(will|'ll|going to|gonna|have (someone|the team|a tech\w*|nick|them))\b.{0,30}\b(?:(?:check|look at|look in)\b.{0,40}\b(?:rack|stock|inventory|in the back|what we have)|see what we have)\b.{0,60}\b(let you know|get back to you|call you|text you|reach out|update you|give you a call)\b/i,
  // Future tense required: "when it's ready you can pick it up" and "I'll let you know the
  // price is $49" are not a later report (the 2026-09-23 census counted both).
  status_update: /\b(will|'ll|going to|gonna)\b.{0,15}\b(let you know|update you|keep you posted|(text|call)( you)?\b.{0,10}when (it'?s|your car is) ready)\b/i,
} as const;
export type PromiseKind = keyof typeof PROMISE_PATTERNS;

/** Something done DURING the call ("let me check", "one sec") — not an obligation. */
const IN_CALL = /\b(let me (check|see|look)|one (sec|second|moment)|in a (sec|second|moment|minute)|right now|hold on)\b/i;
/**
 * Kept on the spot, or conditional on a drop-off the call cannot create: the
 * address / confirmation text goes out during the call (sendConfirmationSms), and
 * "drop it off and we'll text when it's ready" is the old scripted oil-change
 * line (vapi.ts, reworded 2026-09-23) whose text is automated once a work order
 * exists. Counting either as an open promise inflated oil-change to 30 of 42.
 */
const FULFILLED_OR_CONDITIONAL = /\b(text|send)\b.{0,25}\b(address|confirmation|details|recap|directions|location)\b|\bdrop (it|the car|your car) off\b|\bwhen you (pull up|get here|come in)\b/i;
/**
 * A negation governing the action ("I can't check the inventory", "I don't think
 * the team will call"): the negation must reach the verb within four words, so
 * "Don't worry, I'll have someone call you back" is still a promise.
 */
const NEGATED = /\b(can't|cannot|won't|unable to|not able to|don't)\b(?:\s+[\w']+){0,4}?\s+(call|text|check|look|see|get back|reach out|contact|send|let you know|update)\b/i;

/**
 * Per promise kind, how many assistant turns MADE it. Each turn is split into
 * clauses (on . ! ? ; and ", but"); a clause that is an in-call action or is
 * negated does not count, so one refusal cannot hide the promise beside it.
 */
export function countPromises(assistantTurns: readonly string[]): Record<PromiseKind, number> {
  return countMatches(
    assistantTurns.map((t) => plain(t).split(/[.!?;]+|,\s*but\b/i).map((c) => c.trim())
      .filter((c) => c && !IN_CALL.test(c) && !NEGATED.test(c) && !FULFILLED_OR_CONDITIONAL.test(c))),
    PROMISE_PATTERNS,
  );
}

/* ─────────────────────────────── episodes ────────────────────────────── */

export interface Contact {
  phone10: string;
  /** When the contact STARTED (a call's start, a text's send time). */
  at: Date;
  /** When it ended — calls only; a text ends when it is sent. */
  endAt?: Date;
  channel: "call" | "sms_in" | "sms_out";
  ref: string;
}

export interface Episode<C extends Contact = Contact> {
  phone10: string;
  /** The first contact's start — always a customer contact. */
  start: Date;
  /** The latest end of ANY contact in the episode, outbound texts included. */
  end: Date;
  /** The latest end of a CUSTOMER contact (call or inbound text): obligation windows run from here. */
  lastCustomerEnd: Date;
  contacts: C[];
}

/**
 * Gap sessionization per customer: a contact continues the open episode when it
 * starts within `gapMinutes` of the end of that episode's last CUSTOMER contact
 * (a call or an inbound text). The shop's outbound texts never open an episode
 * (a campaign text is not a customer need) and never move the anchor — they
 * attach when within the gap, so an automated reminder cannot chain two separate
 * needs into one episode. Contacts with no phone are their own episode.
 */
export function sessionize<C extends Contact>(contacts: readonly C[], gapMinutes = 24 * 60): Episode<C>[] {
  const endOf = (c: C) => c.endAt ?? c.at;
  const byPhone = new Map<string, C[]>();
  const loose: Episode<C>[] = [];
  for (const c of contacts) {
    if (!c.phone10) {
      if (c.channel !== "sms_out") loose.push({ phone10: "", start: c.at, end: endOf(c), lastCustomerEnd: endOf(c), contacts: [c] });
      continue;
    }
    const list = byPhone.get(c.phone10);
    if (list) list.push(c);
    else byPhone.set(c.phone10, [c]);
  }
  const out: Episode<C>[] = [...loose];
  const gap = gapMinutes * 60_000;
  for (const [phone10, list] of byPhone) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let open: Episode<C> | null = null;
    for (const c of list) {
      const customer = c.channel !== "sms_out";
      if (open && c.at.getTime() - open.lastCustomerEnd.getTime() <= gap) {
        open.contacts.push(c);
        if (endOf(c) > open.end) open.end = endOf(c);
        if (customer && endOf(c) > open.lastCustomerEnd) open.lastCustomerEnd = endOf(c);
        continue;
      }
      if (!customer) continue; // no customer-initiated contact to attach to
      open = { phone10, start: c.at, end: endOf(c), lastCustomerEnd: endOf(c), contacts: [c] };
      out.push(open);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ─────────────────────────────── stats ──────────────────────────────── */

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function pct(n: number, d: number): string {
  return d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "n/a (0 denominator)";
}

/** Hour and weekday in the shop's zone, for the open/closed split. */
export function shopClock(at: Date, timeZone: string = BUSINESS.timezone): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return { hour, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Open per BUSINESS.hours.structured — the one hours authority, never re-typed here. */
export function isOpen(at: Date, timeZone: string = BUSINESS.timezone): boolean {
  const { hour, weekday } = shopClock(at, timeZone);
  const span = (BUSINESS.hours.structured as Record<string, string>)[WEEKDAYS[weekday]!];
  const m = /^(\d{2}):\d{2}-(\d{2}):\d{2}$/.exec(span ?? "");
  if (!m) return false;
  return hour >= Number(m[1]) && hour < Number(m[2]);
}

/* ───────────────────────────── business days ──────────────────────────── */

/** YYYY-MM-DD plus n calendar days (pure date arithmetic, no zone involved). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the Eastern business week the instant falls in (UTC weeks split Sunday evening). */
export function businessWeekKey(at: Date): string {
  const day = getBusinessDateKey(at);
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/**
 * Which episode each invoice links to, compared on Eastern BUSINESS DATES.
 * `invoices.invoiceDate` is effectively day-precision — writers stamp noon
 * server time (08:00 ET) or the import time — so an invoice for a 10:05 ET call
 * reads as "before" the call by the clock. An invoice links to AT MOST ONE
 * episode: the most recent one for that phone whose start date is on or before
 * the invoice date, no more than `linkDays` before it. Returns an episode index
 * per invoice, or null.
 */
export function linkInvoices(
  episodes: ReadonlyArray<{ phone10: string; startDay: string }>,
  invoices: ReadonlyArray<{ phone10: string; day: string }>,
  linkDays = 14,
): Array<number | null> {
  const byPhone = new Map<string, number[]>();
  episodes.forEach((e, i) => {
    if (!e.phone10) return;
    (byPhone.get(e.phone10) ?? (byPhone.set(e.phone10, []), byPhone.get(e.phone10)!)).push(i);
  });
  for (const list of byPhone.values()) list.sort((a, b) => episodes[a]!.startDay.localeCompare(episodes[b]!.startDay) || a - b);
  return invoices.map((inv) => {
    let best: number | null = null;
    for (const i of byPhone.get(inv.phone10) ?? []) {
      const s = episodes[i]!.startDay;
      if (s <= inv.day && inv.day <= addDays(s, linkDays)) best = i;
    }
    return best;
  });
}

/* ─────────────────────────────── opt-out · transfer ─────────────────────────────── */

/**
 * An inbound text is an opt-out only when its WHOLE body is a keyword — the
 * production suppression vocabulary (`isOptOutBody`), with trailing "." / "!"
 * and "opt-out" allowed. "Cancel my appointment for tomorrow" and "Stop by
 * around 3?" start with a keyword and are customers owed a reply. Plain-English
 * revocations ("quit texting me") are not covered, as that module says.
 */
export function isOptOutText(body: string): boolean {
  return isOptOutBody(String(body ?? "").replace(/[\s.!]+$/, "").replace(/-/g, " "));
}

export type TransferState = "none" | "attempted" | "connected" | "not_connected";

/**
 * The repo's own transfer definitions (server/lib/warmTransferConnect.ts), in
 * order of evidence: the provider's per-call verdict when it decided; else a
 * `*-transfer-*` failure ended reason (a definite no-connect); else a forward
 * that was attempted with no outcome known.
 */
export function transferState(verdict: unknown, endedReason: string | null | undefined): TransferState {
  if (verdict === "connected" || verdict === "not_connected") return verdict;
  if (isTransferFailure(endedReason)) return "not_connected";
  if (isTransferAttempt(endedReason)) return "attempted";
  return "none";
}

/* ───────────────────────── recontact · link · incidents ───────────────────────── */

/**
 * Did the customer have to come back ON THEIR OWN? Input: the episode's
 * customer contacts (`call` / `text`, a text with its body) plus the shop's
 * DELIVERED outbound texts (`shop`). A later customer contact is:
 *   - a REPLY (not counted) when it is a text, the shop texted since the
 *     previous customer contact, and that text went out at least
 *     `replyAfterMin` after the previous contact ENDED — the confirmation text
 *     fired seconds after hang-up is that call's paperwork, not an answer;
 *   - never a reply when the text itself chases ("still waiting… can someone
 *     call me": broken_promise / prior_contact) — that is a recontact whatever
 *     the shop sent before it;
 *   - IMMEDIATE when it starts under `immediateMin` after the previous
 *     customer contact ENDED — a dropped line or hold redial, counted apart;
 *   - otherwise a RECONTACT. A CALL is never a reply.
 */
export function recontacts(
  contacts: ReadonlyArray<{ at: Date; endAt?: Date; by: "call" | "text" | "shop"; text?: string }>,
  immediateMin = 10,
  replyAfterMin = 15,
): { immediate: number; later: number; replies: number } {
  const sorted = [...contacts].sort((a, b) => a.at.getTime() - b.at.getTime());
  let immediate = 0;
  let later = 0;
  let replies = 0;
  let prevCustomerEnd: number | null = null;
  let shopSinceLast = false;
  for (const c of sorted) {
    if (c.by === "shop") {
      if (prevCustomerEnd !== null && c.at.getTime() - prevCustomerEnd >= replyAfterMin * 60_000) shopSinceLast = true;
      continue;
    }
    if (prevCustomerEnd !== null) {
      const f = c.by === "text" && c.text ? frictionOf([c.text]) : null;
      const chase = f !== null && (f.broken_promise > 0 || f.prior_contact > 0);
      if (c.by === "text" && shopSinceLast && !chase) replies++;
      else if (c.at.getTime() - prevCustomerEnd < immediateMin * 60_000) immediate++;
      else later++;
    }
    prevCustomerEnd = (c.endAt ?? c.at).getTime();
    shopSinceLast = false;
  }
  return { immediate, later, replies };
}

/**
 * A bare acknowledgement ("ok thanks", "👍") is not a message owed a reply.
 *
 * No two alternatives may tile the same text: the separator is optional, so an
 * alternation holding both `k` and `kk` split "kkkk…?" every Fibonacci way
 * before failing — 36 characters cost seconds, 50 cost minutes, on ONE text.
 * `k` repeated already covers "kk".
 */
export const ACKNOWLEDGEMENT = /^\s*(?:(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|great|cool|perfect|got it|sounds good|will do|appreciate it|👍|🙏|❤️)[\s,.!]*)+$/iu;

/**
 * Intents that follow through on ANY need — asking the hours, walking in,
 * the wait, "on my way" — like unclear and a request for a person. They never
 * make a link ambiguous.
 */
const NEUTRAL_FOR_LINK = new Set<VoiceIntent>([
  "unclear", "human_requested", "hours_location", "walk_in_same_day", "wait_time", "ready_to_visit",
]);

/**
 * How sure is the gap rule that these contacts are one need? `ambiguous` when
 * two contacts name needs from different families (tire intents are one
 * family). Never forced: the census counts ambiguous episodes and reports them
 * apart rather than splitting or merging on a guess.
 */
export function linkConfidence(needsPerContact: readonly VoiceIntent[]): "single" | "consistent" | "ambiguous" {
  if (needsPerContact.length <= 1) return "single";
  const fam = new Set(
    needsPerContact
      .filter((n) => !NEUTRAL_FOR_LINK.has(n))
      .map((n) => (isTireIntent(n) ? "tire" : n)),
  );
  return fam.size > 1 ? "ambiguous" : "consistent";
}

/**
 * SRE-style grouping: failures that touch several customers inside one window
 * are ONE system incident with N customer-recovery obligations, not N lost
 * leads. A cluster opens on a failure and absorbs every failure within
 * `windowMin` of the cluster's LAST failure; it is an incident candidate only
 * when at least `minCustomers` DISTINCT KNOWN customers are in it. A failure
 * with no phone (withheld caller ID) counts as a failure, never as a customer:
 * three anonymous failures may be one person redialling.
 */
export function clusterIncidents(
  failures: ReadonlyArray<{ at: Date; phone10: string }>,
  windowMin = 60,
  minCustomers = 3,
): Array<{ start: Date; end: Date; customers: number; failures: number; anonymousFailures: number }> {
  const sorted = [...failures].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Array<{ start: Date; end: Date; phones: Set<string>; failures: number; anonymousFailures: number }> = [];
  for (const f of sorted) {
    let open = out[out.length - 1];
    if (!open || f.at.getTime() - open.end.getTime() > windowMin * 60_000) {
      open = { start: f.at, end: f.at, phones: new Set(), failures: 0, anonymousFailures: 0 };
      out.push(open);
    }
    open.end = f.at;
    open.failures++;
    if (f.phone10) open.phones.add(f.phone10);
    else open.anonymousFailures++;
  }
  return out
    .filter((c) => c.phones.size >= minCustomers)
    .map((c) => ({ start: c.start, end: c.end, customers: c.phones.size, failures: c.failures, anonymousFailures: c.anonymousFailures }));
}

/** True when an introduction phrase is present — recorded as a boolean, never the name. */
export function namePresent(text: string): boolean {
  const t = plain(text);
  return maskIntroductions(t) !== t;
}
