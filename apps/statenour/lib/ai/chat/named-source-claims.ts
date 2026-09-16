/**
 * NAMED-SOURCE CLAIMS -- 2026-09-10.
 *
 * Sibling of action-claim-detector.ts. That module answers "the reply
 * claimed it DID something -- did a tool fire?". This one answers the
 * question that module cannot: "the reply NAMED something -- did a tool
 * ever resolve that name?".
 *
 * Witnessed failure (adversarial audit, 2026-09-10): asked for "the most
 * exclusive resources", the model emitted "Stoic Strategy" and "The
 * Machiavellian Empire" as specific YouTube channels, with descriptions,
 * sitting next to two real ones. Neither exists. No tool fired. The
 * action-claim detector saw no action verb, so it stayed silent; the
 * fact-checker substring-matches the reply against brain context, and an
 * invented channel is trivially absent from brain context, so it counted
 * as one more "unverified" item in a list nothing downstream read.
 *
 * SCOPE IS DELIBERATELY NARROW. This does NOT flag every proper noun --
 * "Adderall", "iOS", "Neon" are subjects, not sourced resources, and a
 * gate that blocks on those blocks every turn. It flags proper nouns
 * presented AS RETRIEVABLE RESOURCES: a channel, podcast, book, episode,
 * paper, study, article, product or tool the reader is expected to be
 * able to go and find. Those are exactly the claims falsifiable by a
 * lookup, and therefore exactly the ones that must carry a receipt.
 *
 * 2026-09-13 · the same evidence envelope also carries STRUCTURED ENTITY-ID
 * provenance (task/event/message/etc.). That is a separate failure class from
 * named resources: a plausible-looking internal id may be syntactically valid
 * while entirely fabricated. IDs are supported only by operator input, this
 * turn's tool-result evidence, or grounded context.
 *
 * EMPTY vs ERROR: `receiptsAvailable: false` (tool results could not be
 * read at all) is NOT the same as "no tool fired". The first is a blind
 * instrument and must not block; the second is the fabrication case and
 * must. See ReceiptEvidence.
 */

import {
  checkEntityClaimProvenance,
  type EntityClaim,
} from "./entity-claim-provenance";

/** A proper noun presented as a findable resource. */
export interface NamedSourceClaim {
  /** The name exactly as written in the reply. */
  name: string;
  /** channel | podcast | book | episode | paper | study | article | product | tool | listed */
  kind: string;
  /** Surrounding text, trimmed, for operator review. */
  snippet: string;
  /** True when the name arrived quoted, bolded or list-titled -- a stronger title signal. */
  titleMarked: boolean;
}

/**
 * What we know about tool activity this turn.
 *
 * `receiptsAvailable` distinguishes the two ways `evidenceText` can be
 * empty. A silent instrument must never be read as a clean bill of
 * health -- that inversion is how "no signal" gets scored as "no
 * problem".
 */
export interface ReceiptEvidence {
  /** Names of tools that actually fired this turn. */
  toolCalls: ReadonlyArray<{ name: string }>;
  /**
   * Concatenated tool RESULT text for this turn. A name/id found here was
   * resolved by a real lookup or returned by a real operation.
   */
  evidenceText: string;
  /**
   * False when tool results could not be read (transport gap, truncation,
   * telemetry off). Blocks are suppressed; the turn is flagged instead.
   */
  receiptsAvailable: boolean;
  /** The operator's own message. A name/id THEY introduced is not a fabrication. */
  userText?: string;
  /** Brain/system context already in the prompt. A name/id from here is grounded. */
  contextText?: string;
}

export interface NamedSourceReport {
  claims: NamedSourceClaim[];
  /** Claims with no supporting receipt. The fabrication set. */
  unreceipted: NamedSourceClaim[];
  /** Confidence tags the MODEL wrote as free text, unbacked by any receipt. */
  unearnedConfidenceTags: string[];
  /** True when no tool fired at all AND named resources were emitted. */
  namedWithoutAnyTool: boolean;
  /** True when receipts could not be read -- flag, never block. */
  blind: boolean;
  /** Additive 2026-09-13 fields; optional so older fixtures/consumers stay valid. */
  entityClaims?: EntityClaim[];
  unsupportedEntityClaims?: EntityClaim[];
  entityClaimsBlind?: boolean;
}

/** Resource nouns that make a nearby proper noun a findable claim. */
const RESOURCE_NOUNS =
  "channel|podcast|newsletter|substack|book|audiobook|episode|video|documentary|film|paper|study|article|blog|course|app|tool|plugin|extension|repo|repository|library|framework|account|handle|series|show";

/**
 * `<Proper Noun>` immediately followed by a resource noun.
 * e.g. "Stoic Strategy channel", "The Daily Stoic podcast".
 */
const NAME_THEN_NOUN_RE = new RegExp(
  "\\b((?:[A-Z][\\w'&.-]*(?:\\s+(?:of|the|and|de|for|to|in|a)\\s+|\\s+)){0,4}[A-Z][\\w'&.-]*)\\s+(?:YouTube\\s+)?(" +
    RESOURCE_NOUNS +
    ")\\b",
  "g",
);

/**
 * A resource noun followed by a name, with or without quotes.
 * e.g. 'channel called "Stoic Strategy"', "book: Meditations",
 *      "podcast named The Knowledge Project".
 */
const NOUN_THEN_NAME_RE = new RegExp(
  "\\b(" +
    RESOURCE_NOUNS +
    ")\\s*(?:called|named|titled|:|--)\\s*[\"'“‘*]?((?:[A-Z][\\w'&.-]*)(?:\\s+[\\w'&.-]*){0,5})",
  "gi",
);

/** A quoted or bolded title sitting in a list item -- the recommendation shape. */
const LISTED_TITLE_RE = new RegExp(
  "^\\s*(?:\\d+[.)]|[-*•])\\s+(?:\\*\\*|__|[\"'“‘])([A-Z][^*_\"'”’\\n]{2,60})(?:\\*\\*|__|[\"'”’])",
  "gm",
);

/**
 * Confidence tags. The audit's rule: the SYSTEM may stamp these after
 * reading the tool log; the MODEL may never type them.
 */
const CONFIDENCE_TAG_RE = /\[(confirmed|verified|checked|sourced|real|validated)\]/gi;

/**
 * Words that look like titles but are sentence scaffolding. Guarding
 * these is what keeps the false-positive rate low enough to BLOCK on.
 */
const STOPWORD_NAMES = new Set([
  "The", "This", "That", "These", "Those", "There", "Here", "It", "You", "Your",
  "I", "We", "They", "He", "She", "One", "Another", "Each", "Every", "Some",
  "Any", "Both", "His", "Her", "Their", "Our", "My", "A", "An", "And", "But",
  "So", "If", "When", "While", "Then", "Now", "Next", "First", "Second",
  "Third", "Last", "Best", "Top", "New", "Old", "Same", "Other", "More",
  "Most", "Less", "Least", "Good", "Great", "Real", "Whole", "Only", "Just",
  "Go", "Do", "Try", "Use", "Get", "Make", "Take", "Find", "Look", "Start",
  "Stop", "Keep", "Run", "Build", "Ship", "Read", "Watch", "Listen", "Pick",
  "Yes", "No", "Ok", "Okay", "Right", "Wrong", "Maybe", "Because", "Instead",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
]);

/** Lowercase, strip punctuation and a leading article, collapse whitespace. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop leading scaffolding words the prefix group swallowed.
 *
 * 2026-09-10 self-review · `NAME_THEN_NOUN_RE` allows up to four
 * capitalized tokens before the head noun, so "Try the Daily Stoic
 * podcast" captured the NAME as "Try the Daily Stoic". That is not
 * cosmetic: `hasReceipt` compares normalized names against the tool
 * result, and "try the daily stoic" does not appear in evidence
 * containing "Daily Stoic" -- so a genuinely SEARCHED recommendation
 * would read as unreceipted and be stripped from the reply. A
 * false positive here deletes correct work, which is worse than the
 * fabrication it was built to catch.
 *
 * STOPWORD_NAMES already enumerates this vocabulary; it was only being
 * used to reject whole names, never to trim a prefix.
 */
const STOPWORDS_LOWER = new Set([...STOPWORD_NAMES].map((w) => w.toLowerCase()));

function trimLeadingStopwords(raw: string): string {
  const words = raw.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && STOPWORDS_LOWER.has(words[i].toLowerCase())) i++;
  return words.slice(i).join(" ");
}

function isPlausibleName(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 70) return false;
  const words = trimmed.split(/\s+/);
  if (words.length === 1 && STOPWORD_NAMES.has(words[0])) return false;
  const meaningful = words.filter((w) => !STOPWORD_NAMES.has(w));
  if (meaningful.length === 0) return false;
  return meaningful.some((w) => /^[A-Z]/.test(w));
}

/**
 * A `listed` candidate is a bolded or quoted LIST ITEM, and unlike the other
 * two patterns it has NO resource noun anchoring it — `LISTED_TITLE_RE` fires
 * on markdown formatting alone. That is the whole false-positive surface, and
 * it is not theoretical.
 *
 * MEASURED on production shadow verdicts, 2026-09-11 → 2026-09-16 (91 turns,
 * the E4 experiment this module's own header defers enforcement on): 21 turns
 * came back `block`, 20 of them carrying unreceipted names, 4.86 names each —
 * and roughly half of the 73 distinct names were not resources at all. They
 * were the operator's own itineraries and coaching plans, written by Nick as
 * bolded list items:
 *
 *   14 ended in sentence punctuation   ("… in the next 30 min.")
 *   10 were label-colon-value lines    ("Lunch: <place>")
 *    2 were arrow itineraries          ("<place> → <place>")
 *    1 was an equation-style assertion ("<signal> = <reading>")
 *    2 were parenthetical day labels   ("Fri (arrival day)")
 *
 * Enforcement deletes list items it cannot receipt, so arming the gate on
 * that detector would have stripped the operator's travel plan and gym
 * protocol out of Nick's replies. The comment in persist-assistant-turn.ts
 * predicted exactly this — "a gate that either mangles good replies or gets
 * switched off for good" — which is why the number had to be measured first.
 *
 * So a listed candidate must LOOK like a title. These five rules were chosen
 * against that measured corpus and cost ZERO true positives on it: every real
 * channel and video title in the sample (including the sentence-case ones
 * like "How to read body language — FBI agent explains") survives all five,
 * because none of them ends a sentence, carries a label colon, or starts
 * lowercase. Capitalization density was REJECTED as a rule for exactly that
 * reason — sentence-case video titles are indistinguishable from prose by
 * capitalization, and it would have dropped three real titles.
 */
export function isResourceTitle(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // 1 · a title does not end a sentence.
  if (/[.!?]$/.test(t)) return false;
  // 2 · "<signal> = <reading>" is an assertion, not a name.
  if (t.includes("=")) return false;
  // 3 · "<place> → <place>" is an itinerary leg.
  if (/→|->/.test(t)) return false;
  // 4 · a label. "Lunch: <place>" and "Week after:" are fields, not titles.
  //     A real subtitle ("Never Split the Difference: Negotiating As If …")
  //     has a long left side, so only a SHORT left side is rejected.
  const colon = t.indexOf(":");
  if (colon >= 0) {
    const left = t.slice(0, colon).trim();
    if (left.split(/\s+/).filter(Boolean).length <= 3) return false;
  }
  // 5 · a title does not begin mid-sentence ("of <name>").
  if (/^[a-z]/.test(t)) return false;
  return true;
}

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Extract every proper noun presented as a findable resource. */
export function detectNamedSources(text: string): NamedSourceClaim[] {
  const found = new Map<string, NamedSourceClaim>();

  const push = (name: string, kind: string, index: number, titleMarked: boolean) => {
    const clean = trimLeadingStopwords(name.replace(/^["'“‘*_]+|["'”’*_]+$/g, "").trim());
    if (!isPlausibleName(clean)) return;
    const key = normalizeName(clean);
    if (!key || found.has(key)) return;
    found.set(key, {
      name: clean,
      kind: kind.toLowerCase(),
      snippet: snippetAround(text, index, clean.length),
      titleMarked,
    });
  };

  for (const m of text.matchAll(NAME_THEN_NOUN_RE)) {
    push(m[1], m[2], m.index ?? 0, false);
  }
  for (const m of text.matchAll(NOUN_THEN_NAME_RE)) {
    push(m[2], m[1], m.index ?? 0, /["'“‘*]/.test(m[0]));
  }
  for (const m of text.matchAll(LISTED_TITLE_RE)) {
    // The only pattern with no resource noun anchoring it — see isResourceTitle.
    if (!isResourceTitle(m[1])) continue;
    push(m[1], "listed", m.index ?? 0, true);
  }

  return [...found.values()];
}

/** Is this name backed by something other than the model's own head? */
function hasReceipt(claim: NamedSourceClaim, ev: ReceiptEvidence): boolean {
  const key = normalizeName(claim.name);
  if (!key) return true;
  const haystacks = [ev.evidenceText, ev.userText ?? "", ev.contextText ?? ""];
  return haystacks.some((h) => h.length > 0 && normalizeName(h).includes(key));
}

/**
 * Full check. Pure -- same inputs, same report.
 */
export function checkNamedSources(text: string, ev: ReceiptEvidence): NamedSourceReport {
  const claims = detectNamedSources(text);
  const blind = !ev.receiptsAvailable;

  const unreceipted = blind ? [] : claims.filter((c) => !hasReceipt(c, ev));

  const tags = [...text.matchAll(CONFIDENCE_TAG_RE)].map((m) => m[0]);
  const receiptsExist = ev.toolCalls.length > 0 && ev.receiptsAvailable;
  const unearnedConfidenceTags = receiptsExist ? [] : tags;

  const entityReport = checkEntityClaimProvenance(text, {
    userText: ev.userText,
    toolResultDigests: ev.evidenceText ? [ev.evidenceText] : [],
    contextText: ev.contextText,
  });

  return {
    claims,
    unreceipted,
    unearnedConfidenceTags,
    namedWithoutAnyTool: !blind && ev.toolCalls.length === 0 && claims.length > 0,
    blind,
    entityClaims: entityReport.claims,
    // A blind receipt channel means a tool may really have emitted the id.
    // Preserve the claims for diagnostics but never call them unsupported.
    unsupportedEntityClaims: blind ? [] : entityReport.unsupported,
    entityClaimsBlind: blind && entityReport.claims.length > 0,
  };
}

/**
 * Strip confidence tags the model was not entitled to write. Applied to
 * user-visible text: a false badge is worse than no badge.
 */
export function stripUnearnedConfidenceTags(text: string, report: NamedSourceReport): string {
  if (report.unearnedConfidenceTags.length === 0) return text;
  return text
    .replace(CONFIDENCE_TAG_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n");
}
