/**
 * Walk-in coverage: did the voice agent invite the caller to walk in, and did it
 * give the shop's address and hours?
 *
 * WHY: the shop is first come, first served with walk-ins and no held slots, so a
 * call that books nothing but sends the caller to the shop is a good outcome.
 * `vapi-quality-v1` cannot see it (it rewards a tool call or a lead row).
 *
 * TWO MEASURED FIELDS, EACH TRI-STATE. `true` and `false` are observations from
 * assistant speech; `null` is UNMEASURED (could not tell who spoke, or the agent
 * said nothing past its opening line). A missing or malformed field reads back as
 * `null`, never `false`: a row written before this existed is not a failed call.
 *
 * FACTS COME FROM `shared/business.ts` AT CALL TIME. The address and the hours
 * patterns are built from the facts object passed in (default: `BUSINESS`), so a
 * change in business.ts moves the criteria and no literal lives in this file.
 *
 * ASSISTANT SPEECH ONLY, AND NOT THE OPENING LINE. The greeting names the shop
 * and can name its address (see the speaker-attribution note in
 * `vapiCallClassifier.ts`), so counting it would score every call as "gave the
 * address". The first assistant turn is skipped as evidence.
 *
 * STORAGE: a short key=value suffix on `vapi_call_logs.eval_reasoning` (already a
 * ` · `-joined key=value string). No column, no migration.
 *
 * WHAT COUNTS (measured on 600 archived calls, 2026-10-18: the agent never says the house
 * number, says the street name in about one call in six, and states hours in about one in
 * ten, often as a close-only phrase): "address given" is the street NAME spoken in an
 * assistant turn after the opening line; "hours given" is an open-to-close pair OR a cue word
 * (open, close, till, until ...) followed by one of the shop's open or close times.
 */
import { BUSINESS } from "@shared/business";
import { extractAssistantTurns, extractAssistantTurnsFromMessages } from "./voiceClaimGuard";
import { resolveTranscriptAndMessages } from "./vapiCallArchive";

/** `null` is UNMEASURED. */
export type Measured = boolean | null;

export interface WalkInCoverage {
  walkInInvited: Measured;
  addressAndHoursGiven: Measured;
}

/** The slice of `BUSINESS` the criteria are built from. `BUSINESS` satisfies it structurally. */
export interface WalkInFacts {
  address: { street: string };
  hours: { structured: Record<string, string> };
}

export const UNMEASURED_WALK_IN: WalkInCoverage = { walkInInvited: null, addressAndHoursGiven: null };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HOUR_WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];

/** One spoken form of an "HH:MM" time: digits or word, optional ":MM", optional am/pm. */
function timePattern(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 || 12;
  const hour = `(?:${h12}|${HOUR_WORDS[h12 % 12]})`;
  const minutes = m ? `:${String(m).padStart(2, "0")}` : "(?::00)?";
  // Not glued to a letter, digit or colon on the left, nor to a digit or ":digit" on the right.
  return `(?<![\\w:])${hour}${minutes}(?!\\d|:\\d)(?:\\s*[ap]\\.?m\\.?)?`;
}

/** Every distinct open-to-close pair in the structured hours, as one regex each. */
function hoursPatterns(hours: WalkInFacts["hours"]): RegExp[] {
  const pairs = new Set(Object.values(hours.structured));
  const out: RegExp[] = [];
  for (const pair of pairs) {
    const [open, close] = pair.split("-");
    if (!open || !close) continue;
    out.push(new RegExp(`${timePattern(open)}\\s*(?:to|until|till|through|-|\\u2013)\\s*${timePattern(close)}`, "i"));
  }
  return out;
}

/** Cue words that put a time in the hours class: "open till six", "we close at six". */
const HOURS_CUE = String.raw`\b(?:open|opens|close|closes|closed|closing|till|til|until)\b`;

/**
 * Close-only (or open-only) hours: a cue word, a few filler words, then ONE of the distinct open or
 * close times in the structured hours. A count ("six days", "six hours") is not a time of day.
 */
function cuedTimePattern(hours: WalkInFacts["hours"]): RegExp | null {
  const times = new Set<string>();
  for (const pair of Object.values(hours.structured)) {
    for (const t of pair.split("-")) if (/^\d{1,2}:\d{2}$/.test(t)) times.add(t);
  }
  if (times.size === 0) return null;
  const filler = String.raw`(?:(?:at|by|from|is|are|around|about|today|daily)\s+){0,3}`;
  const notACount = String.raw`(?!\s*(?:days?|hours?|weeks?|minutes?|months?|years?)\b)`;
  return new RegExp(`${HOURS_CUE}\\s+${filler}(?:${[...times].map(timePattern).join("|")})${notACount}`, "i");
}

/**
 * The street name the agent actually says: the word after the optional house number
 * ("<number> <street name> <suffix>"). The agent does not speak the number.
 * shortcut: first word only, so a street written "10 N Main St" would match on "N"; upgrade if the facts ever look like that.
 */
function streetPattern(street: string): RegExp | null {
  const m = street.trim().match(/^(?:\d+\s+)?([A-Za-z][\w'-]*)/);
  return m ? new RegExp(`\\b${escapeRe(m[1])}\\b`, "i") : null;
}

/**
 * Generic invitation phrasing. The facts being invited TO live in business.ts, not here.
 * A bare "come in" is deliberately absent (it also fits "come in at 3 for your appointment"),
 * and "no appointment" counts only as "needed/necessary/required" or "without an appointment".
 */
const INVITE = new RegExp(
  [
    String.raw`\bwalk[\s-]?ins?\b`,
    // "pull up", "come up" and "come down" are deliberately absent: "let me pull up your info" is a lookup.
    String.raw`\b(?:come|swing|stop|drop|pop)\s+(?:on\s+)?(?:by|over)\b`,
    String.raw`\bhead\s+over\b`,
    String.raw`\b(?:stop|drop|pop)\s+in\b`,
    String.raw`\bcome\s+on\s+in\b`,
    String.raw`\bfirst[\s-]come\b`,
    String.raw`\bno appointment (?:is )?(?:needed|necessary|required)\b`,
    String.raw`\bwithout an appointment\b`,
  ].join("|"),
  "i",
);

/**
 * A negation that governs a walk-in term ("do not take walk-ins", "no walk-ins", "can't do walk-ins"):
 * a negator, at most two words with no punctuation between, then the term. A comma ends the run, so
 * "we don't take appointments, but walk-ins are welcome" is not a refusal of walk-ins.
 */
const NEGATED_WALK_IN = /(?:\b(?:no|not|never|cannot|no longer)|n['’]t)\s+(?:[a-z'’]+\s+){0,2}walk[\s-]?ins?\b/gi;

/**
 * Strip negated walk-in phrases, then look for an invitation in what is left.
 * shortcut: the negator must sit within two words of the term; a longer gap reads as an invitation.
 */
const invites = (turn: string): boolean => INVITE.test(turn.replace(NEGATED_WALK_IN, " "));

/**
 * Role-tagged messages win when present (no speaker-label guessing); otherwise the
 * prefixed transcript. Neither usable gives UNMEASURED.
 */
function detectWalkInCoverage(
  transcript: unknown,
  messages: unknown = null,
  facts: WalkInFacts = BUSINESS,
): WalkInCoverage {
  const { turns, unparsed } =
    Array.isArray(messages) && messages.length > 0
      ? extractAssistantTurnsFromMessages(messages)
      : extractAssistantTurns(transcript);
  if (unparsed) return UNMEASURED_WALK_IN;
  // Past the opening line there must be something to read, or nothing was measured.
  const evidence = turns.slice(1);
  if (evidence.length === 0) return UNMEASURED_WALK_IN;

  const street = streetPattern(facts.address.street);
  const hours = [...hoursPatterns(facts.hours), cuedTimePattern(facts.hours)].filter((re): re is RegExp => re !== null);
  const gaveAddress = street !== null && evidence.some((t) => street.test(t));
  const gaveHours = evidence.some((t) => hours.some((re) => re.test(t)));

  return {
    walkInInvited: evidence.some(invites),
    addressAndHoursGiven: gaveAddress && gaveHours,
  };
}

/** The cron's entry point: find the transcript and messages in a VAPI call detail the way the archive does. */
export function detectWalkInForDetail(detail: unknown, facts: WalkInFacts = BUSINESS): WalkInCoverage {
  const { transcript, messages } = resolveTranscriptAndMessages(detail);
  return detectWalkInCoverage(transcript, messages, facts);
}

const token = (v: Measured): string => (v === null ? "unmeasured" : String(v));

/** ` · walk_in=true · addr_hours=unmeasured`. Always written, so a new row is told apart from an old one. */
function formatWalkInSuffix(c: WalkInCoverage): string {
  return ` · walk_in=${token(c.walkInInvited)} · addr_hours=${token(c.addressAndHoursGiven)}`;
}

export function appendWalkInSuffix(reasoning: string, c: WalkInCoverage): string {
  return `${reasoning}${formatWalkInSuffix(c)}`;
}

/** Strict: only the exact tokens `true` / `false` are read. Anything else is UNMEASURED. */
function readField(reasoning: string, key: string): Measured {
  const m = reasoning.match(new RegExp(`(?:^|\\s·\\s)${key}=(true|false|unmeasured)(?=\\s·\\s|$)`));
  if (!m || m[1] === "unmeasured") return null;
  return m[1] === "true";
}

export function parseWalkInSuffix(reasoning: string | null | undefined): WalkInCoverage {
  if (!reasoning) return UNMEASURED_WALK_IN;
  return { walkInInvited: readField(reasoning, "walk_in"), addressAndHoursGiven: readField(reasoning, "addr_hours") };
}
