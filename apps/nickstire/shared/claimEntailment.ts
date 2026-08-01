/**
 * Does the source actually SAY this?
 *
 * evidenceRecords proves PROVENANCE — that a URL was fetched, hashed, and is
 * not expired. It has always been honest that it does not prove ENTAILMENT:
 * the field is hardcoded `"not_evaluated"`. Provenance without entailment means
 * a sentence can carry a real NHTSA link and still assert something NHTSA never
 * said, which is the exact failure mode a citation is supposed to prevent.
 *
 * WHAT THIS IS AND IS NOT
 * This is a DETERMINISTIC checker, not a language model. That asymmetry is the
 * whole point: it can refute strongly and confirm only weakly.
 *
 *   - A number in the claim that appears nowhere in the source is decisive:
 *     the source does not support it.
 *   - A negation flip is decisive: "does not require" vs "requires".
 *   - A universal the source never made ("always", "every", "never") is decisive.
 *   - But shared vocabulary is NOT proof of meaning, so overlap alone can only
 *     ever reach `partially_supported`. Reaching `supported` additionally
 *     requires every number and unit in the claim to be present in the source.
 *
 * It therefore cannot bless a paraphrase it doesn't understand, and that is a
 * feature: publication treats anything below `supported` as needing a qualifier
 * or a human.
 */

export type EntailmentVerdict =
  | "supported"
  | "partially_supported"
  | "contradicted"
  | "not_supported"
  | "not_evaluated";

export interface EntailmentResult {
  verdict: EntailmentVerdict;
  /** Machine-readable grounds, so a hold can explain itself. */
  reasons: string[];
  /** Numbers in the claim with no counterpart in the source. */
  unsupportedNumbers: string[];
  /** Absolutes asserted by the claim but absent from the source. */
  unsupportedUniversals: string[];
}

/** Words that turn a hedged finding into an absolute one. */
const UNIVERSALS = [
  "always", "never", "every", "all", "none", "no one", "guaranteed",
  "certainly", "definitely", "impossible", "must always", "zero",
];

/**
 * Negation markers. Parity decides polarity — an odd count on one side and an
 * even count on the other means the two sentences disagree.
 *
 * These MUST NOT overlap each other. A list containing both "not" and
 * "are not" counts a single negation TWICE, which flips its parity back to
 * even and makes "are not required" read as identical in polarity to "are
 * required" — the exact contradiction this check exists to catch. Multi-word
 * forms are therefore omitted where a single-word form already matches them:
 * "are/is/does not" are covered by "not", and "can't/won't/doesn't/isn't/
 * aren't" by "n't". "cannot" needs its own entry because the "not" pattern
 * requires a non-letter before it.
 */
const NEGATION_WORDS = ["not", "never", "no", "without", "cannot", "fails to"];

/**
 * One alternation, so each position in the text is counted once.
 *
 * Two shapes, because they sit differently in a word. A standalone negation
 * needs a non-letter before it, or "not" would fire inside "cannot" and
 * "nothing". A contraction does NOT — in "aren't" the negation is glued to the
 * preceding word, so requiring a non-letter before it made every contraction
 * invisible and "aren't required" read as positive.
 */
const NEGATION_RE = new RegExp(
  `(?:^|[^a-z])(?:${NEGATION_WORDS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![a-z])` +
    `|n't`,
  "g",
);

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "of", "to", "in", "on",
  "for", "with", "at", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "it", "its", "this", "that", "these", "those", "you", "your", "we",
  "our", "can", "may", "will", "should", "would", "about", "into", "than",
]);

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'");

function tokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9%.\-\s']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Numbers as a claim states them. Percentages, decimals, ranges and unit-bearing
 * quantities all count — these are the parts of a sentence a reader treats as
 * verified fact, so they are exactly what must appear in the source.
 */
function numbers(s: string): string[] {
  const out = norm(s).match(/\d+(?:[.,]\d+)?\s*(?:%|percent|psi|mph|miles?|k?m|minutes?|hours?|days?|years?|degrees?|°f?|dollars?|\$)?/g) ?? [];
  return out
    .map((n) => n.replace(/\s+/g, "").replace(/,/g, ""))
    .filter((n) => /\d/.test(n));
}

/** Digits only, so "30psi" and "30 PSI" and "30" compare equal. */
const digitsOf = (n: string) => n.replace(/[^\d.]/g, "");

function countNegations(s: string): number {
  return (norm(s).match(NEGATION_RE) ?? []).length;
}

function universalsIn(s: string): string[] {
  const t = norm(s);
  return UNIVERSALS.filter((u) => new RegExp(`(?:^|[^a-z])${u}(?:[^a-z]|$)`).test(t));
}

/**
 * Compare one claim against the exact excerpt cited for it.
 *
 * `sourceExcerpt` must be the text actually retrieved from the source. Passing
 * a title, a URL, or a summary produces a meaningless result — which is why
 * evidence records that resolve only to a title cannot reach `supported`.
 */
export function evaluateEntailment(claimText: string, sourceExcerpt: string | null | undefined): EntailmentResult {
  const reasons: string[] = [];

  if (!sourceExcerpt || !sourceExcerpt.trim()) {
    return {
      verdict: "not_evaluated",
      reasons: ["no source excerpt — provenance only (a URL or title is not a statement)"],
      unsupportedNumbers: [],
      unsupportedUniversals: [],
    };
  }
  if (!claimText || !claimText.trim()) {
    return { verdict: "not_evaluated", reasons: ["empty claim"], unsupportedNumbers: [], unsupportedUniversals: [] };
  }

  const claimNums = numbers(claimText);
  const srcNumDigits = new Set(numbers(sourceExcerpt).map(digitsOf));
  const unsupportedNumbers = claimNums.filter((n) => !srcNumDigits.has(digitsOf(n)));

  const claimUniversals = universalsIn(claimText);
  const srcUniversals = new Set(universalsIn(sourceExcerpt));
  const unsupportedUniversals = claimUniversals.filter((u) => !srcUniversals.has(u));

  const claimTokens = tokens(claimText);
  const srcTokens = new Set(tokens(sourceExcerpt));
  const overlap = claimTokens.length
    ? claimTokens.filter((t) => srcTokens.has(t)).length / claimTokens.length
    : 0;

  // Negation flip: strong topical overlap but opposite polarity is the signature
  // of a claim that inverts its source ("does not require" -> "requires").
  const claimNeg = countNegations(claimText) % 2;
  const srcNeg = countNegations(sourceExcerpt) % 2;
  if (overlap >= 0.5 && claimNeg !== srcNeg) {
    reasons.push("negation polarity differs from the source on otherwise matching text — the claim may invert what the source says");
    return { verdict: "contradicted", reasons, unsupportedNumbers, unsupportedUniversals };
  }

  // A number the source never states is not a rounding difference; it is an
  // assertion the citation does not carry.
  if (unsupportedNumbers.length) {
    reasons.push(`the source does not state ${unsupportedNumbers.join(", ")}`);
    return { verdict: "not_supported", reasons, unsupportedNumbers, unsupportedUniversals };
  }

  if (overlap < 0.25) {
    reasons.push(`only ${Math.round(overlap * 100)}% of the claim's meaningful terms appear in the excerpt — this excerpt is probably not about this claim`);
    return { verdict: "not_supported", reasons, unsupportedNumbers, unsupportedUniversals };
  }

  // An absolute the source never made is the most common way a hedged finding
  // becomes a false universal in a caption.
  if (unsupportedUniversals.length) {
    reasons.push(`claim asserts "${unsupportedUniversals.join('", "')}" but the source does not — hedge it or qualify it`);
    return { verdict: "partially_supported", reasons, unsupportedUniversals, unsupportedNumbers };
  }

  if (overlap >= 0.6) {
    reasons.push(`every number in the claim appears in the source and ${Math.round(overlap * 100)}% of its terms match`);
    return { verdict: "supported", reasons, unsupportedNumbers, unsupportedUniversals };
  }

  reasons.push(`partial term overlap (${Math.round(overlap * 100)}%) with no contradicted specifics — verify the wording before publishing unqualified`);
  return { verdict: "partially_supported", reasons, unsupportedNumbers, unsupportedUniversals };
}

/**
 * May an autonomous publish proceed on this verdict?
 *
 * `partially_supported` is publishable ONLY when the required qualifier
 * survived into the final script — a qualifier that gets edited out downstream
 * is the same as never having had one.
 */
export function entailmentAllowsAutonomousPublish(
  verdict: EntailmentVerdict,
  finalScript: string,
  requiredQualifiers: string[] = [],
): { allowed: boolean; reason: string } {
  if (verdict === "supported") return { allowed: true, reason: "source supports the claim as written" };

  if (verdict === "partially_supported") {
    if (requiredQualifiers.length === 0) {
      return { allowed: false, reason: "partially supported with no required qualifier declared — add one or strengthen the evidence" };
    }
    const script = norm(finalScript);
    const missing = requiredQualifiers.filter((q) => !script.includes(norm(q)));
    if (missing.length) {
      return { allowed: false, reason: `required qualifier(s) missing from the final script: ${missing.join(", ")}` };
    }
    return { allowed: true, reason: "partially supported, and every required qualifier is present in the final script" };
  }

  const why: Record<string, string> = {
    contradicted: "the source contradicts the claim",
    not_supported: "the source does not support the claim",
    not_evaluated: "entailment was never evaluated — provenance alone does not establish that the source says this",
  };
  return { allowed: false, reason: why[verdict] ?? "unknown entailment verdict" };
}
