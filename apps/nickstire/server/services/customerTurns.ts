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

/** Pure filler — never the customer's actual request. */
const FILLER_RE = /^(y(e[ash]*|up|eah)|ok(ay)?|uh[- ]?huh|mm+|hm+|hello|hi|hey|sure|right|alright|no|nope|thanks?|thank you|bye|goodbye|correct|exactly|please|sorry|what|huh)[.!?,]*$/i;

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

  const substantive = collected.filter((t) => t.length >= MIN_SUBSTANTIVE_CHARS && !FILLER_RE.test(t));

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
export const CUSTOMER_SPEECH_VERSION = 1;

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
