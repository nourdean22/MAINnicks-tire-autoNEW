/**
 * tests/brain/fast-topics-proforms.test.ts · 2026-09-18
 *
 * A short anaphoric follow-up used to derive topics made entirely of PRO-FORMS:
 *
 *   "is it still the same"  ->  ["same"]
 *   "the other way"         ->  ["other"]
 *   "is it done"            ->  ["done"]
 *
 * MEASURED over 20 such turns before the fix: 14 were pro-form-ONLY and 17
 * carried at least one. That is the dominant case for this shape of turn, not
 * an edge case.
 *
 * Why it mattered more than it looks. Those turns have `topics.length > 0`, so
 * they never reached the zero-topic embedding path added in #2425 — they ran a
 * real Postgres tsquery for "same" and scored every candidate on whether its
 * content happened to contain that word. The #2425 fix could not help them.
 *
 * Why removing them is NOT a precision/recall trade, and therefore did not need
 * a full recall-eval run: the lexical lane matches memory CONTENT, and for a
 * pro-form every content match is COINCIDENTAL. No memory is ever *about* the
 * word "same". There is no true positive to lose.
 *
 * This completes a class the list already started — `any`, `all`, `one`,
 * `thing`, `things`, `some` were stopwords from the beginning.
 */
import { describe, it, expect } from "vitest";
import { deriveFastTopics, shouldFallbackToConfidence } from "@/lib/brain/contextual-recall";

/**
 * 13 of the 20 measured turns — the unambiguous ones. The other 7 split into 3
 * that already derived zero topics, 3 mixed (a real topic beside a pro-form)
 * and the one documented below.
 */
const ANAPHORIC_TURNS = [
  "is it still the same",
  "what about the other one",
  "did you do both",
  "are they the same",
  "is there anything else",
  "was it something like that",
  "is everyone in",
  "what else",
  "none of those",
  "each of them",
  "is it done",
  "same thing",
  "the other way",
];

/**
 * Deliberately NOT in the corpus above, and the exclusion is the interesting
 * part. "what about the rest" derives ["rest"] and still does — because "rest"
 * has a real domain sense for this operator ("rest day"), so it is not a
 * stopword. The turn is genuinely ambiguous rather than junk, and asserting
 * zero topics for it would have meant dropping a real word to make a test pass.
 *
 * This corpus is therefore turns whose topics are UNAMBIGUOUSLY pro-forms.
 * Found by this file's own gate failing on the first run, which is the point
 * of writing the assertion before trusting the stopword list.
 */
const AMBIGUOUS_NOT_JUNK = "what about the rest";

const EMBEDDING = new Array(1536).fill(0.01);

describe("deriveFastTopics · pro-forms are not topics", () => {
  it("positive control: the deriver still works on a real turn", () => {
    // Without this, a deriver that returned [] for EVERYTHING would pass the
    // whole suite while destroying recall.
    expect(deriveFastTopics(["the tire inventory at the euclid shop"]).length).toBeGreaterThan(0);
    expect(deriveFastTopics(["my rent went up in July"]).length).toBeGreaterThan(0);
  });

  it("no anaphoric follow-up derives a pro-form-only topic set", () => {
    const offenders = ANAPHORIC_TURNS.map((t) => [t, deriveFastTopics([t])] as const)
      .filter(([, topics]) => topics.length > 0)
      .map(([t, topics]) => `${t} -> ${JSON.stringify(topics)}`);
    expect(
      offenders,
      "these turns still produce a lexical tsquery for a word no memory is about",
    ).toEqual([]);
  });

  it("they now reach the zero-topic embedding path instead (the #2425 lane)", () => {
    // Zero topics + a usable embedding must NOT fall back to confidence-ranked
    // memories — it leans on the semantic and KNN lanes, which is the whole
    // point of routing these turns here.
    for (const turn of ANAPHORIC_TURNS) {
      expect(shouldFallbackToConfidence(deriveFastTopics([turn]), EMBEDDING)).toBe(false);
    }
  });

  it("the ambiguous turn keeps its topic rather than being forced to zero", () => {
    expect(deriveFastTopics([AMBIGUOUS_NOT_JUNK])).toEqual(["rest"]);
  });

  it("a pro-form with a real domain sense is deliberately NOT a stopword", () => {
    // "rest day" and "oil change" are things this operator actually stores.
    // A pro-form with a noun sense in their world is not a pro-form.
    expect(deriveFastTopics(["how was my rest day"])).toContain("rest");
    expect(deriveFastTopics(["book the oil change"])).toContain("change");
  });

  it("a real topic sitting beside a pro-form still survives", () => {
    // The fix must strip the junk, not the turn.
    const topics = deriveFastTopics(["is the euclid shop the same as before"]);
    expect(topics).toContain("euclid");
    expect(topics).not.toContain("same");
  });
});
