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
 * EMPTY vs ERROR: `receiptsAvailable: false` (tool results could not be
 * read at all) is NOT the same as "no tool fired". The first is a blind
 * instrument and must not block; the second is the fabrication case and
 * must. See ReceiptEvidence.
 */

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
   * Concatenated tool RESULT text for this turn. A name found here was
   * resolved by a real lookup.
   */
  evidenceText: string;
  /**
   * False when tool results could not be read (transport gap, truncation,
   * telemetry off). Blocks are suppressed; the turn is flagged instead.
   */
  receiptsAvailable: boolean;
  /** The operator's own message. A name THEY introduced is not a fabrication. */
  userText?: string;
  /** Brain/system context already in the prompt. A name from here is grounded. */
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

function isPlausibleName(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 70) return false;
  const words = trimmed.split(/\s+/);
  if (words.length === 1 && STOPWORD_NAMES.has(words[0])) return false;
  const meaningful = words.filter((w) => !STOPWORD_NAMES.has(w));
  if (meaningful.length === 0) return false;
  return meaningful.some((w) => /^[A-Z]/.test(w));
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
    const clean = name.replace(/^["'“‘*_]+|["'”’*_]+$/g, "").trim();
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
    push(m[1], "listed", m.index ?? 0, true);
  }

  return [...found.values()];
}

/** Is this name backed by something other than the model's own head? */
function hasReceipt(claim: NamedSourceClaim, ev: ReceiptEvidence): boolean {
  const key = normalizeName(claim.name);
  if (!key) return true; // nothing to check -- do not manufacture a violation
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

  // A confidence tag is EARNED only if a tool fired this turn AND we can
  // see the results. Anything else is the model typing a badge it has no
  // standing to issue.
  const tags = [...text.matchAll(CONFIDENCE_TAG_RE)].map((m) => m[0]);
  const receiptsExist = ev.toolCalls.length > 0 && ev.receiptsAvailable;
  const unearnedConfidenceTags = receiptsExist ? [] : tags;

  return {
    claims,
    unreceipted,
    unearnedConfidenceTags,
    namedWithoutAnyTool: !blind && ev.toolCalls.length === 0 && claims.length > 0,
    blind,
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
