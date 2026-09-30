/**
 * Customer-facing wording for the public online estimate (Q-46).
 *
 * OAC 109:4-3-13 makes it unfair to represent that a repair is necessary when
 * it is not, and (B)(2) requires telling a consumer who is not at the counter
 * about the right to an estimate on first contact. The online estimator prices
 * a repair from the customer's own words; nobody has seen the car. So:
 *
 *  - model-written text may not call the repair necessary, the car dangerous
 *    or the job urgent. There is no inspection finding for such a claim to
 *    rest on. Sentences carrying an unhedged verdict are dropped; hedged ones
 *    ("resurfacing if necessary", "could become unsafe") stay.
 *  - the disclaimer and the estimate-choice notice are server-owned constants,
 *    never model output.
 *
 * Detection is deliberately a word list, not a classifier: it over-drops a
 * neutral sentence now and then ("brake pads are a critical part"), which
 * costs a line of filler. Under-dropping costs a false urgency claim.
 * Wording is for the operator to review (Q-46 tier: OPERATOR reviews wording).
 */

export const ESTIMATE_CHOICE_NOTICE =
  "Before we start any repair, you choose: a written estimate, an oral estimate, or no estimate. " +
  "No work starts until you approve it.";

export const ESTIMATE_DISCLAIMER =
  "This is a price range, not a diagnosis. Your vehicle has not been inspected yet, " +
  "so the repair it needs may differ. Final pricing follows an in-person inspection. Tax is additional.";

const VERDICT_WORDS =
  "dangerous|unsafe|hazardous|necessary|urgent|urgently|immediate|immediately|critical|essential|mandatory";

// A hedge directly before the verdict word makes it conditional, not a claim:
// "if necessary", "as necessary", "could become unsafe", "not necessary".
const HEDGE = String.raw`(?<!\b(?:if|as|when|whether|unless|where|not|(?:can|could|may|might)\s+(?:be|become|get))\s+)`;

const UNHEDGED_VERDICT = new RegExp(`${HEDGE}\\b(?:${VERDICT_WORDS})\\b`, "i");

export function hasUnfoundedVerdict(text: string): boolean {
  return UNHEDGED_VERDICT.test(text);
}

/** Drop every sentence carrying an unhedged verdict. Returns the kept text and the drop count. */
export function stripUnfoundedVerdicts(text: string): { text: string; dropped: number } {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== "");
  const kept = sentences.filter((s) => !hasUnfoundedVerdict(s));
  return { text: kept.join(" ").trim(), dropped: sentences.length - kept.length };
}

/** Titles are short labels, not sentences: remove the verdict word itself. */
export function stripVerdictFromTitle(title: string): { text: string; dropped: number } {
  const re = new RegExp(`${HEDGE}\\b(?:${VERDICT_WORDS})\\b\\s*`, "gi");
  const text = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
  return { text, dropped: text === title.trim() ? 0 : 1 };
}
