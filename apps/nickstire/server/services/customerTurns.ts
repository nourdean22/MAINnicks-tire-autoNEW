/**
 * Extract CUSTOMER-ONLY speech from a VAPI transcript.
 *
 * WHY THIS EXISTS
 * The 2026-07-26 demand audit could not answer "what do callers actually want?"
 * because every available signal was contaminated by the assistant:
 *   - `serviceMention` is effectively binary (tire | brake), so it measures its
 *     own label set rather than demand;
 *   - `aiSummary` is written BY a tire-first assistant, so keyword-counting it
 *     measures the assistant's vocabulary;
 *   - `transcriptUrl` is populated on 0 of 2,095 rows — VAPI never sets it, so
 *     nothing durable held the conversation.
 * The webhook has had `event.artifact.transcript` in hand the whole time and
 * threw it away after a keyword scan. This keeps the part that answers the
 * question: what the CUSTOMER said, in their words, before the assistant framed
 * it.
 *
 * WHAT IS DELIBERATELY NOT STORED
 * Not the full transcript, and not assistant speech. Only the customer's own
 * turns, capped and truncated. Storing less is both a privacy posture and the
 * reason this needs no migration: it rides the existing `metadata` JSON column,
 * so there is no hand-applied DDL to forget (the ROS-059 failure mode).
 *
 * Raw turns must never reach logs, the repo, or an audit artifact — aggregate
 * or redact before anything leaves the database.
 */

/** Cap stored turns: demand intent is established early, and rows stay small. */
export const MAX_TURNS = 12;
/** Cap each turn. Long turns are rambling context, not additional intent. */
export const MAX_TURN_CHARS = 300;

/**
 * A turn is "substantive" only past this length. Filler ("yeah", "ok", "hello")
 * is a real conversational move but says nothing about what the caller wants,
 * and treating it as the first request would mislabel a large share of calls.
 */
const MIN_SUBSTANTIVE_CHARS = 12;

/** A single filler token — never part of the customer's actual request. */
const FILLER_WORD_RE = /^(y(e[ash]*|up|eah)|ok(ay)?|uh|um+|uh[- ]?huh|mm+|hm+|hello|hi|hey|sure|right|alright|no|nope|yes|thanks?|thank you|bye|goodbye|correct|exactly|please|sorry|what|huh|there|wait|sir|ma'?am)$/i;

/**
 * Placeholders that reach us as literal text. Real backfilled calls contained
 * the four-character string "null" as a customer turn — almost certainly a
 * serialised absent value upstream. Treating that as a request would classify
 * those calls on a word the caller never said.
 */
const PLACEHOLDER_RE = /^(null|undefined|n\/a|none|\[?inaudible\]?|\[?silence\]?)$/i;

/**
 * True when a turn is ENTIRELY filler, however many times it repeats.
 *
 * The original test anchored a single token, so "Hello? Hello?" — by far the
 * most common opener in the real corpus, because callers greet twice while the
 * assistant is still connecting — passed as substantive and became the
 * "request". That one gap accounted for a large share of an apparent 56%
 * unclassifiable rate, i.e. it looked like customer ambiguity and was actually a
 * measurement bug.
 */
function isFiller(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length > 6) return false; // too long to be pure greeting noise
  return tokens.every((t) => FILLER_WORD_RE.test(t));
}

/**
 * Whole-utterance social openers. "Hello. How are you?" survives the token test
 * (how/are/you are not filler WORDS) yet carries no request — it was a visible
 * chunk of the real unclassifiable residue. Matched as a phrase instead.
 */
const GREETING_PHRASE_RE =
  /^(hi|hey|hello|yes|yeah|good (morning|afternoon|evening))?[\s,.!?]*((how('?s| is| are)?\s*(you|it|ya)\s*(doing|going)?)|(what'?s up))[\s,.!?]*$/i;

/** Filler, placeholder, or too short to carry a request. */
function isSubstantive(text: string): boolean {
  if (text.length < MIN_SUBSTANTIVE_CHARS) return false;
  const t = text.trim();
  if (PLACEHOLDER_RE.test(t)) return false;
  if (GREETING_PHRASE_RE.test(t)) return false;
  return !isFiller(text);
}

/**
 * VAPI renders transcripts as speaker-prefixed lines. The prefix has varied
 * across versions and assistants, so match the known set rather than assume one:
 * `User:` / `Customer:` / `Human:` for the caller, `AI:` / `Assistant:` / `Bot:`
 * for the agent. A line with no recognised prefix continues the previous
 * speaker, which is how multi-line utterances arrive.
 */
const CUSTOMER_PREFIX = /^\s*(user|customer|human|caller)\s*:\s*/i;
const ASSISTANT_PREFIX = /^\s*(ai|assistant|bot|agent|system)\s*:\s*/i;

export interface CustomerTurns {
  /** Customer utterances in order, capped and truncated. */
  turns: string[];
  /** How many customer turns the transcript contained BEFORE capping. */
  totalCustomerTurns: number;
  /**
   * The first customer turn long enough to carry a request. This is the field
   * demand classification should read: it is the caller's own framing, captured
   * before the assistant steered the conversation.
   */
  firstSubstantive: string | null;
  /** True when the transcript had no recognisable speaker prefixes at all. */
  unparsed: boolean;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Parse a VAPI transcript into customer-only turns.
 *
 * Pure and total: any input yields a result, never a throw — this runs inside a
 * webhook whose 200 must not depend on transcript formatting.
 */
export function extractCustomerTurns(transcript: unknown): CustomerTurns {
  const empty: CustomerTurns = { turns: [], totalCustomerTurns: 0, firstSubstantive: null, unparsed: false };
  if (typeof transcript !== "string" || !transcript.trim()) return empty;

  const lines = transcript.split(/\r?\n/);
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

  for (const raw of lines) {
    if (CUSTOMER_PREFIX.test(raw)) {
      sawPrefix = true;
      flush();
      current = [raw.replace(CUSTOMER_PREFIX, "")];
    } else if (ASSISTANT_PREFIX.test(raw)) {
      sawPrefix = true;
      flush(); // assistant speech is dropped entirely
    } else if (current) {
      current.push(raw); // continuation of the customer's turn
    }
  }
  flush();

  // No speaker prefixes means we cannot tell caller from assistant. Returning
  // nothing is correct: assistant text labelled as customer demand is precisely
  // the contamination this module exists to remove.
  if (!sawPrefix) return { ...empty, unparsed: true };

  const substantive = collected.filter(isSubstantive);

  return {
    turns: collected.slice(0, MAX_TURNS).map((t) => (t.length > MAX_TURN_CHARS ? `${t.slice(0, MAX_TURN_CHARS)}…` : t)),
    totalCustomerTurns: collected.length,
    firstSubstantive: substantive.length
      ? substantive[0]!.slice(0, MAX_TURN_CHARS)
      : null,
    unparsed: false,
  };
}

/**
 * The shape persisted onto `vapi_call_logs.metadata.customerSpeech`.
 * Versioned so a later parser change is comparable rather than silently
 * overwriting earlier extractions with different semantics.
 */
/**
 * Extract customer turns from VAPI's STRUCTURED message array
 * (`artifact.messages`), which is role-tagged at the source.
 *
 * Strictly better than parsing the flat transcript when available: no prefix
 * guessing, no continuation-line heuristics, and no way for assistant speech to
 * be misattributed by a formatting change. `agenticAuditor` already reads this
 * same array, so the shape is proven against real payloads.
 *
 * VAPI uses `role: "user"` for the caller. Anything not explicitly the caller is
 * dropped — the default must exclude, so an unrecognised role can never be
 * counted as customer demand.
 */
export function extractCustomerTurnsFromMessages(messages: unknown): CustomerTurns {
  const empty: CustomerTurns = { turns: [], totalCustomerTurns: 0, firstSubstantive: null, unparsed: false };
  if (!Array.isArray(messages) || messages.length === 0) return { ...empty, unparsed: true };

  const collected: string[] = [];
  for (const m of messages) {
    const role = String((m as { role?: unknown })?.role ?? "").toLowerCase();
    if (role !== "user" && role !== "customer" && role !== "human") continue;
    const raw = (m as { message?: unknown; content?: unknown; text?: unknown })?.message
      ?? (m as { content?: unknown })?.content
      ?? (m as { text?: unknown })?.text;
    if (typeof raw !== "string") continue;
    const text = clean(raw);
    if (text) collected.push(text);
  }

  // An array that contained messages but no caller turns is a real observation
  // (assistant-only / no-answer call), NOT a parse failure — so `unparsed` stays
  // false and the empty result means what it says.
  const substantive = collected.filter(isSubstantive);
  return {
    turns: collected.slice(0, MAX_TURNS).map((t) => (t.length > MAX_TURN_CHARS ? `${t.slice(0, MAX_TURN_CHARS)}…` : t)),
    totalCustomerTurns: collected.length,
    firstSubstantive: substantive.length ? substantive[0]!.slice(0, MAX_TURN_CHARS) : null,
    unparsed: false,
  };
}

/**
 * v2 (2026-07-26): repeated-filler and placeholder handling. v1 treated
 * "Hello? Hello?" and the literal string "null" as substantive requests, which
 * inflated the unclassifiable rate and mislabelled calls on words the caller
 * never said. Bumped rather than silently changed so v1 and v2 extractions stay
 * distinguishable in the data.
 */
export const CUSTOMER_SPEECH_VERSION = 2;

export interface CustomerSpeechRecord {
  v: number;
  turns: string[];
  turnCount: number;
  first: string | null;
  unparsed: boolean;
}

export function buildCustomerSpeechRecord(transcript: unknown): CustomerSpeechRecord | null {
  const parsed = extractCustomerTurns(transcript);
  // Nothing usable — do not write an empty key that would later read as "this
  // call had no customer speech" rather than "we could not parse it".
  if (!parsed.turns.length && !parsed.unparsed) return null;
  return {
    v: CUSTOMER_SPEECH_VERSION,
    turns: parsed.turns,
    turnCount: parsed.totalCustomerTurns,
    first: parsed.firstSubstantive,
    unparsed: parsed.unparsed,
  };
}
